// Pixel effect — text rasterised to a hidden buffer, then redrawn as a grid
// of hard square blocks. A block is drawn only if the alpha at its centre
// sample exceeds 50% (or inverted: drawn only where there is NO text).
// Optional gap shrinks each block inward for a tile-mosaic look.
//
// Palette mode tints blocks by their vertical position:
//   mono  — white
//   heat  — dark-red (top) → orange → yellow → white (bottom)
//   ice   — dark-blue (top) → cyan → white (bottom)
//   fire  — yellow (top) → orange → dark-red → near-black (bottom)
//
// Animation: 30s keyframed arc with WOW moments including huge blocks,
// palette shifts, and rapid oscillation. Seamless loop.
//
// Interactive: cursor X → blockSize, cursor Y → gap.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
const ANIM = {
  blockSizePeak:  38,  // largest block size (barely legible text)
  blockSizeFloor:  3,  // smallest block size (crisp pixel-perfect text)
};

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const PALETTES = ['mono', 'heat', 'ice', 'fire'];

const params = {
  blockSize: 8 + Math.floor(Math.random() * 10),  // 8..17
  gap:       0,
  palette:   'mono',   // 'mono' | 'heat' | 'ice' | 'fire'
  invert:    false,
  animate:   false,
  interactive: false,
  text: 'maybe more',
  textSize:  400,
  bold:      true,
  italic:    false,
  bg:        pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d', { willReadFrequently: true });

let animationId        = null;
let animationStartTime = 0;
let gui;
let DPR        = 1;
let textPixels = null;  // cached Uint8ClampedArray; invalidated on raster/resize

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
  for(const c of [cv, textBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  textPixels = null;  // canvas resized — pixel cache is stale
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
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
  const measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
  textPixels = null;  // rasterized fresh — force re-read on next paint
}

function getTextPixels(){
  if(!textPixels){
    textPixels = tctx.getImageData(0, 0, textBuf.width, textBuf.height).data;
  }
  return textPixels;
}

// ── Palette helpers ────────────────────────────────────────────────────────

// Parse #rrggbb into [r, g, b] (0..255 each).
function hexParse(hex){
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Linearly interpolate two hex colours; return #rrggbb.
function lerpHex(a, b, t){
  const [ar, ag, ab] = hexParse(a);
  const [br, bg, bb] = hexParse(b);
  const r  = Math.round(lerp(ar, br, t));
  const g  = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Multi-stop gradient: stops = [[t0, '#hex'], [t1, '#hex'], ...] sorted asc.
function lerpPalette(stops, t){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if(t >= t0 && t <= t1){
      const f = (t1 === t0) ? 0 : (t - t0) / (t1 - t0);
      return lerpHex(c0, c1, f);
    }
  }
  return stops[stops.length - 1][1];
}

// Map vertical fraction fy (0=top, 1=bottom) to a palette colour.
function paletteColor(palette, fy){
  if(palette === 'heat'){
    return lerpPalette([
      [0,    '#cc0000'],
      [0.33, '#ff6600'],
      [0.66, '#ffcc00'],
      [1,    '#ffffff'],
    ], fy);
  }
  if(palette === 'ice'){
    return lerpPalette([
      [0,   '#000066'],
      [0.4, '#0066ff'],
      [0.7, '#00ccff'],
      [1,   '#ffffff'],
    ], fy);
  }
  if(palette === 'fire'){
    // Fire rises: hot colours at top, dark at bottom.
    return lerpPalette([
      [0,    '#ffff00'],
      [0.33, '#ff6600'],
      [0.66, '#cc0000'],
      [1,    '#330000'],
    ], fy);
  }
  return '#ffffff';  // mono
}

// ── Paint ──────────────────────────────────────────────────────────────────

function paint(overrideBlockSize){
  window.WAGUI?.flashValues(params);
  const w   = cssW(), h = cssH();
  const bs  = overrideBlockSize != null ? overrideBlockSize : params.blockSize;
  const gap = params.gap;
  // Each drawn block is smaller than the grid cell by gap on each edge.
  const blockDraw = Math.max(1, bs - gap);
  const pixels    = getTextPixels();
  const bw        = textBuf.width;
  const bh        = textBuf.height;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Background
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  const cols = Math.ceil(w / bs);
  const rows = Math.ceil(h / bs);
  const inv  = params.invert;
  const pal  = params.palette;
  const mono = pal === 'mono';

  for(let row = 0; row < rows; row++){
    for(let col = 0; col < cols; col++){
      // Centre of this block in CSS-pixel space.
      const cx = col * bs + bs * 0.5;
      const cy = row * bs + bs * 0.5;
      // Map to backing-resolution (DPR) coordinates for pixel lookup.
      const sx = Math.round(cx * DPR);
      const sy = Math.round(cy * DPR);
      if(sx >= bw || sy >= bh) continue;
      const idx    = (sy * bw + sx) * 4;
      const isText = pixels[idx + 3] > 128;   // alpha > 50%
      const draw   = inv ? !isText : isText;
      if(!draw) continue;

      const fy    = (cy) / h;  // vertical fraction for palette
      const color = mono ? '#ffffff' : paletteColor(pal, fy);
      ctx.fillStyle = color;
      // Draw from (col*bs + gap/2, row*bs + gap/2) at size blockDraw.
      ctx.fillRect(
        col * bs + gap * 0.5,
        row * bs + gap * 0.5,
        blockDraw,
        blockDraw,
      );
    }
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ── Animation ──────────────────────────────────────────────────────────────

// Palette crossfade helper — snap to nearest palette name at t
function paletteAtT(t){
  // t=0.00-0.39: mono
  // t=0.40-0.59: heat  (WOW #2: stained glass)
  // t=0.60-0.64: ice
  // t=0.65-0.79: fire  (WOW #3: ice→fire oscillation)
  // t=0.80-1.00: mono
  if(t < 0.40) return 'mono';
  if(t < 0.60) return 'heat';
  if(t < 0.65) return 'ice';
  if(t < 0.80) return 'fire';
  return 'mono';
}

function renderAnimationFrame(t_loop){
  // WOW animation — 30s keyframed arc:
  // t=0.00: blockSize=3 (fine, crisp pixel text)
  // t=0.15: blockSize grows
  // t=0.25: WOW #1 — HUGE blocks (38px), text is just 2-3 giant squares per letter
  // t=0.35: blocks shrink rapidly
  // t=0.40: palette shifts from mono to heat
  // t=0.50: WOW #2 — heat palette + medium blocks + gap → mosaic stained glass
  // t=0.60: palette shifts to ice
  // t=0.65: WOW #3 — rapid block size oscillation between 3 and 38, ice→fire palette
  // t=0.80: blockSize=3, mono palette
  // t=1.00: same as start, seamless

  let bs;
  // WOW #3 window: rapid oscillation between 3 and 38
  if(t_loop >= 0.65 && t_loop < 0.80){
    const sub = (t_loop - 0.65) / 0.15;
    // 3 full oscillations in the window
    bs = 3 + (38 - 3) * (0.5 - 0.5 * Math.cos(sub * 3 * 2 * Math.PI));
  } else {
    bs = kf(t_loop, [
      [0.00,  3],
      [0.15, 15],
      [0.25, 38],  // WOW #1: giant blocks
      [0.35,  4],  // rapid shrink
      [0.40,  8],
      [0.50, 18],  // WOW #2: mosaic
      [0.60, 10],
      [0.65,  3],  // start of WOW #3 oscillation
      [0.80,  3],
      [1.00,  3],
    ]);
  }

  const gap = kf(t_loop, [
    [0.00, 0],
    [0.40, 0],
    [0.50, 3],  // WOW #2: gap gives mosaic look
    [0.60, 1],
    [0.80, 0],
    [1.00, 0],
  ]);

  const newPalette = paletteAtT(t_loop);

  params.blockSize = bs;
  params.gap       = gap;
  params.palette   = newPalette;

  if(gui){
    gui.rows.get('blockSize')?._write(Math.round(bs));
    gui.rows.get('gap')?._write(Math.round(gap));
    gui.rows.get('palette')?._write(newPalette);
  }
  paint(bs);
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
  renderAt(t_loop){
    if(!textPixels){ rasterizeText(); }
    renderAnimationFrame(t_loop);
  },
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

// ── Mouse interaction ──────────────────────────────────────────────────────

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r  = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  params.blockSize = 2 + Math.round(ax * 38);
  params.gap       = Math.round(ay * 8);
  if(gui){
    gui.rows.get('blockSize')?._write(params.blockSize);
    gui.rows.get('gap')?._write(params.gap);
  }
  schedule('paint');
}

// ── Init ───────────────────────────────────────────────────────────────────

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)){
      textPixels = null;  // text changed — invalidate pixel cache
      dirty.raster = true;
    }
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas:  cv,
      name:    'wordart-pixel',
      pngBtn:  document.getElementById('export-png'),
      mp4Btn:  document.getElementById('export-mp4'),
      rec:     document.querySelector('.wa-rec'),
    });
  }
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.blockSize = 2 + Math.round(ax * 38);
        params.gap       = Math.round(ay * 8);
        if(gui){
          gui.rows.get('blockSize')?._write(params.blockSize);
          gui.rows.get('gap')?._write(params.gap);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.blockSize = Math.max(2, Math.min(40, params.blockSize + dy * 0.05));
        gui?.rows.get('blockSize')?._write(Math.round(params.blockSize));
        if(!params.animate) schedule('paint');
      },
      onClick(ax, ay){
        const P = ['mono', 'heat', 'ice', 'fire'];
        const i = P.indexOf(params.palette);
        params.palette = P[(i + 1) % P.length];
        if(!params.animate) schedule('paint');
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
