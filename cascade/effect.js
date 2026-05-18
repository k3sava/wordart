// Cascade effect — characters are arranged in a diagonal staircase: each letter
// is offset from the previous both horizontally (charLayouts.x) AND vertically
// (i * stepY_px). Multiple copies tile to fill the canvas. During animation the
// staircase scrolls continuously, creating a waterfall of typography tumbling
// diagonally across the screen.
//
// Animate: 30s keyframed arc — gentle cascade → steep staircase → reverse
// (upward) → flat band → accordion pump → giant letters → resolve. Seamless.
// Interactive: cursor X → stepX, cursor Y → stepY, scroll wheel → textSize.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — piecewise-linear keyframe interpolator.
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

const params = {
  stepX: 8,
  stepY: 28,
  scale: 1.0,
  tileCount: 4,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'cascade',
  textSize: 160,
  bold: Math.random() < 0.5,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
  invert: false,
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

let animationId    = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Character layout data.
// Each entry: { char: string, x: number }  (x in CSS px from string start)
let charLayouts    = [];
let totalTextWidth = 0;
let computedSize   = params.textSize;

// Scroll state — monotonically increasing; wrapping is handled in paint().
let scrollOffset = 0;
let lastRafTime  = 0;

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

function cssW(){ return cv.clientWidth  || window.innerWidth;  }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  if(cv.width  !== bw) cv.width  = bw;
  if(cv.height !== bh) cv.height = bh;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size, boldOverride, italicOverride){
  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  const w  = b  ? 'bold'   : 'normal';
  const s  = it ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// rasterizeText() — measures character widths at the effective font size
// (params.textSize * params.scale), capped to canvas width, and populates
// charLayouts. Does NOT draw pixels.
function rasterizeText(boldOverride, italicOverride){
  const w   = cssW();
  const FIT = 0.92;
  let size  = Math.round(params.textSize * params.scale);

  ctx.save();
  ctx.font = fontSpec(size, boldOverride, italicOverride);

  let total = 0;
  for(const ch of params.text) total += ctx.measureText(ch).width;

  if(total > w * FIT && total > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / total));
    ctx.font = fontSpec(size, boldOverride, italicOverride);
  }

  charLayouts    = [];
  let cumX       = 0;
  for(const ch of params.text){
    const cw = ctx.measureText(ch).width;
    charLayouts.push({ char: ch, x: cumX });
    cumX += cw;
  }
  totalTextWidth = cumX;
  computedSize   = size;

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// paint(overrideScrollOffset, overrideStepY, boldOverride, italicOverride)
// Renders the staircase. Multiple tiled copies ensure the canvas is always
// covered even as the scroll offset changes.
function paint(overrideScroll, overrideStepY, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const n = charLayouts.length;

  const fgColor = params.invert ? params.bg  : '#ffffff';
  const bgColor = params.invert ? '#ffffff'  : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  if(n === 0){ ctx.restore(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); return; }

  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  ctx.font         = fontSpec(computedSize, b, it);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = fgColor;

  const stepY      = overrideStepY   != null ? overrideStepY   : params.stepY;
  const scroll     = overrideScroll  != null ? overrideScroll  : scrollOffset;

  // Total vertical extent one full text pass occupies.
  const totalStepY = n * stepY;
  // Handle zero stepY — fall back to a nominal period so we still tile.
  const period     = Math.abs(totalStepY) > 1 ? Math.abs(totalStepY) : h + 100;

  // Wrap scroll modulo period for seamless looping.
  const wrappedScroll = totalStepY !== 0
    ? ((scroll % period) + period) % period
    : scroll;

  // How far apart tiles are horizontally.
  const tileStepX = totalTextWidth + params.stepX;

  // We need enough tile columns to cover the canvas width plus bleed.
  // And enough rows to cover height plus bleed (period-based).
  const BLEED = 200;
  const nCols = Math.ceil((w + BLEED * 2) / (tileStepX > 1 ? tileStepX : 1)) + 2;
  const nRows = Math.ceil((h + BLEED * 2) / (period > 0 ? period : 1)) + 2;

  // Anchor column and row offsets so we start safely left/above the canvas.
  // Column 0 starts at -(nCols/2) columns to the left of canvas centre.
  const startCol = -Math.floor(nCols / 2);
  const startRow = -1;

  for(let col = startCol; col < startCol + nCols; col++){
    for(let row = startRow; row < startRow + nRows; row++){
      const copyX = col * tileStepX;
      // Each row shifts down by `period` (= |n * stepY|) — keeps tiles
      // vertically repeating. scrollDir ensures we scroll in the correct
      // direction (positive stepY → text falls down → scroll moves upward
      // so we subtract the wrapped scroll within each row).
      const scrollDir = totalStepY >= 0 ? 1 : -1;
      const copyY     = row * period - scrollDir * wrappedScroll;

      for(let i = 0; i < n; i++){
        const x = copyX + charLayouts[i].x;
        const y = copyY + i * stepY;
        // Skip characters well outside the canvas.
        if(x > w + BLEED || x < -BLEED - computedSize) continue;
        if(y > h + BLEED || y < -BLEED - computedSize) continue;
        ctx.fillText(charLayouts[i].char, x, y);
      }
    }
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

// WOW animation — 30s keyframed arc:
// t=0.00: gentle cascade (stepY=28, normal scroll)
// t=0.15: WOW #1 — steep staircase (stepY=80), scroll triples
// t=0.28: reverse! stepY=-50 (cascade flows upward)
// t=0.40: stepY=0 → flat horizontal scrolling band
// t=0.50: WOW #2 — stepY oscillates ±70 fast (accordion pump)
// t=0.65: resolves, scale grows (bigger letters in cascade)
// t=0.75: WOW #3 — giant text (scale≈2) + extreme stepY=70
// t=0.88: normalises — stepY=28, scale=1
// t=1.00: seamless

function renderAnimationFrame(t_loop){
  const stepY = kf(t_loop, [
    [0.00,  28],
    [0.12,  28],
    [0.15,  80],  // WOW #1: steep staircase
    [0.24,  80],
    [0.28, -50],  // reverse direction
    [0.36, -50],
    [0.40,   0],  // flat band scrolling sideways
    [0.46,   0],
    // Accordion: oscillate via sine sampled at keyframes
    [0.50,  70],
    [0.52, -70],
    [0.54,  70],
    [0.56, -70],
    [0.58,  70],
    [0.62,  35],  // resolves into growing cascade
    [0.65,  35],
    [0.75,  70],  // WOW #3: giant letters + extreme staircase
    [0.88,  28],
    [1.00,  28],
  ]);

  const scale = kf(t_loop, [
    [0.00, 1.0],
    [0.62, 1.0],
    [0.72, 1.8],  // grow for WOW #3
    [0.75, 2.0],
    [0.88, 1.0],
    [1.00, 1.0],
  ]);

  // Scroll velocity (px per second at CSS scale).
  const velocity = kf(t_loop, [
    [0.00,  60],
    [0.12,  60],
    [0.14, 200],  // WOW #1: triples
    [0.18, 200],
    [0.22,  80],
    [0.28,  80],  // reverse already set by stepY sign
    [0.40,  90],  // flat band: fast lateral
    [0.50, 120],
    [0.58,  80],
    [0.65,  80],
    [0.75,  70],
    [0.88,  60],
    [1.00,  60],
  ]);

  // Advance scroll by velocity * dt.
  const now = performance.now();
  const dt  = lastRafTime > 0 ? now - lastRafTime : 16;
  lastRafTime = now;
  scrollOffset += velocity * (dt / 1000);

  // Update displayed params so GUI reflects the animation.
  params.stepY  = Math.round(stepY);
  params.scale  = Math.round(scale * 100) / 100;
  if(gui){
    gui.rows.get('stepY') ?._write(params.stepY);
    gui.rows.get('scale') ?._write(params.scale);
  }

  // Re-measure only when scale (= effective textSize) changes meaningfully.
  const prevSize = computedSize;
  rasterizeText();
  paint(scrollOffset, stepY);
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
    lastRafTime = 0;
    scrollOffset = 0;
    animationLoop();
  } else if(animationId){
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ---------------------------------------------------------------------------
// WAEffect API
// ---------------------------------------------------------------------------
window.WAEffect = {
  cycleMs: CYCLE_MS,
  renderAt(t_loop){ renderAnimationFrame(t_loop); },
  pauseRender(){
    if(animationId){ cancelAnimationFrame(animationId); animationId = null; }
  },
  resumeRender(){
    if(params.animate && !animationId){
      animationStartTime = performance.now();
      lastRafTime = 0;
      animationLoop();
    } else if(!params.animate){
      redraw();
    }
  },
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic', 'scale']);

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
      name: 'wordart-cascade',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X → stepX (0..100)
        params.stepX = Math.round(ax * 100);
        // Y → stepY (-80..80), top = positive (downward cascade)
        params.stepY = Math.round((1 - ay) * 160 - 80);
        gui?.rows.get('stepX')?._write(params.stepX);
        gui?.rows.get('stepY')?._write(params.stepY);
        schedule('paint');
      },
      onWheel(dy){
        params.textSize = clamp(params.textSize - dy * 20, 20, 600);
        gui?.rows.get('textSize')?._write(Math.round(params.textSize));
        if(!params.animate) schedule('raster');
      },
      onClick(){ /* no-op */ },
    });
  }

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
