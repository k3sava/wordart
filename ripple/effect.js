// Ripple effect — concentric sine-wave rings radially displace the text
// pixels. For each output pixel its source position in the text buffer is
// computed by a radial displacement:
//   disp = amplitude × sin(2π × r / wavelength + phaseRad)
// applied along the inward radius vector from the canvas centre. Inverse
// warping (each dst pixel asks where it came from in src) avoids holes.
// Damping mode fades the displacement with distance from centre, making
// text look like a pebble-drop on water. Phase scrolls during animation
// so ripples travel outward continuously.
//
// Performance: DPR is always capped at 1 (1× pixels) because the inner loop
// is pure JS — no GPU path. The text raster is cached in cachedSrcData and
// only invalidated when typography params change; phase/amplitude updates
// are free (no re-raster). Radial fields (r, nx, ny per pixel) are built
// once on resize and reused every frame.
//
// Seamless loop proof:
//   At t=0: amp=0, phase=0 — no displacement, crisp text.
//   At t=1: amp=0, phase=phaseTurns×360° ≡ 0° (mod 360°) — identical.
//   Between: amplitude breathes via sin(πt) (0→peak→0); phase scrolls via
//   phaseTurns full turns (integer, so sin closes exactly).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  amplitudePeak: 45,  // peak displacement in backing pixels
  phaseTurns:     3,  // integer turns → seamless: sin is periodic
};

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t){ return a + (b - a) * t; }
function hexToRgb(hex){
  const m = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(String(hex || '#000000'));
  if(!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const params = {
  amplitude:   15,
  wavelength:  60,
  phase:        0,
  damp:        false,
  animate:     false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'flow',
  textSize:    400,
  bold:        true,
  italic:      false,
  bg:          pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv      = document.getElementById('cv');
// DPR is fixed at 1 for this effect — the JS pixel loop is the bottleneck.
// Drawing at native CSS px means backing res === display res: no scaling needed.
const ctx     = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d', { willReadFrequently: true });

let gui;
// DPR always 1 for ripple — declared as const after init to make intent clear.
const DPR = 1;

let animationId        = null;
let animationStartTime = 0;

// Precomputed radial fields — one Float32Array element per backing pixel.
let rField    = null;  // distance from centre
let nxField   = null;  // unit radius vector x component
let nyField   = null;  // unit radius vector y component
let maxRippleR = 1;    // max r in the field (used for damping normalisation)

// Cached source pixel data — invalidated when typography params change.
let cachedSrcData = null;

const dirty = { raster: false, paint: false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster){ rasterizeText(); cachedSrcData = null; }
    paint();
    dirty.raster = dirty.paint = false;
  });
}

