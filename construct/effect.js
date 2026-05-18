// Construct effect — text rendered as a mosaic of geometric shapes.
// An off-screen canvas rasterizes the text; each cell of a uniform grid is
// filled with a shape (square / circle / diamond / cross) only where the
// raster has a text pixel. Bauhaus/constructivist aesthetic.
//
// Animate: 30s keyframed arc — resolution zoom (cellSize 16→4), shape morph
// (square→circle), gap breathing (0→8→0), then Bauhaus giant blocks (cell 32),
// then jitter chaos (cell 8, all shapes cycling), then resolve. Seamless loop.
// Interactive: X → cellSize, Y → gap, wheel → jitter, click → cycle shape.
//
// Credit: inspired by Bauhaus constructivist typography and geometric type design.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
const SHAPES = ['square','circle','diamond','cross'];

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v,lo,hi){ return v < lo ? lo : v > hi ? hi : v; }

const params = {
  cellSize: 16,
  shape: 'square',
  gap: 2,
  jitter: 0,
  animate: false,
  interactive: false,
  text: 'says',
  textSize: 400,
  bold: true,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
  invert: false,
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// textMask — rasterized pixel data from the off-screen canvas.
// { data: Uint8ClampedArray, w: number, h: number }
let textMask = null;

// jitterCache — pre-computed per-cell offsets for non-animated jitter.
// Keyed as flat array indexed by (row * cols + col). Recomputed in rasterizeText().
let jitterCache = null;
let jitterCacheGrid = { cellSize: 0, w: 0, h: 0 }; // params that produced jitterCache

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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w  = params.bold   ? 'bold'   : 'normal';
  const s  = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// Rasterize text to an off-screen canvas and store pixel data in textMask.
// Also recomputes the jitter cache for non-animated (static) jitter.
function rasterizeText(){
  const w = cssW(), h = cssH();

  const oc  = document.createElement('canvas');
  oc.width  = Math.round(w * DPR);
  oc.height = Math.round(h * DPR);
  const oc2 = oc.getContext('2d');

  // Fit text to ~92% of canvas width.
  let size = params.textSize;
  oc2.font = fontSpec(size);
  const measured = oc2.measureText(params.text);
  if(measured.width > w * 0.92 * DPR && measured.width > 0){
    size = Math.max(12, Math.floor(size * (w * 0.92 * DPR) / measured.width));
  }

  // Draw white text on black background.
  oc2.fillStyle = '#000000';
  oc2.fillRect(0, 0, oc.width, oc.height);
  oc2.fillStyle = '#ffffff';
  oc2.font = fontSpec(size);
  oc2.textAlign    = 'center';
  oc2.textBaseline = 'middle';
  oc2.fillText(params.text, oc.width / 2, oc.height / 2);

  const imageData = oc2.getImageData(0, 0, oc.width, oc.height);
  textMask = { data: imageData.data, w: oc.width, h: oc.height };

  // Recompute jitter cache.
  rebuildJitterCache(w, h, params.cellSize, params.jitter);
}

// Build a flat jitter cache for the current cell grid.
function rebuildJitterCache(w, h, cell, jitterAmt){
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  jitterCache = new Float32Array(cols * rows * 2);
  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      const idx = (r * cols + c) * 2;
      jitterCache[idx]     = jitterAmt > 0 ? (Math.random() - 0.5) * jitterAmt : 0;
      jitterCache[idx + 1] = jitterAmt > 0 ? (Math.random() - 0.5) * jitterAmt : 0;
    }
  }
  jitterCacheGrid = { cellSize: cell, w, h };
}

// Sample the text mask at a CSS-coordinate point; returns true if text pixel.
function isMaskOn(cx, cy){
  if(!textMask) return false;
  const mx = Math.round(cx * DPR);
  const my = Math.round(cy * DPR);
  if(mx < 0 || mx >= textMask.w || my < 0 || my >= textMask.h) return false;
  return textMask.data[(my * textMask.w + mx) * 4] >= 128;
}

