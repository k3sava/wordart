// Aurora effect — text letterforms are a window into a living aurora borealis.
// Six sinusoidal color bands in greens, blues, purples, and magentas flow
// horizontally through the text shape. Outside the letters: darkness. Inside:
// flowing northern lights, composited via source-atop (no getImageData).
//
// Architecture (GPU-only, three offscreen buffers):
//   textBuf  — white text on transparent, drawn once per text change
//   auroraBuf — aurora bands drawn fresh every frame
//   maskBuf  — receives textBuf alpha, then aurora via source-atop
//
// Animate: 30-second cycle with 3 wow moments (full spectrum, kinetic bands,
// maximum wave amplitude). Seamless loop — all params return to start values.
// Interactive: cursor X → hueShift, cursor Y → intensity.
'use strict';

const CYCLE_MS = 30000;
const TAU = Math.PI * 2;

// Six aurora bands. baseY/ampX are fractions of canvas height; halfWidth is
// fraction of h; freqX is spatial frequency (radians per CSS px); speed is
// cycles-per-loop along the time axis; hueSweep is hue-degrees-per-loop.
const BANDS = [
  { baseY: 0.25, ampX: 0.08, freqX: 0.015, speed: 0.4,  halfWidth: 0.07, baseHue: 150, hueSweep: 0.3,  alpha: 0.90 },
  { baseY: 0.40, ampX: 0.06, freqX: 0.020, speed: 0.6,  halfWidth: 0.05, baseHue: 190, hueSweep: 0.2,  alpha: 0.80 },
  { baseY: 0.55, ampX: 0.10, freqX: 0.012, speed: 0.3,  halfWidth: 0.09, baseHue: 280, hueSweep: 0.4,  alpha: 0.70 },
  { baseY: 0.65, ampX: 0.07, freqX: 0.025, speed: 0.8,  halfWidth: 0.04, baseHue: 320, hueSweep: 0.2,  alpha: 0.85 },
  { baseY: 0.75, ampX: 0.09, freqX: 0.010, speed: 0.2,  halfWidth: 0.06, baseHue: 100, hueSweep: 0.5,  alpha: 0.75 },
  { baseY: 0.50, ampX: 0.12, freqX: 0.008, speed: 0.15, halfWidth: 0.12, baseHue: 220, hueSweep: 0.35, alpha: 0.60 },
];

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  speed:       1.0,
  intensity:   80,
  hueShift:    0,
  wave:        1.0,
  animate:     false,
  interactive: false,
  text:        (window.WAState?.randomPhrase?.('cosmic')) ?? 'aurora',
  textSize:    400,
  bold:        false,
  italic:      true,
  bg:          '#000814',
};
if(window.WAState) window.WAState.hydrate(params);

// ── Canvas + context setup ────────────────────────────────────────────────────

const cv       = document.getElementById('cv');
const ctx      = cv.getContext('2d');

// textBuf: white text on transparent — the stencil.
const textBuf  = document.createElement('canvas');
const tctx     = textBuf.getContext('2d');

// auroraBuf: aurora bands drawn fresh every frame.
const auroraBuf = document.createElement('canvas');
const actx      = auroraBuf.getContext('2d');

// maskBuf: receives text alpha, then aurora composited via source-atop.
const maskBuf  = document.createElement('canvas');
const mctx     = maskBuf.getContext('2d');

let animationId        = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// ── Dirty / schedule / raf ────────────────────────────────────────────────────

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
    paint(0);
    dirty.raster = dirty.paint = false;
  });
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function cssW(){ return cv.clientWidth  || window.innerWidth;  }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w  = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf, auroraBuf, maskBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // auroraBuf and maskBuf are always drawn in identity (backing px) space.
  actx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── Text rasterisation ────────────────────────────────────────────────────────

function fontSpec(size){
  const wt = params.bold   ? 'bold'   : 'normal';
  const st = params.italic ? 'italic' : 'normal';
  return `${st} ${wt} ${size}px Helvetica`;
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
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';
  tctx.fillText(params.text, w / 2, h / 2);
}

