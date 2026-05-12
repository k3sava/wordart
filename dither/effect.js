// Dither effect — text is rasterised into an offscreen buffer, then sampled
// on a coarse grid of cells of size (pixelSize + pixelSpacing). A cell is a
// "foreground" cell when the texel at the top-left corner has luminance > 128
// in the raster. A separate random distortion mask drops a percentage of
// foreground cells back to background, producing the broken/dithered look.
// Rounded toggles squares vs. ellipses. Invert flips fg/bg. Interactive
// magnifies cells under the cursor inside a hover radius.
//
// Matches the type-tools.com/dither reference: same grid stride, same > 128
// threshold, same random-dropout dither (not Bayer / Floyd-Steinberg), same
// rounded-implies-min-spacing rule, same round() positioning.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const ANIMATION_DURATION = 1500; // ms per half-cycle (3s full ping-pong)
const ANIM_MIN = 25;
const ANIM_MAX = 100;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  pixelDistortion: 80 + Math.floor(Math.random() * 21), // 80..100
  pixelSize: 10,
  pixelSpacing: 0,
  rounded: Math.random() < 0.5,
  invert: Math.random() < 0.5,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'hello',
  textSize: 400,
  bold: false,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d', { willReadFrequently: true });

let gui;
let rasterSize = params.textSize;
let textPixels = null; // Uint8ClampedArray of textBuf
let distortionMap = null; // Uint8Array of bools (one byte per cell)
let distortionStride = 0; // cols at time of generation
let mouseX = 0, mouseY = 0;
const HOVER_RADIUS = 120;
const MAX_GROWTH  = 2;

let animationId = null;
let animationStartTime = 0;

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
    if(dirty.build)  buildDistortion();
    paint();
    dirty.raster = dirty.build = dirty.paint = false;
  });
}

