// Chromatic effect — true spectral RGB channel separation.
// Text is drawn three times (red, green, blue) with independent spatial offsets
// that animate on different sinusoidal phases. The three channels composite via
// globalCompositeOperation='screen' so they add like light: overlapping areas
// become white, separated edges show pure hues, triple-overlap zones reveal
// spectral rainbows.
//
// Architecture: textBuf holds white text on transparent. Three persistent
// offscreen channel buffers (rBuf, gBuf, bBuf) are tinted via source-in fill.
// No getImageData/putImageData — GPU compositing only.
//
// Animation: 30-second cycle with three WOW moments — full spread bursts,
// maximum spread orbits, and rapid oscillation. Channels trisect 120° apart.
//
// Interactive: cursor X → spread (0..60), cursor Y → angle (0..360).
'use strict';

const ELECTRIC_COLORS = ["#000000","#0a0a1a","#1a0a0a","#0a1a0a","#111111","#000033","#330000","#003300"];
const CYCLE_MS = 30000;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Keyframe interpolation helper.
// stops = [[t0,v0],[t1,v1],...] sorted ascending.
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = [stops[i][0],   stops[i][1]];
    const [t1, v1] = [stops[i+1][0], stops[i+1][1]];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

const params = {
  spread:      18,
  angle:       30,
  speed:       1.0,
  animate:     false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('energetic') : 'prism',
  textSize:    400,
  bold:        true,
  italic:      false,
  bg:          '#000000',
};
if(window.WAState) window.WAState.hydrate(params);

const cv    = document.getElementById('cv');
const ctx   = cv.getContext('2d');

// textBuf — white text on transparent, drawn once per text change.
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d');

// Three channel buffers — each tinted to R, G, or B then screen-composited.
const rBuf = document.createElement('canvas');
const gBuf = document.createElement('canvas');
const bBuf = document.createElement('canvas');
const rctx = rBuf.getContext('2d');
const gctx = gBuf.getContext('2d');
const bctx = bBuf.getContext('2d');

let gui;
let DPR = 1;
let animationId = null;
let animationStartTime = 0;

const dirty = { raster: false, paint: false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster) rasterizeText();
    paint();
    dirty.raster = dirty.paint = false;
  });
}

function cssW(){ return cv.clientWidth  || window.innerWidth;  }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf, rBuf, gBuf, bBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  rctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function rasterizeText(){
  const w = cssW(), h = cssH();
  // Clear in identity (backing pixel) space.
  tctx.save();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, textBuf.width, textBuf.height);
  tctx.restore();
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const FIT = 0.92;
  let size = params.textSize;
  tctx.font = fontSpec(size);
  let measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';
  tctx.fillText(params.text, w / 2, h / 2);
}

// Tint a channel buffer to a pure color (r,g,b) and draw textBuf at (offX,offY).
// Uses source-in: wherever the tinted rect overlaps the text alpha, keep the color.
function renderChannel(bufCtx, r, g, b, offX, offY){
  const w = cssW(), h = cssH();
  // Clear in backing-pixel space.
  bufCtx.save();
  bufCtx.setTransform(1, 0, 0, 1, 0, 0);
  bufCtx.clearRect(0, 0, bufCtx.canvas.width, bufCtx.canvas.height);
  bufCtx.restore();
  bufCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Draw textBuf at offset — this is the alpha mask.
  // Pass dest dimensions (cssW, cssH) so the DPR-scaled buffer renders at CSS size.
  bufCtx.globalCompositeOperation = 'source-over';
  bufCtx.drawImage(textBuf, offX, offY, w, h);

  // Fill the whole canvas with the channel color, clipped to text alpha via source-in.
  bufCtx.globalCompositeOperation = 'source-in';
  bufCtx.fillStyle = `rgb(${r},${g},${b})`;
  bufCtx.fillRect(0, 0, w, h);

  // Reset composite op.
  bufCtx.globalCompositeOperation = 'source-over';
}

// Compute (offX, offY) for a channel given:
//   baseAngleDeg — the axis angle for this channel (angle + channel phase offset)
//   spread       — distance in CSS px
function channelOffset(baseAngleDeg, spread){
  const rad = baseAngleDeg * Math.PI / 180;
  return {
    offX: Math.cos(rad) * spread,
    offY: Math.sin(rad) * spread,
  };
}

