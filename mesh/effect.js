// Mesh effect — text rasterised, then re-rendered through a sine-wave warp.
// We strip-copy from a clean text buffer to the canvas, shifting each row by
// amplitude · sin(2π · y · frequency / H + phase). Optional vertical warp
// shifts columns by ampY · sin(2π · x · frequency / W + phase).
//
// Strip copy with drawImage is constant-time per row in V8/Skia — no
// per-pixel JS loop, well under one frame for 1440×900.
//
// Animate: amplitude max → 0 → max + phase rotates 360°. Intro/outro IS the
// warp: the text settles flat at t=0.5 then dissolves into a wave again.
// Interactive: cursor X drives amplitude, cursor Y drives frequency.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// Mesh ANIM — fabric being pushed and pulled.
//   amplitude: 160 → 0 → 160  (cosine ease; t=0.5 is dead flat = legible)
//   ampY:      0 → 110 → 0 → 110 → 0  (sin² of 2t; peaks at t=0.25 / t=0.75)
//              orthogonal to amplitude so warp "circles" the legible moment
//   phase:     0 → 720°  (two full rotations; seamless: 720 ≡ 0)
//   frequency: 4 → 8 → 4  (slow breathe; seamless cosine)
// Pixel-diff frame-0 vs frame-N is exact: every curve returns to its rest value.
const ANIM = {
  amplitudePeak: 160, // at t=0 and t=1
  ampYPeak:      110, // at t=0.25 and t=0.75
  freqRest:        6,
  freqPeak:        14,
  phaseTurns:      2, // total rotations across one cycle
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  amplitude: 40,
  frequency: 6,
  phase: 0,
  ampY: 0,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'hello',
  textSize: 400,
  bold: true,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
// Two-stage: textBuf has clean text on transparent bg. midBuf gets
// horizontally-warped result; final canvas adds vertical warp from midBuf.
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');
const midBuf = document.createElement('canvas');
const xctx = midBuf.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

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
  for(const c of [cv, textBuf, midBuf]){
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

// Step size (CSS px) for the strip warp. Smaller = smoother curve; 2 px
// reads as continuous on Retina at 1× cost vs 1 px.
const STRIP_PX = 2;

function paint(){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const amp  = params.amplitude;
  const ampY = params.ampY;
  const freq = Math.max(0.1, params.frequency);
  const phaseR = params.phase * Math.PI / 180;

  // Stage 1: row-wise horizontal shift from textBuf → midBuf.
  xctx.save();
  xctx.setTransform(1, 0, 0, 1, 0, 0);
  xctx.clearRect(0, 0, midBuf.width, midBuf.height);
  const dpr = DPR;
  const Hcss = h;
  const stripBacking = STRIP_PX * dpr;
  if(amp > 0.1){
    for(let y = 0; y < midBuf.height; y += stripBacking){
      const yCss = y / dpr;
      const dx = amp * Math.sin(2 * Math.PI * freq * (yCss / Hcss) + phaseR);
      const sh = Math.min(stripBacking, midBuf.height - y);
      xctx.drawImage(textBuf, 0, y, textBuf.width, sh, dx * dpr, y, textBuf.width, sh);
    }
  } else {
    xctx.drawImage(textBuf, 0, 0);
  }
  xctx.restore();
  xctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Stage 2: paint bg, then column-wise vertical shift from midBuf → cv.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const Wcss = w;
  if(ampY > 0.1){
    for(let x = 0; x < cv.width; x += stripBacking){
      const xCss = x / dpr;
      const dy = ampY * Math.sin(2 * Math.PI * freq * (xCss / Wcss) + phaseR);
      const sw = Math.min(stripBacking, cv.width - x);
      ctx.drawImage(midBuf, x, 0, sw, midBuf.height, x, dy * dpr, sw, midBuf.height);
    }
  } else {
    ctx.drawImage(midBuf, 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  const TAU = Math.PI * 2;
  // Horizontal amplitude: cos shape, 160 at endpoints, 0 at t=0.5.
  // = peak * (1 + cos(2π t)) / 2  → seamless (cos is periodic).
  const amp = ANIM.amplitudePeak * (1 + Math.cos(TAU * t_loop)) / 2;
  // Vertical amplitude: sin² of 2t → 0 at t=0/0.5/1, peaks at t=0.25/0.75.
  // Orthogonal to amp — when fabric stops pulling sideways it tugs vertically,
  // then releases at the legible midpoint, then tugs vertically the other way.
  const s = Math.sin(TAU * t_loop); // sin(2π t), period 1 — seamless
  const ay = ANIM.ampYPeak * s * s;
  // Frequency breathes 4 → 8 → 4 on a cosine; smooth, seamless.
  const freq = (ANIM.freqRest + ANIM.freqPeak) / 2
             - (ANIM.freqPeak - ANIM.freqRest) / 2 * Math.cos(TAU * t_loop);
  // Phase: monotonic sweep, total turns × 360. Wraps cleanly at the end.
  const phase = (t_loop * 360 * ANIM.phaseTurns) % 360;

  params.amplitude = amp;
  params.ampY      = ay;
  params.frequency = freq;
  params.phase     = phase;

  if(gui){
    gui.rows.get('amplitude')?._write(amp);
    gui.rows.get('ampY')?._write(ay);
    gui.rows.get('frequency')?._write(freq);
    gui.rows.get('phase')?._write(phase);
  }
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
  params.amplitude = Math.round(ax * 240);
  params.frequency = Math.max(1, Math.round(1 + ay * 39));
  if(gui){
    gui.rows.get('amplitude')?._write(params.amplitude);
    gui.rows.get('frequency')?._write(params.frequency);
  }
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
      name: 'wordart-mesh',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  cv.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