function fitCanvas(){
  const w = cv.clientWidth || window.innerWidth;
  const h = cv.clientHeight || window.innerHeight;
  for(const c of [cv, textBuf]){
    if(c.width  !== w) c.width  = w;
    if(c.height !== h) c.height = h;
  }
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

function measureFit(text, size){
  tctx.font = fontSpec(size);
  return tctx.measureText(text).width;
}

function rasterizeText(){
  const w = textBuf.width, h = textBuf.height;
  tctx.clearRect(0, 0, w, h);
  // Shrink-to-fit at 92% canvas width — matches blur's discipline.
  const FIT = 0.92;
  let size = params.textSize;
  let measured = measureFit(params.text, size);
  const target = w * FIT;
  if(measured > target && measured > 0){
    size = Math.max(12, Math.floor(size * target / measured));
  }
  rasterSize = size;
  tctx.font = fontSpec(size);
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  tctx.imageSmoothingEnabled = false;
  tctx.fillText(params.text, w / 2, h / 2);
  textPixels = tctx.getImageData(0, 0, w, h).data;
}

// Random per-cell boolean mask. Cell (col,row) is kept iff random(0..100) <
// pixelDistortion. Layout matches the reference (rows × cols based on ceil
// over stride). Stored as a flat Uint8Array of 0/1.
function buildDistortion(){
  const stride = params.pixelSize + params.pixelSpacing;
  const w = textBuf.width, h = textBuf.height;
  const rows = Math.ceil(h / stride);
  const cols = Math.ceil(w / stride);
  distortionStride = cols;
  const n = rows * cols;
  if(!distortionMap || distortionMap.length !== n){
    distortionMap = new Uint8Array(n);
  }
  const th = params.pixelDistortion;
  for(let i = 0; i < n; i++){
    distortionMap[i] = (Math.random() * 100) < th ? 1 : 0;
  }
}

function hexToRgb(hex){
  const s = String(hex || '#000000').replace('#','');
  const v = s.length === 3 ? s.split('').map(c => c+c).join('') : s;
  return [parseInt(v.slice(0,2),16)||0, parseInt(v.slice(2,4),16)||0, parseInt(v.slice(4,6),16)||0];
}

function paint(){
  const w = cv.width, h = cv.height;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF';

  if(!textPixels) { ctx.restore(); return; }
  if(!distortionMap) buildDistortion();

  const ps = params.pixelSize;
  const sp = params.pixelSpacing;
  const stride = ps + sp;
  const rounded = params.rounded;
  const inv = params.invert;
  const interactive = params.interactive && !params.animate;

  let index = 0;
  for(let y = 0; y < h; y += stride){
    for(let x = 0; x < w; x += stride){
      // Sample the raster at the top-left of the cell (matches reference).
      const pi = (x + y * w) * 4;
      const isText = textPixels[pi] > 128;
      const draw = inv ? !isText : isText;
      if(draw && distortionMap[index]){
        let scale = 1;
        if(interactive){
          const cx = x + ps / 2;
          const cy = y + ps / 2;
          const dx = cx - mouseX, dy = cy - mouseY;
          const d = Math.sqrt(dx*dx + dy*dy);
          if(d < HOVER_RADIUS){
            // Same cosine remap the reference uses.
            scale = remap(Math.cos(d / HOVER_RADIUS * Math.PI), 1, -1, MAX_GROWTH, 1);
          }
        }
        const adj = Math.round(ps * scale);
        const px = Math.round(x + ps / 2 - adj / 2);
        const py = Math.round(y + ps / 2 - adj / 2);
        if(rounded){
          const cx = Math.round(x + ps / 2);
          const cy = Math.round(y + ps / 2);
          ctx.beginPath();
          ctx.ellipse(cx, cy, adj / 2, adj / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(px, py, adj, adj);
        }
      }
      index++;
    }
  }
  ctx.restore();
}

function remap(v, a, b, c, d){
  return c + (d - c) * ((v - a) / (b - a));
}

// Multi-pass cubic bezier ease — same shape as slice/blur. Lingers at endpoints.
function bezier1d(p0, p1, p2, p3, t){
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}
function heavyEase(t){
  let y = bezier1d(0, 0.02, 0.98, 1, t);
  y = bezier1d(0, 0, 1, 1, y);
  y = bezier1d(0, 0.01, 0.99, 1, y);
  y = bezier1d(0, 0, 1, 1, y);
  y = bezier1d(0, 0.01, 0.99, 1, y);
  return y;
}

function redraw(){
  rasterizeText();
  buildDistortion();
  paint();
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = (performance.now() - animationStartTime) % (ANIMATION_DURATION * 2);
  let progress = elapsed / ANIMATION_DURATION;
  if(progress >= 1) progress = 2 - progress;
  const eased = heavyEase(progress);
  // Animate pixelDistortion (primary, visible drop-in/out).
  params.pixelDistortion = Math.round(ANIM_MIN + eased * (ANIM_MAX - ANIM_MIN));
  if(gui && gui.rows.get('pixelDistortion')) gui.rows.get('pixelDistortion')._write(params.pixelDistortion);
  // Regenerate distortion every frame for the boiling-grain look.
  buildDistortion();
  if(dirty.raster){ rasterizeText(); dirty.raster = false; }
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

// Keys that require a fresh text raster. pixelSize/Spacing change the grid
// (so distortion needs rebuilding). pixelDistortion just rebuilds distortion.
// rounded/invert/bg are paint-only.
const RASTER_KEYS = new Set(['text','textSize','bold','italic']);
const BUILD_KEYS  = new Set(['pixelSize','pixelSpacing','pixelDistortion']);

function handleMouseMove(e){
  const r = cv.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
  if(params.interactive && !params.animate){
    // Mouse X drives pixelSize (1..20). Mouse Y drives pixelDistortion (0..100).
    const ax = Math.max(0, Math.min(1, mouseX / r.width));
    const ay = Math.max(0, Math.min(1, mouseY / r.height));
    const ns = Math.max(1, Math.round(1 + ax * 19));
    const nd = Math.round(ay * 100);
    let touched = false;
    if(ns !== params.pixelSize){ params.pixelSize = ns; touched = true; gui && gui.rows.get('pixelSize')?._write(ns); }
    if(nd !== params.pixelDistortion){ params.pixelDistortion = nd; touched = true; gui && gui.rows.get('pixelDistortion')?._write(nd); }
    if(touched){ schedule('build'); }
    else { schedule('paint'); } // repaint for hover magnification
  }
}

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    // Rounded forces min spacing of 1 (reference behaviour).
    if(key === 'rounded' && params.rounded && params.pixelSpacing < 1){
      params.pixelSpacing = 1;
      gui.rows.get('pixelSpacing')?._write(1);
      return; // the _write above will re-fire this handler with the spacing key
    }
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(RASTER_KEYS.has(key) || BUILD_KEYS.has(key)) dirty.build = true;
    if(params.animate) return; // anim loop owns the frame
    if(RASTER_KEYS.has(key)) schedule('raster');
    else if(BUILD_KEYS.has(key)) schedule('build');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-dither',
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
