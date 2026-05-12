// Type effect — big text is rasterised in white into an offscreen buffer.
// A grid of `pixelSize`-spaced sample points is walked. Each cell whose
// sample falls on a "text" pixel is filled with a tiny letter at `letterSize`.
// The tiny letter is the source-text character whose horizontal span the
// cell's x-coordinate falls within, so the big word reads as a mosaic of
// itself. Invert flips the mask and expands the sampling region to the full
// canvas (small letters fill the negative space). Animate sine-eases the
// invert transition over 3s and stochastically swaps each cell's letter for
// a random A–Z glyph during the cross-fade.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const ANIM_PERIOD = 3000; // full sine cycle

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  pixelSize: 15,
  letterSize: Math.floor(10 + Math.random() * 11), // 10..20
  invert: false,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'Colony',
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
let animationId = null;
let bufferPixels = null; // Uint8ClampedArray cache of textBuf
let letterPositions = []; // [{char, start, end}]
let bigTextWidth = 0;
let bigTextHeight = 0;

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
    paint(currentTransition());
    dirty.raster = dirty.paint = false;
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

function fontNameFor(){
  if(params.bold && params.italic) return 'Helvetica';
  if(params.bold) return 'Helvetica';
  if(params.italic) return 'Helvetica';
  return 'Helvetica';
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// p5's textAlign(CENTER, CENTER) draws at alphabetic baseline with a y-offset
// of (ascent - descent)/2 from the centerline. Canvas's `middle` baseline is
// close but font-metric-dependent — we replicate p5 explicitly for parity.
function p5CenterY(metrics, centerY){
  const a = metrics.actualBoundingBoxAscent ?? metrics.fontBoundingBoxAscent ?? 0;
  const d = metrics.actualBoundingBoxDescent ?? metrics.fontBoundingBoxDescent ?? 0;
  return centerY + (a - d) / 2;
}

function rasterizeText(){
  const w = textBuf.width, h = textBuf.height;
  tctx.clearRect(0, 0, w, h);
  tctx.font = fontSpec(params.textSize);
  tctx.textAlign = 'center';
  tctx.textBaseline = 'alphabetic';
  tctx.fillStyle = '#FFFFFF';
  const m = tctx.measureText(params.text);
  tctx.fillText(params.text, w / 2, p5CenterY(m, h / 2));

  // Precompute per-letter horizontal spans (matches ref: native textWidth,
  // letters laid out left-aligned starting at (w - totalWidth)/2).
  tctx.font = fontSpec(params.textSize);
  const total = tctx.measureText(params.text).width;
  bigTextWidth = total;
  bigTextHeight = params.textSize;
  let cx = (w - total) / 2;
  letterPositions = [];
  for(const ch of params.text){
    const cw = tctx.measureText(ch).width;
    letterPositions.push({ char: ch.toUpperCase(), start: cx, end: cx + cw });
    cx += cw;
  }
  bufferPixels = tctx.getImageData(0, 0, w, h).data;
}

function currentTransition(){
  if(params.animate){
    const t = performance.now();
    return (Math.sin(2 * Math.PI * t / ANIM_PERIOD) + 1) / 2;
  }
  return params.invert ? 1 : 0;
}

function paint(progress){
  const w = cv.width, h = cv.height;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if(!bufferPixels) return;

  const pixelSize = Math.max(1, Math.floor(params.pixelSize));
  const letterSize = params.letterSize;
  const startX = (w - bigTextWidth) / 2;
  const startY = (h - bigTextHeight) / 2;

  // Sampling y-range. Mirrors ref: when animating OR invert, sweep full
  // canvas (since negative space gets filled). Otherwise just the glyph band.
  let yStart, yEnd;
  if(params.animate || params.invert){
    yStart = 0;
    yEnd = h;
  } else {
    yStart = startY;
    yEnd = startY + bigTextHeight;
  }
  yStart = Math.max(0, Math.floor(yStart));
  yEnd   = Math.min(h, Math.ceil(yEnd));

  ctx.font = fontSpec(letterSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const letterMetrics = ctx.measureText('M');
  const yOff = ((letterMetrics.actualBoundingBoxAscent ?? letterMetrics.fontBoundingBoxAscent ?? 0)
              - (letterMetrics.actualBoundingBoxDescent ?? letterMetrics.fontBoundingBoxDescent ?? 0)) / 2;

  // Cache for letter lookups by x — small win since rows reuse the same x's.
  for(let y = yStart; y < yEnd; y += pixelSize){
    for(let x = 0; x < w; x += pixelSize){
      const idx = (x + y * w) * 4;
      const isText = bufferPixels[idx] === 255;
      const normal = isText ? 1 : 0;
      const inverted = isText ? 0 : 1;
      const alpha = normal + (inverted - normal) * progress;
      if(alpha <= 0.001) continue;

      // During cross-fade, swap to random A–Z with probability (progress).
      let letter;
      if(Math.random() > progress){
        const found = letterPositions.find(p => x >= p.start && x < p.end);
        letter = found ? found.char : ' ';
      } else {
        letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      }

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      if(pixelSize < 10){
        ctx.fillRect(x, y, pixelSize, pixelSize);
      } else {
        ctx.fillText(letter, x + pixelSize / 2, y + pixelSize / 2 + yOff);
      }
    }
  }
}

function redraw(){
  rasterizeText();
  paint(currentTransition());
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

function animationLoop(){
  if(!params.animate) return;
  if(dirty.raster){ rasterizeText(); dirty.raster = false; }
  paint(currentTransition());
  dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}

function toggleAnimation(){
  if(params.animate){
    animationLoop();
  } else if(animationId){
    cancelAnimationFrame(animationId);
    animationId = null;
    paint(currentTransition());
  }
}

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  // Mouse X drives Pixel size (10–50). Mouse Y drives Letter size (10–20).
  params.pixelSize  = Math.round(10 + ax * 40);
  params.letterSize = Math.round(10 + ay * 10);
  if(gui){
    gui.rows.get('pixelSize')?._write(params.pixelSize);
    gui.rows.get('letterSize')?._write(params.letterSize);
  }
  schedule('paint');
}

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
      name: 'wordart-type',
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
