// Blur effect — text rasterised char-by-char with custom letter spacing, then
// blurred via the browser's native gaussian filter, then thresholded into a
// crisp silhouette. The native filter is a true gaussian (σ = radius px in
// backing space); we render at devicePixelRatio backing so the threshold edge
// lands at sub-CSS-pixel resolution and reads as a vector silhouette on
// Retina rather than a 1-bit bitmap.
//
// Animate: ping-pongs blurAmount between 4 and 28 over 3 s with a heavy ease.
// Interactive: mouse X drives blurAmount, mouse Y drives letterSpacing.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const ANIMATION_DURATION = 1500;
const ANIM_MIN = 4;
const ANIM_MAX = 28;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  blurAmount: 10,
  letterSpacing: -40,
  invert: false,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'hello',
  textSize: 400,
  bold: true,
  italic: Math.random() < 0.5,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');
const blurBuf = document.createElement('canvas');
const bctx = blurBuf.getContext('2d', { willReadFrequently: true });

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

const dirty = { raster:false, build:false, paint:false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  if(level === 'raster' || level === 'build') dirty.build = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster) rasterizeText();
    if(dirty.build)  buildBlur();
    paint();
    dirty.raster = dirty.build = dirty.paint = false;
  });
}

function cssW(){ return cv.clientWidth || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf, blurBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function measureSpaced(text, size){
  tctx.font = fontSpec(size);
  let total = 0;
  for(const ch of text) total += tctx.measureText(ch).width + params.letterSpacing;
  return total - params.letterSpacing;
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
  let measured = measureSpaced(params.text, size);
  const target = w * FIT;
  if(measured > target && measured > 0){
    size = Math.max(12, Math.floor(size * target / measured));
    measured = measureSpaced(params.text, size);
  }
  tctx.font = fontSpec(size);
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  let x = w / 2 - measured / 2;
  const y = h / 2;
  for(const ch of params.text){
    const cw = tctx.measureText(ch).width;
    tctx.fillText(ch, x + cw / 2, y);
    x += cw + params.letterSpacing;
  }
}

// Native gaussian blur via ctx.filter — true Gaussian σ in backing pixels.
// We multiply by DPR so the σ specified in params.blurAmount is interpreted
// in CSS px, giving stable visual blur radius across display densities.
function buildBlur(){
  const w = cssW(), h = cssH();
  const radius = Math.max(0, params.blurAmount);
  bctx.save();
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, blurBuf.width, blurBuf.height);
  bctx.filter = radius > 0 ? `blur(${radius * DPR}px)` : 'none';
  bctx.drawImage(textBuf, 0, 0);
  bctx.filter = 'none';
  bctx.restore();
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function hexToRgb(hex){
  const m = /^#?([a-f0-9]{6})$/i.exec(hex);
  if(!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function paint(){
  const bw = blurBuf.width, bh = blurBuf.height;
  // Pull blurred pixels at full backing resolution, threshold them, paint
  // result onto cv at backing res too.
  const img = bctx.getImageData(0, 0, bw, bh);
  const px = img.data;
  const [br, bgC, bb] = hexToRgb(params.bg);
  const TH = 128;
  const inv = params.invert;
  for(let i = 0; i < px.length; i += 4){
    const a = px[i + 3];
    const lum = a < 8 ? 0 : (px[i] + px[i + 1] + px[i + 2]) / 3;
    const isWhite = inv ? (lum < TH) : (lum >= TH);
    if(isWhite){
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
    } else {
      px[i] = br;  px[i + 1] = bgC; px[i + 2] = bb;
    }
    px[i + 3] = 255;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); buildBlur(); paint(); }

// Multi-pass cubic-bezier ease — same as slice's heavyEase.
function bezier1d(p0, p1, p2, p3, t){ const u = 1 - t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; }
function heavyEase(t){
  let y = bezier1d(0, 0.02, 0.98, 1, t);
  y = bezier1d(0, 0, 1, 1, y);
  y = bezier1d(0, 0.01, 0.99, 1, y);
  y = bezier1d(0, 0, 1, 1, y);
  y = bezier1d(0, 0.01, 0.99, 1, y);
  return y;
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = (performance.now() - animationStartTime) % (ANIMATION_DURATION * 2);
  let progress = elapsed / ANIMATION_DURATION;
  if(progress >= 1) progress = 2 - progress;
  const eased = heavyEase(progress);
  params.blurAmount = Math.round(ANIM_MIN + eased * (ANIM_MAX - ANIM_MIN));
  if(gui) gui.rows.get('blurAmount')?._write(params.blurAmount);
  if(dirty.raster){ rasterizeText(); dirty.raster = false; }
  buildBlur();
  paint();
  dirty.build = dirty.paint = false;
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

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  params.blurAmount    = Math.max(1, Math.round(1 + ax * 39));
  params.letterSpacing = Math.round(-50 + ay * 150);
  if(gui){
    gui.rows.get('blurAmount')?._write(params.blurAmount);
    gui.rows.get('letterSpacing')?._write(params.letterSpacing);
  }
  dirty.raster = true;
  schedule('raster');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic','letterSpacing']);
const BUILD_KEYS  = new Set(['blurAmount']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(RASTER_KEYS.has(key) || BUILD_KEYS.has(key)) dirty.build = true;
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else if(BUILD_KEYS.has(key)) schedule('build');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-blur',
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