// ── Aurora band renderer ──────────────────────────────────────────────────────

// centerY returns the Y coordinate (in CSS px) of a band's sinusoidal midline.
// w and h are in CSS px (the DPR transform is NOT applied to actx).
// Because actx works in backing pixels, we convert before drawing.
function drawBands(ctx2d, bw, bh, t_loop, speedMul, intensityMul, hueShiftDeg, waveMul){
  ctx2d.clearRect(0, 0, bw, bh);

  // CSS dimensions (bands are parameterised in CSS-px fractions).
  const w = bw / DPR;
  const h = bh / DPR;

  for(const band of BANDS){
    const hue = ((band.baseHue + hueShiftDeg + t_loop * band.speed * speedMul * 360 * band.hueSweep) % 360 + 360) % 360;
    const alpha = Math.max(0, Math.min(1, band.alpha * (intensityMul / 100)));

    // Vertical gradient fades the band top-and-bottom — gives the aurora its
    // soft luminous quality. Gradient is in backing-pixel space.
    const bandCenterY = (band.baseY * h) * DPR;
    const bandHalf    = (band.halfWidth * h) * DPR;

    const grad = ctx2d.createLinearGradient(0, bandCenterY - bandHalf * 2, 0, bandCenterY + bandHalf * 2);
    grad.addColorStop(0,   `hsla(${hue}, 90%, 65%, 0)`);
    grad.addColorStop(0.5, `hsla(${hue}, 90%, 65%, ${alpha})`);
    grad.addColorStop(1,   `hsla(${hue}, 90%, 65%, 0)`);
    ctx2d.fillStyle = grad;

    // Sinusoidal centerline in backing-pixel space.
    function cy(x){
      // x is in backing px; convert to CSS px for the frequency calculation.
      const xCss = x / DPR;
      return (band.baseY + band.ampX * waveMul * Math.sin(xCss * band.freqX + t_loop * band.speed * speedMul * TAU)) * h * DPR;
    }

    const hw = bandHalf;

    ctx2d.beginPath();
    // Top edge — left to right.
    ctx2d.moveTo(0, cy(0) - hw);
    for(let x = 4; x <= bw; x += 4){
      ctx2d.lineTo(x, cy(x) - hw);
    }
    // Bottom edge — right to left.
    for(let x = bw; x >= 0; x -= 4){
      ctx2d.lineTo(x, cy(x) + hw);
    }
    ctx2d.closePath();
    ctx2d.fill();
  }
}

// ── Compositing paint ─────────────────────────────────────────────────────────

