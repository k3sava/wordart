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
//
// Animation — 30s wow moments:
//   t=0.00: tight lines (small spacing), angle=0 (horizontal)
//   t=0.10: spacing grows
//   t=0.20: WOW #1 — WIDE spacing, few lines, text reads as gaps
//   t=0.30: angle starts sweeping (lines rotate)
//   t=0.40: WOW #2 — maximum sweep speed, lines spinning like a fan
//   t=0.50: angle at 90° (vertical lines through text)
//   t=0.60: spacing narrows, lines tight at 90°
//   t=0.65: WOW #3 — rapid alternation 0°↔90° + spacing pulses
//   t=0.80: angle returns to 0°, spacing normalizes
//   t=1.00: tight horizontal lines, seamless
'use strict';

const STRIPED_ANIMALS = ["Zebra","Tiger","Okapi","Bongo","Quagga","Tapir","Numbat","Thylacine","Zonkey","Zorse","Quoll","Hyena","Serval","Civet","Caracal"];
const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
// Per-param rest (t=0) and peak (t=0.5) values for legacy pingpong reference.
const ANIM = {
  angle:       { rest:   0, peak:  90 },
  lineSize:    { rest:  14, peak:   3 },
  lineSpacing: { rest:   0, peak:   2 },
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pingpongT(elapsed){ return (1 - Math.cos((elapsed % CYCLE_MS) / CYCLE_MS * Math.PI * 2)) / 2; }
// Envelope: 0 → 1 → 0 across one cycle (smooth sine). Drives text scale so
// the phrase appears at the start, peaks mid-cycle, and disappears at the end.
function envelopeT(elapsed){ return Math.sin((elapsed % CYCLE_MS) / CYCLE_MS * Math.PI); }
let _envScale = 1;
// Keyframe interpolator: stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

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
  direction: true, // true = clockwise sweep during animate, false = counter-clockwise
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
  // Envelope-scaled size: during animate, _envScale rises from 0 to 1 over the
  // first half of the cycle and falls back to 0 — the text grows on, then off.
  const scaledSize = params.textSize * _envScale;
  if(scaledSize < 4) return; // sub-pixel — leave canvas empty for clean intro/outro
  const weight = params.bold ? 'bold' : 'normal';
  const style  = params.italic ? 'italic' : 'normal';
  const FIT = 0.92;
  let size = scaledSize;
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
  window.WAGUI?.flashValues(params);
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

function renderAnimationFrame(t_loop){
  const t = ((t_loop % 1) + 1) % 1;

  // Envelope: text present throughout the full 30s loop.
  _envScale = 1;

  // Angle: keyframed for wow moments.
  // WOW #3 rapid alternation achieved by fast oscillation in [0.65, 0.80].
  let a;
  if(t >= 0.65 && t < 0.80){
    // Rapid 0°↔90° strobing — 6 full oscillations in 15% of the cycle.
    const localT = (t - 0.65) / 0.15; // 0→1
    a = 45 + 45 * Math.sin(localT * Math.PI * 6);
  } else {
    a = kf(t, [
      [0.00,   0],   // horizontal lines
      [0.10,   5],
      [0.20,  10],   // WOW #1: wide spacing, slight angle
      [0.30,  30],   // angle begins sweeping
      [0.40,  60],   // WOW #2: fast sweep, fan effect
      [0.50,  90],   // vertical lines through text
      [0.60,  90],   // tight at 90°
      [0.65,  90],   // WOW #3 start point
      [0.80,   0],   // returns to 0° after strobe
      [1.00,   0],   // seamless
    ]);
  }

  // lineSize: wide at WOW #1 (few bold lines), narrow at WOW #2/3.
  const ls = kf(t, [
    [0.00, 12],   // tight lines
    [0.10, 18],   // spacing grows
    [0.20, 28],   // WOW #1: very few wide lines
    [0.30, 20],   // still wide while angle sweeps
    [0.40,  8],   // WOW #2: finer lines spinning fast
    [0.50,  6],   // fine vertical
    [0.60,  4],   // very tight
    [0.65,  4],   // WOW #3: tight for contrast
    [0.72, 24],   // pulse wide
    [0.78,  4],   // pulse tight
    [0.80, 10],   // normalise
    [1.00, 12],   // back to start
  ]);

  // lineSpacing: 0 at tight moments, large at WOW #1.
  const lg = kf(t, [
    [0.00,  0],
    [0.10,  4],
    [0.20, 20],   // WOW #1: text reads as GAPS between lines
    [0.30, 10],
    [0.40,  2],
    [0.50,  1],
    [0.60,  0],
    [0.65,  0],
    [0.80,  2],
    [1.00,  0],
  ]);

  if(gui){
    gui.rows.get('angle')?._write(a);
    gui.rows.get('lineSize')?._write(ls);
    gui.rows.get('lineSpacing')?._write(lg);
  }
  params.angle = a;
  params.lineSize = Math.max(1, ls);
  params.lineSpacing = Math.max(0, lg);

  rasterizeText();
  invalidateRaster();
  buildLines();
  paint();
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  const t_loop = (elapsed % CYCLE_MS) / CYCLE_MS;
  renderAnimationFrame(t_loop);
  dirty.raster = dirty.build = dirty.paint = false;
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

// Recording protocol — export.js calls these to force a clean 30 s loop.
window.WAEffect = {
  cycleMs: CYCLE_MS,
  // Render at a specific point in the loop — used by the offline exporter
  // to materialise frames without disturbing the live animation timer.
  renderAt(t_loop){ renderAnimationFrame(t_loop); },
  // Suspend / resume the live animation while the exporter is generating frames.
  pauseRender(){ if(animationId){ cancelAnimationFrame(animationId); animationId = null; } },
  resumeRender(){
    if(params.animate && !animationId){
      animationStartTime = performance.now();
      animationLoop();
    } else if(!params.animate){
      _envScale = 1; redraw();
    }
  },
};

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
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.angle    = Math.round(ax * 180);
        params.lineSize = Math.max(1, Math.round(1 + ay * 19));
        if(gui){
          gui.rows.get('angle')?._write(params.angle);
          gui.rows.get('lineSize')?._write(params.lineSize);
        }
        schedule('build');
      },
      onWheel(dy){
        params.lineSpacing = Math.max(2, Math.min(50, params.lineSpacing + dy * 0.03));
        gui?.rows.get('lineSpacing')?._write(params.lineSpacing);
        schedule('build');
      },
      onClick(ax, ay){
        params.angle = Math.random() * 180;
        gui?.rows.get('angle')?._write(params.angle);
        schedule('build');
      },
    });
  } else {
    cv.addEventListener('mousemove', handleMouseMove);
    cv.addEventListener('mouseleave', () => { mouseX = mouseY = -9999; });
  }
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
