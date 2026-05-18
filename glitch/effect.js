// Glitch effect — text rasterised once, then composited into R, G, B channels
// with independent horizontal offsets. Tear bands shift horizontal strips of
// the composite. Scanlines darken every other row.
//
// We render the text white onto textBuf, then composite three times into the
// main canvas using globalCompositeOperation 'lighter' (additive) — drawing
// the same mask with multiply-tinted red/green/blue copies at three offsets.
// On a black background you get classic CRT chroma split; on a coloured bg
// the channels punch through and read as separation against the bg.
//
// Animation — 30s wow moments:
//   t=0.00: crisp, intensity=0 (clean text)
//   t=0.10: subtle glitches begin
//   t=0.20: WOW #1 — full glitch storm, channel separation, heavy tears
//   t=0.35: partial calm, scanlines heavy
//   t=0.45: WOW #2 — RGB channels fully separated, maximum offset
//   t=0.55: channels snap together, brief clarity
//   t=0.65: eerie calm, intensity=0
//   t=0.70: WOW #3 — rapid strobing, digital explosion
//   t=0.85: fast decay to calm
//   t=1.00: intensity=0, seamless loop
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
// Curve amplitudes (peaks, not rest values — wave does the rest=0 work).
const ANIM = {
  rgbOffsetAmp:  120,
  tearAmountAmp:  55,
  tearDensityHi:  45,
  tearDensityLo:  6,
  rollBandsPerCycle: 4,
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
// Keyframe interpolator: stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

const params = {
  rgbOffset: 24,
  tearAmount: 10,
  tearDensity: 12,
  scanlines: 25,
  animate: false,
  interactive: false,
  text: 'please',
  textSize: 400,
  bold: true,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');
// Tint buffer — used to multiply mask × channel colour before additive paste.
const tintBuf = document.createElement('canvas');
const xctx = tintBuf.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;
// Signed RGB offset and a vertical roll offset live outside `params` so the
// GUI slider (unsigned, 0..160) doesn't fight the canvas's smooth float math.
let rgbOffsetSigned = 0;
let rollOffsetPx = 0;
// Stable per-row jitter seed; refreshed sparingly during animation for a
// "frozen tape" feel rather than a sand-storm.
let tearSeed = Math.random() * 1e9;
let lastTearStamp = 0;

const dirty = { raster:false, paint:false };
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

function cssW(){ return cv.clientWidth || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf, tintBuf]){
    if(c.width !== bw) c.width = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function rasterizeText(){
  const w = cssW(), h = cssH();
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
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
}

function buildTinted(color){
  // mask × color → tintBuf. Use 'source-in' to keep only mask alpha, with fill.
  xctx.save();
  xctx.setTransform(1, 0, 0, 1, 0, 0);
  xctx.clearRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.drawImage(textBuf, 0, 0);
  xctx.globalCompositeOperation = 'source-in';
  xctx.fillStyle = color;
  xctx.fillRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.restore();
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function paint(){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  // Animation drives a signed offset; sliders/interactive drive unsigned.
  // When the unsigned slider differs from |signed|, prefer signed (animation
  // is the source of truth while animating).
  const off = params.animate ? rgbOffsetSigned : Math.max(0, params.rgbOffset);
  // Additive blending so R+G+B reconverge to white where they overlap.
  ctx.globalCompositeOperation = 'lighter';

  const channels = [
    { color: '#FF0000', dx: -off },
    { color: '#00FF00', dx: 0 },
    { color: '#0000FF', dx:  off },
  ];
  for(const ch of channels){
    buildTinted(ch.color);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tintBuf, ch.dx * DPR, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Tear bands — copy strips of the composite to a shifted x.
  applyTears(w, h);

  // Scanlines — translucent dark stripes every 2 rows.
  if(params.scanlines > 0){
    const a = (params.scanlines / 100) * 0.55;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    for(let y = 0; y < h; y += 3){
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }
}

// Cheap deterministic PRNG so band selection is stable per "seed".
function srand(seed){
  let s = seed | 0;
  return function(){
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

function applyTears(w, h){
  const amount = params.tearAmount;
  const densityPct = params.tearDensity;
  if(amount <= 0 || densityPct <= 0) return;
  const rng = srand(tearSeed | 0);
  // Cut the canvas into 24 horizontal bands; each has p(densityPct/100) of
  // being torn by ±rand × amount. Roll offset slides the band grid down so
  // bands creep over time rather than blinking in place.
  const BANDS = 24;
  const bandH = Math.ceil(h / BANDS);
  // rollOffsetPx is in *bands* (fractional). Convert to px, wrap modulo bandH.
  // Because rollOffsetPx goes 0 → rollBandsPerCycle exactly across a cycle,
  // and rollBandsPerCycle is an integer, the wrap closes seamlessly at loop end.
  const rollPx = rollOffsetPx * bandH;
  const roll = ((rollPx % bandH) + bandH) % bandH;
  for(let i = -1; i < BANDS; i++){
    const r1 = rng(), r2 = rng();
    if(r1 * 100 > densityPct) continue;
    const dx = Math.round((r2 - 0.5) * 2 * amount);
    if(dx === 0) continue;
    const y = i * bandH + roll;
    const yClamped = Math.max(0, y);
    const sh = Math.min(bandH - (yClamped - y), h - yClamped);
    if(sh <= 0) continue;
    // Read this strip from the canvas and re-paste at a horizontal offset.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clear the destination band first (paint over with bg) so the original
    // pixels don't bleed through.
    ctx.fillStyle = params.bg;
    ctx.fillRect(0, yClamped * DPR, cv.width, sh * DPR);
    ctx.drawImage(
      cv,
      0,           yClamped * DPR,   cv.width,       sh * DPR,
      dx * DPR,    yClamped * DPR,   cv.width,       sh * DPR,
    );
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  const t = ((t_loop % 1) + 1) % 1;

  // RGB offset: keyframed for wow moments.
  // Positive = R shifts left, B shifts right. Sign flip at WOW#2.
  rgbOffsetSigned = kf(t, [
    [0.00,   0],   // crisp start
    [0.10,  12],   // subtle glitch begins
    [0.20, 120],   // WOW #1: full channel separation
    [0.30,  40],   // partial calm
    [0.35,  25],   // settling
    [0.45,-120],   // WOW #2: maximum separation, channels flipped
    [0.55,   0],   // snap to aligned — brief clarity
    [0.65,   0],   // eerie calm
    [0.70, 120],   // WOW #3: explosion begins
    [0.75,  -80],  // rapid strobe — alternating
    [0.80,  100],  // still strobing
    [0.85,  20],   // fast decay
    [1.00,   0],   // seamless close
  ]);

  // Tear amount: massive at WOW moments, zero at calm.
  const ta = kf(t, [
    [0.00,   0],
    [0.10,   8],
    [0.20,  55],   // WOW #1
    [0.35,  15],
    [0.45,  50],   // WOW #2
    [0.55,   5],
    [0.65,   0],   // eerie calm
    [0.70,  55],   // WOW #3
    [0.80,  55],
    [0.85,  10],
    [1.00,   0],
  ]);

  // Tear density: dense during chaos, sparse during calm.
  const td = kf(t, [
    [0.00,   6],
    [0.10,  12],
    [0.20,  45],   // WOW #1
    [0.35,  18],
    [0.45,  40],   // WOW #2
    [0.55,   8],
    [0.65,   6],   // eerie calm
    [0.70,  45],   // WOW #3
    [0.80,  45],
    [0.85,  12],
    [1.00,   6],
  ]);

  // Roll offset: steady creep, accelerates during WOW moments.
  rollOffsetPx = kf(t, [
    [0.00, 0],
    [0.20, 0.8],
    [0.45, 2.0],
    [0.70, 3.0],
    [0.85, 3.8],
    [1.00, 4.0],
  ]);

  const rgbDisplay = Math.abs(rgbOffsetSigned);
  if(gui){
    gui.rows.get('rgbOffset')?._write(rgbDisplay);
    gui.rows.get('tearAmount')?._write(ta);
    gui.rows.get('tearDensity')?._write(td);
  }
  params.rgbOffset = rgbDisplay;
  params.tearAmount = ta;
  params.tearDensity = td;

  // Reseed tear pattern in 24 slots per cycle so torn bands shift without
  // flickering frame-to-frame. Derived from slot — deterministic, so frame 0
  // seeds == frame 1: the loop closes on the same tear pattern.
  const SLOTS = 24;
  const slot = Math.round(t * SLOTS) % SLOTS;
  tearSeed = (slot * 9301 + 49297) | 0;
  lastTearStamp = slot;

  paint();
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
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

window.WAEffect = {
  cycleMs: CYCLE_MS,
  renderAt(t_loop){ renderAnimationFrame(t_loop); },
  pauseRender(){ if(animationId){ cancelAnimationFrame(animationId); animationId = null; } },
  resumeRender(){
    if(params.animate && !animationId){
      animationStartTime = performance.now();
      animationLoop();
    } else if(!params.animate){
      redraw();
    }
  },
};

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  params.rgbOffset  = Math.round(ax * 160);
  params.tearAmount = Math.round(ay * 200);
  if(gui){
    gui.rows.get('rgbOffset')?._write(params.rgbOffset);
    gui.rows.get('tearAmount')?._write(params.tearAmount);
  }
  tearSeed = (performance.now() / 90) | 0;
  schedule('paint');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

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
      name: 'wordart-glitch',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.rgbOffset  = Math.round(ax * 160);
        params.tearAmount = Math.round(ay * 200);
        if(gui){
          gui.rows.get('rgbOffset')?._write(params.rgbOffset);
          gui.rows.get('tearAmount')?._write(params.tearAmount);
        }
        tearSeed = (performance.now() / 90) | 0;
        schedule('paint');
      },
      onWheel(dy){
        params.intensity = Math.max(0, Math.min(100, (params.intensity || params.rgbOffset / 1.6) + dy * 0.05));
        params.rgbOffset = Math.round(params.intensity * 1.6);
        gui?.rows.get('rgbOffset')?._write(params.rgbOffset);
        schedule('paint');
      },
      onClick(ax, ay){
        // Glitch burst — slam intensity to max
        params.rgbOffset = 160;
        params.tearAmount = 200;
        params.tearDensity = 45;
        tearSeed = (performance.now() / 13) | 0;
        gui?.rows.get('rgbOffset')?._write(160);
        schedule('paint');
      },
    });
  } else {
    cv.addEventListener('mousemove', handleMouseMove);
  }
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
