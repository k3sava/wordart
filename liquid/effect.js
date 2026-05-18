// Liquid effect — text rasterised into textBuf, then re-rendered via a
// vertical-strip drawImage loop. Each CSS-pixel column x gets an independent
// downward displacement dy computed from two interfering sine waves. The top
// of the text is anchored; the bottom stretches and drips. Multiple drip waves
// travel horizontally at different speeds, producing an organic liquid look.
//
// GPU path: no per-frame getImageData / pixel loops. Strip copies are hardware-
// accelerated in every browser (V8/Skia uses GPU blits for drawImage sub-rects).
// 1920 strip iterations per frame ≈ <1 ms on any modern device.
//
// Animate: 30-second story arc with three WOW moments — gentle ripple, full
// melt, rain-on-glass chaos, upward drip inversion, then calm return.
// Interactive: mouse X → drip amplitude, mouse Y → waveWidth; wheel → drip;
// click → drip spike; pinch → waveWidth.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Piecewise linear keyframe interpolation.
// stops: [[t, value], ...]  sorted ascending by t.
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

const params = {
  drip:       35,
  waveWidth:  120,
  speed:       1.0,
  viscosity:   0.5,
  animate:     false,
  interactive: false,
  text: 'it is',
  textSize:   400,
  bold:        true,
  italic:      false,
  bg:          pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv      = document.getElementById('cv');
const ctx     = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d');

let animationId        = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Track mouse position for interactive drip-well (CSS px).
let mouseX = 0;
let mouseY = 0;

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
  if(cv.width      !== bw) cv.width      = bw;
  if(cv.height     !== bh) cv.height     = bh;
  if(textBuf.width !== bw) textBuf.width  = bw;
  if(textBuf.height!== bh) textBuf.height = bh;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// Rasterise white text on transparent background into textBuf.
// Called once per text/font change — not per frame.
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
  const measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';
  tctx.fillText(params.text, w / 2, h / 2);
}

// ── Core liquid drip formula ────────────────────────────────────────────────
//
// Two interfering sine waves produce an organic, non-repeating drip pattern.
// Phase arguments t1/t2 are in radians and advance with time.
// viscosity (0–1) controls wave smoothness: low viscosity → sharp waves
// (plain sin), high viscosity → raised-cosine envelope rounds the peaks.
//
// Returns CSS-px displacement (positive = down, negative = up).
function dripAt(xCss, t1, t2, dripAmp, waveW, viscosity){
  const TAU   = Math.PI * 2;
  const angle1 = TAU * xCss / waveW + t1;
  const angle2 = TAU * xCss / (waveW * 1.7) + t2;

  // Primary drip lobe.
  let wave = Math.sin(angle1);
  // Viscosity blends toward a raised-cosine (soft drip blob):
  // at viscosity=0 → pure sin; at viscosity=1 → sin²  (always ≥0, blobby).
  if(viscosity > 0){
    const blob  = (1 - Math.cos(angle1)) * 0.5; // sin²(angle1/2)
    wave = wave * (1 - viscosity) + blob * viscosity;
  }

  // Secondary modulation for organic interference.
  const mod = 0.4 + 0.6 * Math.sin(angle2);

  return dripAmp * wave * mod;
}

