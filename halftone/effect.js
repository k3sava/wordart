// Halftone effect — text rasterised as a B&W mask, then re-rendered as a grid
// of circular dots. Each dot's radius scales with the LOCAL coverage of the
// text mask inside its cell, optionally box-blurred ("softness") so the dot
// radius reflects soft edges. A screen-angle rotates the dot grid in the
// classic offset-print fashion.
//
// Animate: 30s wow moments with keyframed dot size, angle sweeps, and pulses.
// Interactive: cursor X drives cellSize, cursor Y drives screenAngle.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
// Halftone-native animation. Three+ params move together over a seamless 30s
// loop (frame 0 == frame N exactly for deterministic params).
const ANIM = {
  dotScale:    { peak: 130 },
  cellSizeMid: 10,
  cellSizeAmp: 6,
  softnessMid: 4,
  softnessAmp: 4,
  screenSpins: 1,
  gridDriftPx: 6,
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
// Keyframe interpolator: stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

const params = {
  cellSize: 12,
  dotScale: 110,
  screenAngle: 15,
  softness: 6,
  invert: false,
  animate: false,
  interactive: false,
  text: 'tell them that',
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
  window.WAGUI?.flashValues(params);
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

function renderAnimationFrame(t_loop){
  const t = ((t_loop % 1) + 1) % 1;
  const TAU = Math.PI * 2;

  // dotScale: keyframed for wow moments.
  // Fine text at start → grow → Lichtenstein huge → pulse → settle.
  const ds = kf(t, [
    [0.00,  40],   // small dots, fine grid — text sharp
    [0.15,  80],   // dots growing
    [0.25, 130],   // WOW #1: HUGE dots, Roy Lichtenstein scale
    [0.35, 130],   // still huge while angle sweeps
    [0.45, 130],   // WOW #2: huge + max softness — psychedelic
    [0.55,  60],   // shrinking while rotating
    [0.65,  40],   // fine again at different angle
    [0.70,  20],   // rapid pulse start: go small
    [0.72, 130],   // WOW #3: pulse out
    [0.74,  10],   // pulse in
    [0.76, 130],   // pulse out
    [0.78,  10],   // pulse in
    [0.80, 100],   // settle
    [0.85,  70],
    [1.00,  40],   // back to start
  ]);

  // screenAngle: monotonic sweep for continuous rotation during wow window,
  // then fast sweep, then settle.
  const sa = kf(t, [
    [0.00,   0],   // start angle
    [0.25,  15],   // small drift before WOW #1
    [0.35,  90],   // continuous rotation through WOW #1/2 window
    [0.55, 180],   // rotating through
    [0.65, 225],   // different angle for fine grid section
    [0.70, 270],   // WOW #3 rapid oscillation base angle
    [0.80, 360],   // fast sweep
    [1.00, 360],   // seamless (0 == 360)
  ]);

  // cellSize: coarse→fine→coarse.
  const cs = kf(t, [
    [0.00,  8],    // fine grid
    [0.25, 30],    // WOW #1: huge cells, Lichtenstein
    [0.45, 32],    // WOW #2: cells still large
    [0.55, 14],    // shrinking
    [0.65,  8],    // fine again
    [0.70,  6],    // WOW #3: very fine for pulse contrast
    [0.80, 16],    // medium
    [1.00,  8],    // back to start
  ]);

  // softness: max at WOW #2 for psychedelic blurry huge dots.
  const soft = kf(t, [
    [0.00,  2],
    [0.35,  4],
    [0.45, 14],    // WOW #2: max softness — psychedelic
    [0.55,  6],
    [0.65,  2],
    [0.70,  1],
    [0.85,  4],
    [1.00,  2],
  ]);

  // Grid origin drift: a full circle, returns home at t=1.
  params._gridDx = ANIM.gridDriftPx * Math.cos(TAU * t);
  params._gridDy = ANIM.gridDriftPx * Math.sin(TAU * t);

  if(gui){
    gui.rows.get('dotScale')?._write(ds);
    gui.rows.get('screenAngle')?._write(sa % 360);
    gui.rows.get('cellSize')?._write(cs);
    gui.rows.get('softness')?._write(soft);
  }
  params.dotScale = ds;
  params.screenAngle = sa % 360;
  params.cellSize = cs;
  params.softness = soft;

  buildMask();
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
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.cellSize    = Math.max(6, Math.round(6 + ax * 34));
        params.screenAngle = Math.round(ay * 90);
        if(gui){
          gui.rows.get('cellSize')?._write(params.cellSize);
          gui.rows.get('screenAngle')?._write(params.screenAngle);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.cellSize = Math.max(4, Math.min(60, params.cellSize + dy * 0.05));
        gui?.rows.get('cellSize')?._write(params.cellSize);
        schedule('paint');
      },
      onClick(ax, ay){
        params.screenAngle = (params.screenAngle + 45) % 180;
        gui?.rows.get('screenAngle')?._write(params.screenAngle);
        schedule('paint');
      },
    });
  } else {
    cv.addEventListener('mousemove', handleMouseMove);
  }
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
