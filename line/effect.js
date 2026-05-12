// Line effect — segment-walking stripes through a text mask.
//
// All geometry in CSS pixels; the canvas backing is `devicePixelRatio` × CSS
// so threshold edges and strokes render at the device's full resolution
// instead of being bilinear-upscaled from a 1× bitmap. This is the difference
// between "looks like a vector" and "looks like a screenshot of one".
//
// Algorithm:
//   1. Canvas filled with the background colour.
//   2. Text rasterised in white on a hidden buffer at the same backing scale.
//   3. For every parallel line at angle θ, spaced by (lineSize + lineSpacing):
//      Walk in steps of max(lineSize/2, 1) CSS px. At each step sample the
//      text mask (XOR invert). Build polylines that break at mask transitions.
//   4. Stroke every polyline in white at lineWidth = lineSize.
'use strict';

const STRIPED_ANIMALS = ["Zebra","Tiger","Okapi","Bongo","Quagga","Tapir","Numbat","Thylacine","Zonkey","Zorse","Quoll","Hyena","Serval","Civet","Caracal"];
const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const ANIMATION_DURATION = 15000;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  lineSize: 5 + Math.floor(Math.random() * 11),
  lineSpacing: 2,
  angle: pick([0, 45, 90, 135, 180]),
  animate: false,
  interactive: false,
  text: 'hello',
  textSize: 400,
  bold: false,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
  invert: Math.random() < 0.5,
  rounded: true,
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d', { willReadFrequently: true });

let lines = [];
let mouseX = -9999, mouseY = -9999;
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
    if(dirty.raster){ rasterizeText(); invalidateRaster(); }
    if(dirty.build){ buildLines(); }
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
  if(cv.width  !== bw) cv.width  = bw;
  if(cv.height !== bh) cv.height = bh;
  if(textBuf.width  !== bw) textBuf.width  = bw;
  if(textBuf.height !== bh) textBuf.height = bh;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function rasterizeText(){
  const w = cssW(), h = cssH();
  tctx.save();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, textBuf.width, textBuf.height);
  tctx.restore();
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const weight = params.bold ? 'bold' : 'normal';
  const style  = params.italic ? 'italic' : 'normal';
  const FIT = 0.92;
  let size = params.textSize;
  tctx.font = `${style} ${weight} ${size}px Helvetica`;
  const measured = tctx.measureText(params.text).width;
  if(measured > 0 && measured > w * FIT){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = `${style} ${weight} ${size}px Helvetica`;
  }
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
}

let cachedMask = null;
function invalidateRaster(){ cachedMask = null; }

function buildLines(){
  const w = cssW(), h = cssH();
  if(!cachedMask || cachedMask.width !== textBuf.width){
    // getImageData operates on backing pixels.
    cachedMask = tctx.getImageData(0, 0, textBuf.width, textBuf.height);
  }
  const data = cachedMask.data;
  const bw = textBuf.width;
  const bh = textBuf.height;

  const angleRad = params.angle * Math.PI / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const perpX = -dy;
  const perpY = dx;

  const diagonal = Math.sqrt(w * w + h * h);
  const stepSize = Math.max(params.lineSize / 2, 1);
  const lineGap  = params.lineSize + params.lineSpacing;
  const steps    = Math.max(1, Math.floor((diagonal * 2) / stepSize));
  const halfDiag = diagonal;
  const cx = w / 2, cy = h / 2;
  const invert = params.invert;

  lines = [];
  for(let d = -diagonal; d < diagonal; d += lineGap){
    const startX = cx + d * perpX - halfDiag * dx;
    const startY = cy + d * perpY - halfDiag * dy;
    const stepX  = dx * stepSize;
    const stepY  = dy * stepSize;

    let cur = null;
    let x = startX, y = startY;
    for(let i = 0; i < steps; i++, x += stepX, y += stepY){
      if(x < 0 || y < 0 || x >= w || y >= h){
        if(cur){ lines.push(cur); cur = null; }
        continue;
      }
      // Sample text mask in BACKING pixel coordinates.
      const px = (x * DPR) | 0;
      const py = (y * DPR) | 0;
      const idx = (py * bw + px) * 4;
      const isText = data[idx] > 128;
      const draw = invert ? !isText : isText;
      if(draw){
        if(!cur) cur = [];
        cur.push({ x, y });
      } else if(cur){
        lines.push(cur);
        cur = null;
      }
    }
    if(cur) lines.push(cur);
  }
}

function paint(){
  const w = cssW(), h = cssH();
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = params.lineSize;
  ctx.lineCap = params.rounded ? 'round' : 'butt';
  ctx.lineJoin = params.rounded ? 'round' : 'miter';
  ctx.beginPath();
  for(const line of lines){
    if(line.length < 2) continue;
    ctx.moveTo(line[0].x, line[0].y);
    for(let i = 1; i < line.length; i++){
      ctx.lineTo(line[i].x, line[i].y);
    }
  }
  ctx.stroke();
}

function redraw(){ rasterizeText(); invalidateRaster(); buildLines(); paint(); }

function animationLoop(){
  if(!params.animate) return;
  const elapsed = (performance.now() - animationStartTime) % ANIMATION_DURATION;
  const progress = elapsed / ANIMATION_DURATION;
  params.angle = progress * 180;
  gui.rows.get('angle')._write(params.angle);
  if(dirty.raster){ rasterizeText(); invalidateRaster(); dirty.raster = false; }
  buildLines();
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
  const r = cv.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
  if(!params.interactive || params.animate) return;
  const ax = Math.max(0, Math.min(1, mouseX / r.width));
  const ay = Math.max(0, Math.min(1, mouseY / r.height));
  params.angle    = Math.round(ax * 180);
  params.lineSize = Math.max(1, Math.round(1 + ay * 19));
  if(gui){
    gui.rows.get('angle')?._write(params.angle);
    gui.rows.get('lineSize')?._write(params.lineSize);
  }
  schedule('build');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);
const BUILD_KEYS  = new Set(['lineSize','lineSpacing','angle','invert']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)){ invalidateRaster(); dirty.raster = true; }
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else if(BUILD_KEYS.has(key)) schedule('build');
    else schedule('paint');
  });
  cv.addEventListener('mousemove', handleMouseMove);
  cv.addEventListener('mouseleave', () => { mouseX = mouseY = -9999; });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-line',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  window.addEventListener('resize', () => { fitCanvas(); invalidateRaster(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
