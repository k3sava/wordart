// Outline effect — text is drawn N+1 times using strokeText() at increasing
// lineWidths, from outermost to innermost. Each successive ring paints over
// the centre of the ring before it, producing concentric coloured bands
// visible around the glyph paths. The innermost ring is the tightest stroke;
// an optional filled pass covers the glyph interior with white.
//
// Animation: hueBase rotates continuously (full 360° per hueTurns, seamless
// because hue is periodic mod 360°). ringGap breathes via a cosine shape —
// wide at t=0/1, narrow at t=0.5 — so rings pulse in then out.
// Interactive: mouse X drives hueBase (colour wheel), mouse Y drives ringGap
// (ring density).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  hueTurns:   1,   // full hue rotation per cycle — seamless: 360° === 0°
  ringGapMax: 22,  // widest gap during the breath
  ringGapMin:  3,  // narrowest gap during the breath
};

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t){ return a + (b - a) * t; }

const params = {
  rings:      3 + Math.floor(Math.random() * 4),          // 3..6
  innerWidth: 2,
  ringGap:    8 + Math.floor(Math.random() * 8),           // 8..15
  hueShift:   30 + Math.floor(Math.random() * 60),         // hue per ring
  hueBase:    Math.floor(Math.random() * 360),             // starting hue
  filled:     true,
  animate:    false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('heavy') : 'ring',
  textSize:   400,
  bold:       true,
  italic:     false,
  bg:         pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv      = document.getElementById('cv');
const ctx     = cv.getContext('2d');
// textBuf is used only for size measurement — no pixel reads required.
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d');

let gui;
let DPR = 1;
let computedSize = params.textSize;

let animationId        = null;
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

function cssW(){ return cv.clientWidth  || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  if(cv.width  !== bw) cv.width  = bw;
  if(cv.height !== bh) cv.height = bh;
  if(textBuf.width  !== bw) textBuf.width  = bw;
  if(textBuf.height !== bh) textBuf.height = bh;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// Measure text at target size and shrink-fit to 92% of canvas width.
// Updates the module-level computedSize; no pixel rasterization needed.
function rasterizeText(){
  const w = cssW();
  const FIT = 0.92;
  let size = params.textSize;
  tctx.font = fontSpec(size);
  const measured = tctx.measureText(params.text).width;
  if(measured > 0 && measured > w * FIT){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
  }
  computedSize = size;
}

function paint(overrideHueBase, overrideRingGap){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const hb = (overrideHueBase != null) ? overrideHueBase : params.hueBase;
  const rg = (overrideRingGap != null) ? overrideRingGap : params.ringGap;
  const rings = Math.round(params.rings);
  const iw    = Math.max(1, params.innerWidth);

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Background fill
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.font        = fontSpec(computedSize);
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin    = 'round';

  // Draw outermost ring first (i = rings) down to innermost (i = 0).
  // Each ring's stroke covers the centre of the ring drawn before it,
  // leaving only the visible coloured band at the edge.
  for(let i = rings; i >= 0; i--){
    const lineWidth = iw + i * rg;
    const hue       = ((hb + i * params.hueShift) % 360 + 360) % 360;
    const lightness = Math.min(75, 50 + i * (20 / Math.max(1, rings)));
    ctx.save();
    ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`;
    ctx.lineWidth   = lineWidth;
    ctx.strokeText(params.text, w / 2, h / 2);
    ctx.restore();
  }

  // Optionally fill the glyph interior white (paints over the innermost
  // stroke centre so the glyph reads as solid white with coloured rings).
  if(params.filled){
    ctx.fillStyle = '#ffffff';
    ctx.fillText(params.text, w / 2, h / 2);
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // hueBase rotates by hueTurns × 360° over the cycle — seamless because
  // hue is periodic mod 360°, so the value at t=1 equals the value at t=0.
  const hb = (t_loop * 360 * ANIM.hueTurns) % 360;

  // ringGap breathes via a raised cosine: 1 at t=0 and t=1, 0 at t=0.5.
  // This means rings are widest at the loop endpoints and narrowest at the
  // midpoint — they pulse in, compress, then expand back out.
  const cosShape = (1 + Math.cos(t_loop * 2 * Math.PI)) / 2;
  const rg = ANIM.ringGapMin + cosShape * (ANIM.ringGapMax - ANIM.ringGapMin);

  params.hueBase = hb;
  params.ringGap = rg;

  if(gui){
    gui.rows.get('hueBase')?._write(hb);
    gui.rows.get('ringGap')?._write(rg);
  }

  paint(hb, rg);
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

  params.hueBase = Math.round(ax * 360);
  params.ringGap = Math.max(2, Math.round(2 + ay * 22));

  if(gui){
    gui.rows.get('hueBase')?._write(params.hueBase);
    gui.rows.get('ringGap')?._write(params.ringGap);
  }
  schedule('paint');
}

// Only text/typography changes require a re-measure. All visual params
// (ring count, gaps, hues, fill) are paint-only — no rasterization needed.
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
      name:    'wordart-outline',
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
