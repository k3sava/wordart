// Halftone effect — text rasterised as a B&W mask, then re-rendered as a grid
// of circular dots. Each dot's radius scales with the LOCAL coverage of the
// text mask inside its cell, optionally box-blurred ("softness") so the dot
// radius reflects soft edges. A screen-angle rotates the dot grid in the
// classic offset-print fashion.
//
// Animate: dotScale ping-pongs 0 → max → 0, so text "resolves" out of dust
// and dissolves back. screenAngle also drifts. Intro/outro IS the effect.
// Interactive: cursor X drives cellSize, cursor Y drives screenAngle.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// Halftone-native animation. Three+ params move together over a seamless 15s
// loop (frame 0 == frame N exactly for deterministic params).
//
//   screenAngle  monotonic 0 → 360°. A rotating dot screen is the signature
//                of offset printing; one full revolution per loop closes
//                seamlessly because 0° and 360° are the same grid.
//   dotScale     sin(πt) * peak — vanishes at t=0 and t=1 (loop closes),
//                peaks at t=0.5 where the text "resolves" out of dust.
//   cellSize     coarse → fine → coarse via cos(2πt). Returns to start.
//                Coarse cells = crude rosette; fine = legible photoplate.
//   softness     gentle breathe via cos(2πt); returns to start. Softer
//                edges at peak give the dot radii a tonal gradient.
//   gridOffset   tiny radial drift (cos(2πt), sin(2πt)) * GRID_DRIFT_PX —
//                a full circle, so the pattern "walks" but lands home.
//
// Legibility moment lives near t≈0.5: dotScale peaks (full radius), cellSize
// hits its fine minimum, screenAngle passes through 180° (a flipped but
// re-aligned grid). Text is readable through the dots there.
const ANIM = {
  dotScale:    { peak: 130 },              // sin(πt) * peak
  cellSizeMid: 10,                          // mean cell size in px
  cellSizeAmp: 6,                           // ± px swing via cos(2πt)
  softnessMid: 4,                           // mean softness px
  softnessAmp: 4,                           // ± px swing
  screenSpins: 1,                           // full revolutions per loop
  gridDriftPx: 6,                           // grid origin orbit radius
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  cellSize: 12,
  dotScale: 110,
  screenAngle: 15,
  softness: 6,
  invert: false,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'hello',
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
const maskBuf = document.createElement('canvas');
const mctx = maskBuf.getContext('2d', { willReadFrequently: true });

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;
let maskData = null;

const dirty = { raster:false, mask:false, paint:false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  if(level === 'raster' || level === 'mask') dirty.mask = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster) rasterizeText();
    if(dirty.mask)   buildMask();
    paint();
    dirty.raster = dirty.mask = dirty.paint = false;
  });
}

function cssW(){ return cv.clientWidth || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf, maskBuf]){
    if(c.width !== bw) c.width = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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

function buildMask(){
  // Soft-edged mask: optional gaussian blur for dot-radius gradient at strokes.
  mctx.save();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, maskBuf.width, maskBuf.height);
  if(params.softness > 0){
    mctx.filter = `blur(${params.softness * DPR}px)`;
  }
  mctx.drawImage(textBuf, 0, 0);
  mctx.filter = 'none';
  mctx.restore();
  mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  maskData = mctx.getImageData(0, 0, maskBuf.width, maskBuf.height);
}