// ── paint() ────────────────────────────────────────────────────────────────
//
// Overrides let renderAnimationFrame pass keyframe values without mutating
// params (so GUI knobs don't jump during animation).
function paint(overrideDrip, overrideWaveWidth, overrideT){
  window.WAGUI?.flashValues(params);

  const w       = cssW();
  const h       = cssH();
  const bh      = textBuf.height;
  const dripAmp = overrideDrip      != null ? overrideDrip      : params.drip;
  const waveW   = overrideWaveWidth != null ? overrideWaveWidth : params.waveWidth;
  const visc    = params.viscosity;

  // t is a wall-clock phase in radians. We advance it by overrideT if given,
  // otherwise derive from animation clock (zero for static renders).
  let t_raw = overrideT != null ? overrideT : 0;

  // Two independent phase channels at different speeds.
  const TAU  = Math.PI * 2;
  const t1   = t_raw * TAU * 2;          // 2 full cycles per loop
  const t2   = t_raw * TAU * 1.3;        // 1.3 cycles per loop — incommensurable

  // Fill background.
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Strip-copy loop: one CSS-pixel-wide column per iteration.
  // We work entirely in backing-buffer (physical) pixels for drawImage,
  // then immediately shift the transform back.
  //
  // For each column x (CSS px):
  //   drip = dripAt(x, t1, t2, ...)
  //   Draw textBuf strip from (x*DPR, 0, DPR, bh)
  //           to canvas   at  (x*DPR, drip*DPR, DPR, bh + |drip|*DPR)
  //
  // The dest height = bh + |drip|*DPR ensures the bottom of the strip
  // stretches down proportional to displacement — this is the drip tail.
  // The top anchor is achieved because the source starts at y=0 always;
  // only the destination shifts and stretches.

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // work in physical px for drawImage

  const bw = textBuf.width;
  for(let xPhys = 0; xPhys < bw; xPhys++){
    const xCss  = xPhys / DPR;
    const drip  = dripAt(xCss, t1, t2, dripAmp, waveW, visc);
    const dPhys = drip  * DPR;
    const tailH = Math.abs(dPhys) * 0.5; // drip tail elongation factor

    // Source: 1-physical-px-wide strip of textBuf, full height.
    // Dest: same column, shifted by drip, height stretched by tail.
    const destH = bh + tailH;
    ctx.drawImage(
      textBuf,
      xPhys, 0,     1, bh,        // sx, sy, sw, sh
      xPhys, dPhys, 1, destH      // dx, dy, dw, dh
    );
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ── Animation story arc (30 s) ─────────────────────────────────────────────
//
//  t=0.00  drip=0, perfectly flat                   → clean start
//  t=0.10  drip begins — gentle surface tension      → slow ripple onset
//  t=0.20  WOW #1: full drip amp, wide waves         → text visibly melting
//  t=0.30  waveWidth narrows to 20 — rain-on-glass   → tight rapid ripples
//  t=0.40  WOW #2: max drip + narrow waves           → liquid chaos
//  t=0.50  waveWidth expands to 300 — giant waves    → slow massive swell
//  t=0.60  drip reduces — one huge slow wave resolves text
//  t=0.65  WOW #3: drip goes negative (inverted)     → upward anti-gravity
//  t=0.75  drip returns positive, gentle descent      → gravity restored
//  t=0.85  final calm ripple                          → settling
//  t=1.00  drip=0, seamless loop                     → back to rest

const DRIP_STOPS = [
  [0.00,   0],
  [0.10,   5],
  [0.20,  35],
  [0.30,  35],
  [0.40,  60],
  [0.50,  40],
  [0.60,  20],
  [0.65, -30], // WOW #3: inversion
  [0.75,  15],
  [0.85,   8],
  [1.00,   0],
];

const WAVE_STOPS = [
  [0.00, 120],
  [0.10, 120],
  [0.20, 100],
  [0.30,  20], // rain-on-glass
  [0.40,  20],
  [0.50, 300], // massive swell
  [0.60, 180],
  [0.65,  80],
  [0.75, 120],
  [0.85, 160],
  [1.00, 120],
];

function renderAnimationFrame(t_loop){
  const animDrip   = kf(t_loop, DRIP_STOPS);
  const animWave   = kf(t_loop, WAVE_STOPS);
  const speed      = params.speed;

  // t_raw advances at `speed` times normal; two full cycles over one loop
  // at speed=1. We pass raw t_loop as the phase reference — paint() scales it.
  const t_phase = t_loop * speed;

  if(gui){
    gui.rows.get('drip')?._write(Math.round(animDrip));
    gui.rows.get('waveWidth')?._write(Math.round(animWave));
  }

  paint(animDrip, animWave, t_phase);
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
    redraw();
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
      name:   'wordart-liquid',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec:    document.querySelector('.wa-rec'),
    });
  }

  WAInteract.wire(cv, {
    onMove(ax, ay, px, py){
      if(!params.interactive || params.animate) return;
      mouseX = px; mouseY = py;
      params.drip      = ax * 80;
      params.waveWidth = Math.max(20, (1 - ay) * 300);
      gui?.rows.get('drip')?._write(Math.round(params.drip));
      gui?.rows.get('waveWidth')?._write(Math.round(params.waveWidth));
      schedule('paint');
    },
    onWheel(dy){
      params.drip = Math.max(0, Math.min(80, params.drip + dy * 0.05));
      gui?.rows.get('drip')?._write(Math.round(params.drip));
      if(!params.animate) schedule('paint');
    },
    onClick(){
      if(!params.animate){
        params.drip = Math.min(80, params.drip + 15);
        gui?.rows.get('drip')?._write(Math.round(params.drip));
        schedule('paint');
      }
    },
    onPinch(ratio){
      params.waveWidth = Math.max(20, Math.min(300, params.waveWidth * ratio));
      gui?.rows.get('waveWidth')?._write(Math.round(params.waveWidth));
      if(!params.animate) schedule('paint');
    },
  });

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