function cssW(){ return cv.clientWidth  || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function buildRadialField(){
  const bw = textBuf.width, bh = textBuf.height;
  const cx = bw / 2, cy = bh / 2;
  maxRippleR = Math.sqrt(cx * cx + cy * cy) || 1;
  rField  = new Float32Array(bw * bh);
  nxField = new Float32Array(bw * bh);
  nyField = new Float32Array(bw * bh);
  for(let y = 0; y < bh; y++){
    for(let x = 0; x < bw; x++){
      const dx = x - cx, dy = y - cy;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const i  = y * bw + x;
      rField[i]  = r;
      nxField[i] = r > 0.5 ? dx / r : 0;
      nyField[i] = r > 0.5 ? dy / r : 0;
    }
  }
}

function fitCanvas(){
  // Always DPR=1: canvas backing pixels === CSS pixels.
  const w = cssW(), h = cssH();
  let resized = false;
  for(const c of [cv, textBuf]){
    if(c.width  !== w){ c.width  = w; resized = true; }
    if(c.height !== h){ c.height = h; resized = true; }
  }
  // Identity transform — DPR=1 so no scaling.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  if(resized){ buildRadialField(); cachedSrcData = null; }
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function rasterizeText(){
  const w = textBuf.width, h = textBuf.height;
  // DPR=1 so identity transform is already set.
  tctx.clearRect(0, 0, w, h);

  const FIT = 0.92;
  let size = params.textSize;
  tctx.font = fontSpec(size);
  const measured = tctx.measureText(params.text).width;
  if(measured > 0 && measured > w * FIT){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
  }

  tctx.font        = fontSpec(size);
  tctx.textAlign   = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle   = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);

  // Invalidate cache so paint() reads fresh pixels.
  cachedSrcData = null;
}

function paint(overridePhase, overrideAmp){
  window.WAGUI?.flashValues(params);
  const w = textBuf.width, h = textBuf.height;

  // Obtain source pixels (cached until typography changes).
  if(!cachedSrcData){
    cachedSrcData = tctx.getImageData(0, 0, w, h).data;
  }
  const srcData = cachedSrcData;

  const dst     = ctx.createImageData(w, h);
  const dstData = dst.data;

  const [br, bg, bb] = hexToRgb(params.bg);

  // Fill destination with background colour.
  for(let i = 0; i < dstData.length; i += 4){
    dstData[i]     = br;
    dstData[i + 1] = bg;
    dstData[i + 2] = bb;
    dstData[i + 3] = 255;
  }

  if(!rField){ ctx.putImageData(dst, 0, 0); return; }

  const amp      = (overrideAmp   != null) ? overrideAmp   : params.amplitude;
  const lambda   = Math.max(1, params.wavelength);
  const phaseRad = ((overridePhase != null) ? overridePhase : params.phase) * Math.PI / 180;
  const doDamp   = params.damp;

  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      const idx = y * w + x;
      const r   = rField[idx];
      if(r < 0.5) continue;

      const nx = nxField[idx];
      const ny = nyField[idx];

      // Damping: linearly reduce displacement toward zero at the field edge.
      const damp = doDamp ? Math.max(0, 1 - r / maxRippleR) : 1;

      // Signed displacement along the radius vector.
      const disp = amp * Math.sin(2 * Math.PI * r / lambda + phaseRad) * damp;

      // Inverse warp: for this dst pixel, find where it came from in src.
      const sx = Math.round(x - disp * nx);
      const sy = Math.round(y - disp * ny);

      if(sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

      const srcIdx = (sy * w + sx) * 4;
      // Source pixel is white text on transparent background.
      // Alpha > 128 means this texel is part of the glyph.
      if(srcData[srcIdx + 3] > 128){
        const dstIdx = (y * w + x) * 4;
        dstData[dstIdx]     = 255;
        dstData[dstIdx + 1] = 255;
        dstData[dstIdx + 2] = 255;
        dstData[dstIdx + 3] = 255;
      }
    }
  }

  ctx.putImageData(dst, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // Phase scrolls by phaseTurns full rotations over the cycle.
  // Integer turns → sin closes exactly at t=1 back to t=0 (seamless).
  const phase = (t_loop * 360 * ANIM.phaseTurns) % 360;

  // Amplitude: sin(πt) envelope — 0 at t=0 and t=1, peak at t=0.5.
  // Text starts crisp, swells into maximum ripple, returns to crisp.
  const amp = ANIM.amplitudePeak * Math.sin(t_loop * Math.PI);

  params.phase     = phase;
  params.amplitude = amp;

  if(gui){
    gui.rows.get('phase')?._write(phase);
    gui.rows.get('amplitude')?._write(amp);
  }

  // No re-rasterize needed: only phase and amp changed — source pixels
  // are unchanged. cachedSrcData is still valid.
  paint(phase, amp);
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

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r  = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));

  params.amplitude  = Math.round(ax * 60);
  params.wavelength = Math.max(10, Math.round(10 + ay * 190));

  if(gui){
    gui.rows.get('amplitude')?._write(params.amplitude);
    gui.rows.get('wavelength')?._write(params.wavelength);
  }
  schedule('paint');
}

// Typography changes require fresh rasterization and field re-read.
// amplitude / wavelength / phase / damp are paint-only (use cached src).
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
      canvas:  cv,
      name:    'wordart-ripple',
      pngBtn:  document.getElementById('export-png'),
      mp4Btn:  document.getElementById('export-mp4'),
      rec:     document.querySelector('.wa-rec'),
    });
  }
  cv.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