function paint(overrideSpread, overrideAngle){
  window.WAGUI?.flashValues(params);

  const spread = overrideSpread != null ? overrideSpread : params.spread;
  const angle  = overrideAngle  != null ? overrideAngle  : params.angle;
  const w = cssW(), h = cssH();

  // Background fill in CSS coordinate space.
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Red channel: angle + 0°, Green: angle + 120°, Blue: angle + 240°
  const rOff = channelOffset(angle,       spread);
  const gOff = channelOffset(angle + 120, spread);
  const bOff = channelOffset(angle + 240, spread);

  renderChannel(rctx, 255,   0,   0, rOff.offX, rOff.offY);
  renderChannel(gctx,   0, 255,   0, gOff.offX, gOff.offY);
  renderChannel(bctx,   0,   0, 255, bOff.offX, bOff.offY);

  // Screen-composite all three channel buffers onto cv.
  // Screen = 1-(1-A)(1-B): where channels overlap → white; edges → pure hue.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(rBuf, 0, 0);
  ctx.drawImage(gBuf, 0, 0);
  ctx.drawImage(bBuf, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ── Animation ──────────────────────────────────────────────────────────────────
// 30-second cycle with three WOW moments. Each channel also has an independent
// subtle secondary oscillation layered on top of the main envelope.

function renderAnimationFrame(t_loop){
  // Main spread envelope — keyframe curve with WOW moments.
  // t=0.00: spread=0 (all aligned, crisp white)
  // t=0.10: ramp up begins
  // t=0.20: WOW #1 — full spread, pure R/G/B visible
  // t=0.35: channels snap back together → white
  // t=0.40: erupts again at different angle
  // t=0.55: WOW #2 — 3× spread, all channels drifting in circles
  // t=0.70: spiral back
  // t=0.80: brief stillness
  // t=0.85: WOW #3 — rapid oscillation / strobe build
  // t=1.00: back to spread=0 (seamless)
  const baseSpread = kf(t_loop, [
    [0.00,  0],
    [0.10,  8],
    [0.20, params.spread],
    [0.30, params.spread * 1.2],
    [0.35,  2],
    [0.40, params.spread * 1.1],
    [0.55, params.spread * 3],
    [0.70,  4],
    [0.80,  1],
    [0.85, params.spread * 0.5],
    [0.92, params.spread * 2.5],
    [1.00,  0],
  ]);

  // Angle sweeps continuously but with a jerk at WOW moments.
  const baseAngle = params.angle + t_loop * 360 * kf(t_loop, [
    [0.00, 0.3],
    [0.18, 0.3],
    [0.20, 2.0],  // WOW #1: fast spin
    [0.30, 0.5],
    [0.35, 0.3],
    [0.53, 0.3],
    [0.55, 2.5],  // WOW #2: fast spin
    [0.65, 0.6],
    [0.78, 0.2],
    [0.83, 0.2],
    [0.85, 3.0],  // WOW #3: fastest spin
    [0.95, 1.0],
    [1.00, 0.3],
  ]);

  // Independent per-channel secondary oscillations (subtle, layered on top).
  // These make each channel orbit slightly differently — the trisection stays
  // but the radii breathe independently so you see spectral shimmer.
  const TWO_PI = 2 * Math.PI;
  const rExtra = Math.sin(t_loop * TWO_PI * 2)              * baseSpread * 0.18;
  const gExtra = Math.sin(t_loop * TWO_PI * 3 + Math.PI / 3) * baseSpread * 0.18;
  const bExtra = Math.sin(t_loop * TWO_PI * 2.5 + TWO_PI / 3) * baseSpread * 0.18;

  // Derive per-channel spreads.
  const rSpread = Math.max(0, baseSpread + rExtra);
  const gSpread = Math.max(0, baseSpread + gExtra);
  const bSpread = Math.max(0, baseSpread + bExtra);

  // Compute offsets for each channel with their own spread magnitudes.
  const rOff = channelOffset(baseAngle,       rSpread);
  const gOff = channelOffset(baseAngle + 120, gSpread);
  const bOff = channelOffset(baseAngle + 240, bSpread);

  // Render each channel buffer.
  renderChannel(rctx, 255,   0,   0, rOff.offX, rOff.offY);
  renderChannel(gctx,   0, 255,   0, gOff.offX, gOff.offY);
  renderChannel(bctx,   0,   0, 255, bOff.offX, bOff.offY);

  // Paint background + screen-composite.
  const w = cssW(), h = cssH();
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(rBuf, 0, 0);
  ctx.drawImage(gBuf, 0, 0);
  ctx.drawImage(bBuf, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Keep GUI sliders in sync with animated values.
  if(gui){
    gui.rows.get('spread')?._write(Math.round(baseSpread));
    gui.rows.get('angle')?._write(Math.round(baseAngle % 360));
  }
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = (performance.now() - animationStartTime) * params.speed;
  renderAnimationFrame((elapsed % CYCLE_MS) / CYCLE_MS);
  dirty.raster = dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}

function toggleAnimation(){
  if(params.animate){
    animationStartTime = performance.now();
    animationLoop();
  } else if(animationId){
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ── WAEffect API ───────────────────────────────────────────────────────────────
window.WAEffect = {
  cycleMs: CYCLE_MS,
  renderAt(t_loop){ rasterizeText(); renderAnimationFrame(t_loop); },
  pauseRender(){
    if(animationId){ cancelAnimationFrame(animationId); animationId = null; }
  },
  resumeRender(){
    if(params.animate && !animationId){
      animationStartTime = performance.now();
      animationLoop();
    } else if(!params.animate){
      redraw();
    }
  },
};

// ── Fallback mouse handler (used when WAInteract is not available) ─────────────
function handleMouseMoveFallback(e){
  if(!params.interactive || params.animate) return;
  const r  = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  params.spread = ax * 60;
  params.angle  = ay * 360;
  if(gui){
    gui.rows.get('spread')?._write(params.spread);
    gui.rows.get('angle')?._write(params.angle);
  }
  schedule('paint');
}

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });

  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name:   'wordart-chromatic',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec:    document.querySelector('.wa-rec'),
    });
  }

  // Wire WAInteract if available, otherwise fall back to raw mousemove.
  if(window.WAInteract){
    WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.spread = ax * 60;
        params.angle  = ay * 360;
        gui?.rows.get('spread')?._write(params.spread);
        gui?.rows.get('angle')?._write(params.angle);
        schedule('paint');
      },
      onWheel(dy){
        params.spread = Math.max(0, Math.min(60, params.spread - dy * 0.05));
        gui?.rows.get('spread')?._write(Math.round(params.spread));
        schedule('paint');
      },
      onClick(ax, ay){
        // Snap all channels to a random new angle burst.
        params.angle = Math.random() * 360;
        if(!params.animate) schedule('paint');
      },
      onPinch(ratio){
        params.spread = Math.max(0, Math.min(60, params.spread * ratio));
        gui?.rows.get('spread')?._write(Math.round(params.spread));
        schedule('paint');
      },
    });
  } else {
    cv.addEventListener('mousemove', handleMouseMoveFallback);
  }

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
