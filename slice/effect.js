// Slice effect — text rasterised once, then redrawn as N horizontal bands,
// each blitted with a horizontal offset so the slices fan out from centre.
//
// For slice i in [0, splits):
//   xOff = floor(i * offset - totalOffset / 2) / textStretch
//   yPos = floor(-textHeight/2 + i * splitHeight)
//   source band = the same horizontal slice in the un-shifted text buffer
//   blit source → destination, both relative to canvas centre,
//   with a horizontal scale of textStretch applied around the centre.
//
// Animate ping-pongs the offset between -50 and +50 over a 2 s cycle, with
// a multi-pass cubic-bezier ease so the slices linger at the extremes.
'use strict';

const SPEEDY_ANIMALS = ["Cheetah","Falcon","Sailfish","Marlin","Gazelle","Hare","Ostrich","Lion","Leopard"];
const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// Full oscillation through both signs over the cycle:
//   t=0    : offset = +amplitude (bands fanned right)
//   t=0.25 : offset = 0           (text crisp — first reveal)
//   t=0.5  : offset = -amplitude (bands fanned LEFT)
//   t=0.75 : offset = 0           (text crisp again — second reveal)
//   t=1    : offset = +amplitude (loops cleanly)
// Two reveals per cycle, bands sweep through both fan directions.
const ANIM = {
  offsetAmp:   60,            // peak |offset| during oscillation
  splits:      { rest: 10, peak: 10 },
  textStretch: { rest: 1,  peak: 1 },
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pingpongT(elapsed){ return (1 - Math.cos((elapsed % CYCLE_MS) / CYCLE_MS * Math.PI * 2)) / 2; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  splits: 5 + Math.floor(Math.random() * 26),
  offset: Math.random() < 0.5 ? -15 : 15,
  showSplitLines: false,
  textStretch: 1,
  animate: false,
  interactive: false,
  text: 'hello',
  textSize: 400,
  bold: Math.random() < 0.5,
  italic: Math.random() < 0.5,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let textMetricsCache = null;

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

function fitCanvas(){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = cv.clientWidth || window.innerWidth;
  const h = cv.clientHeight || window.innerHeight;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if(cv.width !== bw) cv.width = bw;
  if(cv.height !== bh) cv.height = bh;
  if(textBuf.width !== bw) textBuf.width = bw;
  if(textBuf.height !== bh) textBuf.height = bh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  tctx.imageSmoothingEnabled = true;
}

function fontSpec(p){
  const w = p.bold ? 'bold' : 'normal';
  const s = p.italic ? 'italic' : 'normal';
  return `${s} ${w} ${p.textSize}px Helvetica`;
}

function rasterizeText(){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = cv.clientWidth || window.innerWidth;
  const h = cv.clientHeight || window.innerHeight;
  // Clear in backing space.
  tctx.save();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, textBuf.width, textBuf.height);
  tctx.restore();
  const weight = params.bold ? 'bold' : 'normal';
  const style  = params.italic ? 'italic' : 'normal';
  const size = params.textSize;
  tctx.font = `${style} ${weight} ${size}px Helvetica`;
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
  const m = tctx.measureText(params.text);
  textMetricsCache = {
    width: m.width,
    height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    dpr,
    w, h,
  };
}

function applyAnimationT(t01, t_loop){
  const ang = (t_loop || 0) * Math.PI * 2;
  // Offset oscillates +amp → 0 → -amp → 0 → +amp via cosine. Text reads
  // crisply at t=0.25 and t=0.75 (when offset crosses zero) and bands fan
  // to both sides between. No axis rotation — the text needs to be upright
  // when it reaches its legible moment.
  const o = ANIM.offsetAmp * Math.cos(ang);
  const s = lerp(ANIM.splits.rest, ANIM.splits.peak, t01);
  const stretch = lerp(ANIM.textStretch.rest, ANIM.textStretch.peak, t01);
  if(gui){
    gui.rows.get('offset')?._write(o);
    gui.rows.get('splits')?._write(s);
    gui.rows.get('textStretch')?._write(stretch);
  }
  params.offset = o;
  params.splits = Math.max(2, Math.floor(s));
  params.textStretch = stretch;
}

function paint(){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = cv.clientWidth || window.innerWidth;
  const h = cv.clientHeight || window.innerHeight;
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  if(!textMetricsCache) return;
  const tw = textMetricsCache.width;
  const th = textMetricsCache.height;
  const splitH = Math.floor(th / params.splits);
  if(splitH <= 0) return;
  const totalOff = params.offset * (params.splits - 1);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(params.textStretch, 1);

  // Source band positions in BACKING pixels (drawImage source is unscaled).
  const srcXBase = Math.floor((w / 2 - tw / 2) * dpr);
  const srcYBase = Math.floor((h / 2 - th / 2) * dpr);
  const sBandW = Math.floor(tw * dpr);
  const sSplitH = Math.floor(splitH * dpr);

  const last = params.splits - 1;
  const dBandW = Math.floor(tw);
  for(let i = 0; i < params.splits; i++){
    const xOff = Math.floor(i * params.offset - totalOff / 2) / params.textStretch;
    const yPos = Math.floor(-th / 2 + i * splitH);
    const sx = srcXBase;
    const sy = srcYBase + i * sSplitH;
    const dx = Math.floor(-tw / 2 + xOff);
    const dy = yPos;
    ctx.drawImage(textBuf, sx, sy, sBandW, sSplitH, dx, dy, dBandW, splitH);
    if(params.showSplitLines && i > 0){
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-tw / 2, yPos);
      ctx.lineTo(tw / 2, yPos);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function redraw(){
  rasterizeText();
  paint();
}

function renderAnimationFrame(t_loop){
  const t01 = (1 - Math.cos(t_loop * 2 * Math.PI)) / 2;
  applyAnimationT(t01, t_loop);
  rasterizeText();
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


const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  // Mouse X drives Offset (-50..+50). Mouse Y drives Text stretch (0.25..1.75).
  params.offset      = Math.round((ax - 0.5) * 100);
  params.textStretch = +(0.25 + ay * 1.5).toFixed(2);
  if(gui){
    gui.rows.get('offset')?._write(params.offset);
    gui.rows.get('textStretch')?._write(params.textStretch);
  }
  schedule('paint');
}

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(params.animate) return; // animation loop picks up dirty.raster on next tick
    if(RASTER_KEYS.has(key)) schedule('raster'); else schedule('paint');
  });
  cv.addEventListener('mousemove', handleMouseMove);
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-slice',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