function hexToRgb(hex){
  const m = /^#?([a-f0-9]{6})$/i.exec(hex);
  if(!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function luma(r,g,b){ return r*0.299 + g*0.587 + b*0.114; }

function paint(){
  const w = cssW(), h = cssH();
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  if(!maskData) return;

  const [br, bgC, bb] = hexToRgb(params.bg);
  // Choose dot colour = white if bg is darker than midgrey, else black.
  const bgLum = luma(br, bgC, bb);
  const dotColor = bgLum < 128 ? '#FFFFFF' : '#000000';
  ctx.fillStyle = dotColor;

  const cell = Math.max(2, params.cellSize);
  const angle = params.screenAngle * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = w / 2 + (params._gridDx || 0), cy = h / 2 + (params._gridDy || 0);
  // Diagonal of canvas — covers the rotated grid fully.
  const diag = Math.hypot(w, h);
  const cols = Math.ceil(diag / cell) + 2;
  const startU = -cols * cell / 2;
  const bw = maskBuf.width;
  const data = maskData.data;
  const dpr = DPR;
  const inv = params.invert;
  const maxR = (cell / 2) * (params.dotScale / 100);
  if(maxR <= 0.2) return;

  // For sampling, take a ~3-px stride inside each cell — coverage estimate.
  const sampleStep = Math.max(2, Math.floor(cell * dpr / 4));

  for(let iv = 0; iv < cols; iv++){
    const v = startU + iv * cell;
    for(let iu = 0; iu < cols; iu++){
      const u = startU + iu * cell;
      // Rotate grid → canvas space.
      const x = cx + u * cos - v * sin;
      const y = cy + u * sin + v * cos;
      if(x < -cell || y < -cell || x >= w + cell || y >= h + cell) continue;

      // Sample a small square in mask space for coverage.
      const sx0 = Math.max(0, Math.floor((x - cell/2) * dpr));
      const sy0 = Math.max(0, Math.floor((y - cell/2) * dpr));
      const sx1 = Math.min(bw - 1, Math.floor((x + cell/2) * dpr));
      const sy1 = Math.min(maskBuf.height - 1, Math.floor((y + cell/2) * dpr));
      if(sx1 <= sx0 || sy1 <= sy0) continue;
      let sum = 0, n = 0;
      for(let sy = sy0; sy <= sy1; sy += sampleStep){
        const row = sy * bw * 4;
        for(let sx = sx0; sx <= sx1; sx += sampleStep){
          sum += data[row + sx * 4 + 3]; // alpha channel
          n++;
        }
      }
      if(n === 0) continue;
      let cov = (sum / n) / 255;
      if(inv) cov = 1 - cov;
      if(cov <= 0.01) continue;
      const r = Math.min(maxR, maxR * Math.sqrt(cov));
      if(r < 0.3) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function redraw(){ rasterizeText(); buildMask(); paint(); }

function applyAnimationT(t_loop){
  // Wrap t into [0,1) so renderAt(1.0) == renderAt(0.0) exactly.
  const t = ((t_loop % 1) + 1) % 1;
  const TAU = Math.PI * 2;

  // dotScale: sin(πt) → 0 at endpoints, 1 at t=0.5. Seamless.
  const ds = ANIM.dotScale.peak * Math.sin(Math.PI * t);

  // screenAngle: monotonic 0→360 (one rosette revolution per loop).
  const sa = (t * 360 * ANIM.screenSpins) % 360;

  // cellSize: cos(2πt) breathes coarse(t=0,1) → fine(t=0.5) → coarse.
  // Mid - amp at t=0.5 gives the fine cell when dotScale peaks → legible.
  const cs = ANIM.cellSizeMid - ANIM.cellSizeAmp * Math.cos(TAU * t);

  // Grid origin drift: a full circle, returns home at t=1.
  params._gridDx = ANIM.gridDriftPx * Math.cos(TAU * t);
  params._gridDy = ANIM.gridDriftPx * Math.sin(TAU * t);

  if(gui){
    gui.rows.get('dotScale')?._write(ds);
    gui.rows.get('screenAngle')?._write(sa);
    gui.rows.get('cellSize')?._write(cs);
  }
  params.dotScale = ds;
  params.screenAngle = sa;
  params.cellSize = cs;
}

function renderAnimationFrame(t_loop){
  applyAnimationT(t_loop);
  paint();
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  renderAnimationFrame((elapsed % CYCLE_MS) / CYCLE_MS);
  dirty.raster = dirty.mask = dirty.paint = false;
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
  renderAt(t_loop){
    if(!maskData){ rasterizeText(); buildMask(); }
    renderAnimationFrame(t_loop);
  },
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
  params.cellSize    = Math.max(6, Math.round(6 + ax * 34));
  params.screenAngle = Math.round(ay * 90);
  if(gui){
    gui.rows.get('cellSize')?._write(params.cellSize);
    gui.rows.get('screenAngle')?._write(params.screenAngle);
  }
  schedule('paint');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);
const MASK_KEYS   = new Set(['softness']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(RASTER_KEYS.has(key) || MASK_KEYS.has(key)) dirty.mask = true;
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else if(MASK_KEYS.has(key)) schedule('mask');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-halftone',
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