function paint(t_loop = 0, speedMul, intensityMul, hueShiftDeg, waveMul){
  window.WAGUI?.flashValues(params);

  // Resolve multipliers — fall back to current param values when not animated.
  speedMul     = speedMul     ?? params.speed;
  intensityMul = intensityMul ?? params.intensity;
  hueShiftDeg  = hueShiftDeg  ?? params.hueShift;
  waveMul      = waveMul      ?? params.wave;

  const bw = cv.width, bh = cv.height;  // backing-pixel dimensions
  const w  = cssW(),   h  = cssH();     // CSS-pixel dimensions

  // 1. Draw aurora bands into auroraBuf (backing-pixel space, identity transform).
  drawBands(actx, bw, bh, t_loop, speedMul, intensityMul, hueShiftDeg, waveMul);

  // 2. Build the masked composite in maskBuf.
  //    a. Clear maskBuf.
  mctx.clearRect(0, 0, bw, bh);
  //    b. Draw white text into maskBuf — this establishes the alpha stencil.
  //       textBuf was drawn with DPR transform so it maps 1:1 onto maskBuf.
  mctx.globalCompositeOperation = 'source-over';
  mctx.drawImage(textBuf, 0, 0);
  //    c. Draw auroraBuf onto maskBuf with source-atop — aurora pixels are
  //       clipped to wherever the text (white pixels) already has alpha.
  mctx.globalCompositeOperation = 'source-atop';
  mctx.drawImage(auroraBuf, 0, 0);

  // 3. Compose final output onto cv.
  //    a. Dark background (in CSS-px space via the active DPR transform).
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  //    b. Draw maskBuf (in identity backing-pixel space) on top.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(maskBuf, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(0); }

// ── Animation keyframes ───────────────────────────────────────────────────────

// Linear piecewise interpolation over [t0,t1] → [v0,v1] segments.
// Returns the value at fractional position t ∈ [0,1].
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

function renderAnimationFrame(t_loop){
  // Speed: doubles mid-cycle for kinetic energy, returns to normal.
  const speedMul = kf(t_loop, [
    [0.00, 0.10], [0.10, 0.80], [0.20, 1.00],
    [0.50, 2.00], [0.65, 2.20], [0.75, 1.00],
    [0.85, 0.80], [1.00, 0.10],
  ]) * params.speed;

  // Intensity: faint at endpoints, full bloom at 0.2, rapid sweep at 0.4.
  const intensityMul = kf(t_loop, [
    [0.00, 30],  [0.10, 65],  [0.20, 100],
    [0.33, 90],  [0.40, 100], [0.50, 95],
    [0.65, 100], [0.75, 85],  [0.85, 50],
    [1.00, 30],
  ]) * (params.intensity / 100);

  // hueShift: big sweep at t=0.33 (color inversion), full revolution at t=0.40.
  const hueShiftDeg = kf(t_loop, [
    [0.00, 0],   [0.33, 0],   [0.38, 180],
    [0.40, 0],   [0.45, 360], [0.50, 0],
    [1.00, 0],
  ]) + params.hueShift;

  // Wave amplitude: triples during kinetic wow moment (t=0.60–0.65).
  const waveMul = kf(t_loop, [
    [0.00, 1.0], [0.20, 1.0], [0.50, 1.2],
    [0.60, 3.0], [0.65, 3.2], [0.75, 1.2],
    [1.00, 1.0],
  ]) * params.wave;

  // Reflect animated values in GUI.
  if(gui){
    gui.rows.get('speed')?._write(speedMul.toFixed(1));
    gui.rows.get('wave')?._write(waveMul.toFixed(1));
    gui.rows.get('intensity')?._write(Math.round(intensityMul));
  }

  paint(t_loop, speedMul, intensityMul * 100, hueShiftDeg, waveMul);
}

// ── Animation loop ────────────────────────────────────────────────────────────

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  renderAnimationFrame((elapsed % CYCLE_MS) / CYCLE_MS);
  dirty.raster = dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}

function toggleAnimation(){
  if(params.animate){
    // Start 15% into the cycle — bands are already bright and moving.
    animationStartTime = performance.now() - CYCLE_MS * 0.15;
    animationLoop();
  } else if(animationId){
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

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

// ── Init ──────────────────────────────────────────────────────────────────────

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState?.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });

  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name:   'wordart-aurora',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec:    document.querySelector('.wa-rec'),
    });
  }

  WAInteract.wire(cv, {
    onMove(ax, ay){
      if(!params.interactive || params.animate) return;
      params.hueShift = ax * 360;
      params.intensity = Math.round((1 - ay) * 100);
      gui?.rows.get('hueShift')?._write(Math.round(params.hueShift));
      gui?.rows.get('intensity')?._write(params.intensity);
      schedule('paint');
    },
    onWheel(dy){
      params.speed = Math.max(0.1, Math.min(3, params.speed - dy * 0.005));
      gui?.rows.get('speed')?._write(params.speed.toFixed(1));
      if(!params.animate) schedule('paint');
    },
    onClick(){
      params.hueShift = Math.random() * 360;
      gui?.rows.get('hueShift')?._write(Math.round(params.hueShift));
      if(!params.animate) schedule('paint');
    },
    onPinch(ratio){
      params.wave = Math.max(0.1, Math.min(3, params.wave * ratio));
      gui?.rows.get('wave')?._write(params.wave.toFixed(1));
      if(!params.animate) schedule('paint');
    },
  });

  window.addEventListener('resize', () => {
    fitCanvas();
    rasterizeText();
    if(!params.animate) paint(0);
  });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
