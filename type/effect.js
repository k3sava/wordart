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
  // Cell letters need to be substantially larger than the cell so adjacent
  // glyphs overlap and form solid coverage of the big-text shape — otherwise
  // the mosaic reads as faint ASCII art (gappy at the cell lattice).
  pixelSize: 15,
  letterSize: Math.floor(22 + Math.random() * 9), // 22..30 — fills + overlaps cells
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

  // Cell letters are drawn bold regardless of params.bold so the mosaic stays
  // legible — params.bold controls the big-text rasterisation, not the mosaic.
  ctx.font = `normal bold ${letterSize}px Helvetica`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const letterMetrics = ctx.measureText('M');
  const yOff = ((letterMetrics.actualBoundingBoxAscent ?? letterMetrics.fontBoundingBoxAscent ?? 0)
              - (letterMetrics.actualBoundingBoxDescent ?? letterMetrics.fontBoundingBoxDescent ?? 0)) / 2;

  // Letter-scroll animation: each cell's target letter is the input-string
  // character covering that x position. The scroll index runs A→Z over the
  // first half of the cycle and Z→A over the second half. A cell freezes
  // when the scroll index reaches its target letter — so all cells settle
  // at their targets simultaneously at the peak (progress = 1), giving a
  // brief moment where the word reads cleanly. On the way out, the scroll
  // reverses and every cell unwinds back toward A.
  // progress ∈ [0, 1] = pingpong t01 from renderAnimationFrame.
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // scrollIdx 0..26: 0 = show A, 26 = show target.
  const scrollIdx = progress * 26;

  for(let y = yStart; y < yEnd; y += pixelSize){
    for(let x = 0; x < w; x += pixelSize){
      const idx = (x + y * w) * 4;
      const isText = bufferPixels[idx] === 255;
      if(!isText) continue;

      const found = letterPositions.find(p => x >= p.start && x < p.end);
      const targetChar = found ? found.char : '';
      if(!targetChar) continue;
      const upper = targetChar.toUpperCase();
      const targetIdx = upper.charCodeAt(0) - 65;
      let displayChar;
      if(targetIdx < 0 || targetIdx > 25){
        // Non-letter target — show it once scroll passes its slot.
        displayChar = scrollIdx >= 13 ? targetChar : ALPHA[Math.min(25, Math.floor(scrollIdx))];
      } else {
        const cur = Math.min(targetIdx, Math.floor(scrollIdx));
        displayChar = ALPHA[cur];
        if(targetChar !== upper) displayChar = displayChar.toLowerCase();
      }

      ctx.fillStyle = '#ffffff';
      if(pixelSize < 10){
        ctx.fillRect(x, y, pixelSize, pixelSize);
      } else {
        ctx.fillText(displayChar, x + pixelSize / 2, y + pixelSize / 2 + yOff);
      }
    }
  }
}

function redraw(){
  rasterizeText();
  paint(currentTransition());
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

function renderAnimationFrame(t_loop){
  // pingpong 0→1→0 via sin envelope: peaks mid-cycle, returns exactly to 0
  // at both endpoints. sin(π·t_wrapped) is identically 0 at t=0 and t=1
  // (no float-precision drift from cos), so renderAt(0) and renderAt(1)
  // are pixel-identical and the MP4 loops seamlessly at 7.5s.
  const t_wrapped = ((t_loop % 1) + 1) % 1;
  const t01 = Math.sin(Math.PI * t_wrapped);
  rasterizeText();
  paint(t01);
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - (animationStartTime || performance.now());
  renderAnimationFrame((elapsed % 15000) / 15000);
  dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}
let animationStartTime = 0;

function toggleAnimation(){
  if(params.animate){
    animationStartTime = performance.now();
    animationLoop();
  } else if(animationId){
    cancelAnimationFrame(animationId);
    animationId = null;
    paint(currentTransition());
  }
}

window.WAEffect = {
  cycleMs: 15000,
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
  // Mouse X drives Pixel size (10–50). Mouse Y drives Letter size (10–50).
  params.pixelSize  = Math.round(10 + ax * 40);
  params.letterSize = Math.round(10 + ay * 40);
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