// Draw one shape centered at (cx, cy) with half-size r.
function drawShape(cx, cy, r, shape){
  ctx.beginPath();
  if(shape === 'circle'){
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if(shape === 'square'){
    ctx.rect(cx - r, cy - r, r * 2, r * 2);
  } else if(shape === 'diamond'){
    ctx.moveTo(cx,     cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx,     cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  } else if(shape === 'cross'){
    const t = r * 0.35;
    ctx.rect(cx - t, cy - r, t * 2, r * 2);
    ctx.rect(cx - r, cy - t, r * 2, t * 2);
  }
  ctx.fill();
}

// Paint one pass of the grid. overrides allow the animation loop to drive
// params without mutating params directly (for cellSize / gap / jitter / shape).
function paint(overrides){
  window.WAGUI?.flashValues(params);

  const w = cssW(), h = cssH();
  const cell      = overrides?.cellSize ?? params.cellSize;
  const gap       = overrides?.gap      ?? params.gap;
  const jitterAmt = overrides?.jitter   ?? params.jitter;
  const shape     = overrides?.shape    ?? params.shape;
  const shape2    = overrides?.shape2   ?? null;   // for morph crossfade
  const morph     = overrides?.morph    ?? 0;       // 0..1 crossfade to shape2

  const fgColor = params.invert ? params.bg   : '#ffffff';
  const bgColor = params.invert ? '#ffffff'   : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  if(!textMask){ ctx.restore(); return; }

  const drawSize = cell - gap;
  const r        = drawSize / 2;
  if(r <= 0){ ctx.restore(); return; }

  // Determine whether to use cached jitter or live random jitter (animation).
  const useCache = !overrides?.liveJitter &&
                   jitterCacheGrid.cellSize === cell &&
                   jitterCacheGrid.w === w &&
                   jitterCacheGrid.h === h;
  const cols = Math.ceil(w / cell);

  ctx.fillStyle = fgColor;

  let row = 0;
  for(let gy = 0; gy < h; gy += cell, row++){
    let col = 0;
    for(let gx = 0; gx < w; gx += cell, col++){
      let jx = 0, jy = 0;
      if(jitterAmt > 0){
        if(useCache && jitterCache){
          const ci = (row * cols + col) * 2;
          jx = jitterCache[ci];
          jy = jitterCache[ci + 1];
        } else {
          jx = (Math.random() - 0.5) * jitterAmt;
          jy = (Math.random() - 0.5) * jitterAmt;
        }
      }

      const cx = gx + cell / 2 + jx;
      const cy = gy + cell / 2 + jy;

      if(!isMaskOn(cx, cy)) continue;

      if(morph > 0 && shape2){
        // Crossfade: draw shape at full opacity, then shape2 blended on top.
        ctx.globalAlpha = 1;
        drawShape(cx, cy, r, shape);
        ctx.globalAlpha = morph;
        drawShape(cx, cy, r, shape2);
        ctx.globalAlpha = 1;
      } else {
        drawShape(cx, cy, r, shape);
      }
    }
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ──────────────── Animation ────────────────

// Morph helper — returns { shape, shape2, morph } for a crossfade window.
// t in [t0, t1] blends from shapeA to shapeB.
function morphWindow(t, t0, t1, shapeA, shapeB){
  if(t < t0 || t > t1) return null;
  const f = (t - t0) / (t1 - t0);
  // Ease in-out
  const m = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
  return { shape: shapeA, shape2: shapeB, morph: m };
}

function renderAnimationFrame(t_loop){
  // ────── 30-second Bauhaus arc ──────
  // t=0.00: cellSize=16, gap=2, shape=square — clean geometric grid
  // t=0.15: WOW #1 — cellSize 16→4: resolution explodes, ultra-fine mosaic
  // t=0.28: cellSize back to 12, shape square→circle morphs
  // t=0.40: WOW #2 — gap opens 0→8: shapes breathe apart (dotted/airy)
  // t=0.52: gap closes to 0: packed tight solid blocks
  // t=0.62: cellSize 12→32: giant chunky Bauhaus letters
  // t=0.72: WOW #3 — jitter=20 + cellSize=8 + shape cycles: scattered chaos
  // t=0.85: resolves: cellSize=16, shape=square, gap=2, jitter=0
  // t=1.00: seamless

  const cell = kf(t_loop, [
    [0.00, 16],
    [0.12,  8],   // ramp down toward WOW #1
    [0.15,  4],   // WOW #1: ultra-fine
    [0.22,  4],   // hold fine
    [0.28, 12],   // pull back
    [0.38, 12],
    [0.52, 10],
    [0.60, 12],
    [0.62, 32],   // WOW Bauhaus: giant blocks
    [0.68, 32],   // hold
    [0.72,  8],   // WOW #3: scattered
    [0.82,  8],   // hold chaos
    [0.85, 16],   // resolve
    [1.00, 16],
  ]);

  const gap = kf(t_loop, [
    [0.00, 2],
    [0.28, 2],
    [0.40, 8],   // WOW #2: breathe open
    [0.48, 8],   // hold open
    [0.52, 0],   // snap shut — packed solid
    [0.62, 0],
    [0.70, 4],
    [0.72, 3],
    [0.85, 2],
    [1.00, 2],
  ]);

  const jitter = kf(t_loop, [
    [0.00,  0],
    [0.70,  0],
    [0.72, 20],   // WOW #3: chaos
    [0.82, 20],   // hold
    [0.85,  0],   // resolve
    [1.00,  0],
  ]);

  // Shape: square → circle morph (t=0.25..0.35), then circle → diamond at chaos,
  // then resolve back to square.
  let shapeOverride = { shape: 'square', shape2: null, morph: 0 };
  if(t_loop >= 0.25 && t_loop < 0.40){
    const m = morphWindow(t_loop, 0.25, 0.38, 'square', 'circle');
    if(m) shapeOverride = m;
    else shapeOverride = { shape: 'circle', shape2: null, morph: 0 };
  } else if(t_loop >= 0.40 && t_loop < 0.65){
    shapeOverride = { shape: 'circle', shape2: null, morph: 0 };
  } else if(t_loop >= 0.65 && t_loop < 0.72){
    const m = morphWindow(t_loop, 0.65, 0.72, 'circle', 'diamond');
    if(m) shapeOverride = m;
    else shapeOverride = { shape: 'diamond', shape2: null, morph: 0 };
  } else if(t_loop >= 0.72 && t_loop < 0.82){
    // WOW #3: cycle through all shapes rapidly
    const cycleT = ((t_loop - 0.72) / 0.10) * 4; // 0..4 over the window
    const idx = Math.floor(cycleT) % SHAPES.length;
    const fracInSlot = cycleT - Math.floor(cycleT);
    const m = morphWindow(fracInSlot, 0, 1, SHAPES[idx], SHAPES[(idx + 1) % SHAPES.length]);
    if(m) shapeOverride = m;
    else  shapeOverride = { shape: SHAPES[idx], shape2: null, morph: 0 };
  } else if(t_loop >= 0.82 && t_loop < 0.88){
    const m = morphWindow(t_loop, 0.82, 0.88, 'diamond', 'square');
    if(m) shapeOverride = m;
    else shapeOverride = { shape: 'square', shape2: null, morph: 0 };
  }

  // In animation, jitter > 0 always uses live random (liveJitter flag).
  paint({
    cellSize:   cell,
    gap:        gap,
    jitter:     jitter,
    liveJitter: jitter > 0,
    shape:      shapeOverride.shape,
    shape2:     shapeOverride.shape2,
    morph:      shapeOverride.morph,
  });

  // Sync GUI sliders.
  if(gui){
    gui.rows.get('cellSize')?._write(Math.round(cell));
    gui.rows.get('gap')?._write(Math.round(gap));
    gui.rows.get('jitter')?._write(Math.round(jitter));
  }
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

// ──────────────── Init ────────────────

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    // When jitter changes in static mode, rebuild the jitter cache.
    if(key === 'jitter' && !params.animate){
      rebuildJitterCache(cssW(), cssH(), params.cellSize, params.jitter);
    }
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });

  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-construct',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.cellSize = Math.round(4 + ax * 36);      // 4..40
        params.gap      = Math.round(ay * 8);            // 0..8
        if(gui){
          gui.rows.get('cellSize')?._write(params.cellSize);
          gui.rows.get('gap')?._write(params.gap);
        }
        schedule('paint');
      },
      onWheel(dy){
        if(params.animate) return;
        params.jitter = clamp(params.jitter + Math.round(dy * 0.05), 0, 20);
        gui?.rows.get('jitter')?._write(params.jitter);
        rebuildJitterCache(cssW(), cssH(), params.cellSize, params.jitter);
        schedule('paint');
      },
      onClick(){
        if(params.animate) return;
        const idx = SHAPES.indexOf(params.shape);
        params.shape = SHAPES[(idx + 1) % SHAPES.length];
        gui?.rows.get('shape')?._write(params.shape);
        schedule('paint');
      },
    });
  }

  window.addEventListener('resize', () => {
    fitCanvas();
    schedule('raster');
  });

  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
