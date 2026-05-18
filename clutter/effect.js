// Clutter effect — each character is scattered across the canvas at a random
// position and rotation, as if letters were tossed from a handful and landed
// wherever they fell. During animation, the letters "sort" themselves back into
// their correct reading order, then scatter again — a satisfying anagram-to-word
// cycle with seed-jumping and rapid oscillation WOW moments.
//
// Animate: 30s keyframed arc — scatter→sort→scatter with seed-jumps and 3 rapid
// oscillations for WOW moments. Rotation drops to 0 as letters sort home.
// Interactive: X=scatter, Y=rotation, click=randomize seed. Seamless loop.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

// ease-in-out cubic
function easeInOut(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Seeded PRNG (mulberry32)
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const params = {
  scatter: 0.8,
  rotation: 90,
  seed: Math.floor(Math.random() * 1000),
  animate: false,
  interactive: false,
  text: 'out there?',
  textSize: 320,
  bold: Math.random() < 0.5,
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

// Character layout data — recomputed whenever text/font params change.
// Each entry: { char, x, w }  (x is cumulative offset, w is char width, in CSS px)
let charLayouts = [];
let totalTextWidth = 0;
let computedSize = params.textSize;

// Scatter positions cache — rebuilt when text/seed/canvas size changes.
let scatterCache = null;
let scatterCacheKey = '';

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

function cssW(){ return cv.clientWidth || window.innerWidth; }
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

// rasterizeText() measures character widths and builds charLayouts.
// Does not draw pixels.
function rasterizeText(boldOverride, italicOverride){
  const w = cssW();
  const FIT = 0.92;
  let size = params.textSize;

  ctx.save();
  ctx.font = fontSpec(size, boldOverride, italicOverride);

  let total = 0;
  for(const ch of params.text) total += ctx.measureText(ch).width;

  if(total > w * FIT && total > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / total));
    ctx.font = fontSpec(size, boldOverride, italicOverride);
  }

  charLayouts = [];
  let cumX = 0;
  for(const ch of params.text){
    const cw = ctx.measureText(ch).width;
    charLayouts.push({ char: ch, x: cumX, w: cw });
    cumX += cw;
  }
  totalTextWidth = cumX;
  computedSize   = size;

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Invalidate scatter cache when layout changes
  scatterCache = null;
}

// Build (or return cached) scatter positions for the current seed + canvas.
// Each entry: { homeX, homeY, awayX, awayY, awayRot }
function getScatterPositions(w, h, seedOverride){
  const seed = seedOverride != null ? seedOverride : params.seed;
  const key = `${seed}|${w}|${h}|${totalTextWidth}|${charLayouts.length}`;
  if(scatterCache && scatterCacheKey === key) return scatterCache;

  const rand = mulberry32(seed * 1000 + 7);
  const positions = charLayouts.map((c) => {
    const homeX = w / 2 - totalTextWidth / 2 + c.x + c.w / 2;
    const homeY = h / 2;
    const awayX = rand() * w * 0.88 + w * 0.06;
    const awayY = rand() * h * 0.82 + h * 0.09;
    const awayRot = (rand() - 0.5) * 2 * Math.PI; // full random rot for cache; scaled by params.rotation at draw time
    return { homeX, homeY, awayX, awayY, awayRot };
  });

  scatterCache = positions;
  scatterCacheKey = key;
  return positions;
}

function paint(scatterOverride, rotationOverride, boldOverride, italicOverride, seedOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  const sc  = scatterOverride  != null ? scatterOverride  : params.scatter;
  const rot = rotationOverride != null ? rotationOverride : params.rotation;

  const fgColor = params.invert ? params.bg  : '#ffffff';
  const bgColor = params.invert ? '#ffffff'  : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const positions = getScatterPositions(w, h, seedOverride);

  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  ctx.font         = fontSpec(computedSize, b, it);
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';
  ctx.fillStyle    = fgColor;

  // rotScale maps the stored awayRot (full ±π) to the current max rotation param
  const rotScale = (rot / 180);

  for(let i = 0; i < charLayouts.length; i++){
    const c = charLayouts[i];
    const p = positions[i];
    if(!p) continue;

    // Ease scatter interpolation for snappier landing
    const scEased = easeInOut(sc);

    const x   = p.homeX + (p.awayX - p.homeX) * scEased;
    const y   = p.homeY + (p.awayY - p.homeY) * scEased;
    const rot_ = p.awayRot * rotScale * scEased;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot_);
    ctx.fillText(c.char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // 30s keyframed arc:
  // t=0.00: scatter=1.0 — completely scattered, letters all over
  // t=0.12: scatter starts sorting (eases to 0) — letters fly home
  // t=0.20: scatter=0.0 — perfectly in order. PAUSE.
  // t=0.30: scatter starts exploding out (eases to 1)
  // t=0.38: scatter=1.0 — fully scattered. PAUSE.
  // t=0.50: WOW #1 — seed changes every ~0.5s intervals while scattered
  // t=0.60: letters sort home from new positions
  // t=0.68: scatter=0. Hold. Then...
  // t=0.70: WOW #2 — 3 rapid oscillations over t=0.70-0.85
  // t=0.85: scatter=0, hold — clean text
  // t=0.90: one final slow scatter out
  // t=1.00: scatter=1, seamless loop

  const sc = kf(t_loop, [
    [0.00, 1.0],
    [0.12, 1.0],  // start of sort
    [0.20, 0.0],  // perfectly ordered — PAUSE
    [0.30, 0.0],  // hold
    [0.38, 1.0],  // fully scattered — PAUSE
    [0.50, 1.0],  // WOW #1 seed-jump zone starts
    [0.60, 1.0],  // begin sorting home
    [0.68, 0.0],  // ordered again
    [0.70, 0.0],  // hold before rapid cycle
    // WOW #2 — 3 rapid oscillations over 0.70-0.85
    [0.725, 1.0],
    [0.75,  0.0],
    [0.775, 1.0],
    [0.80,  0.0],
    [0.825, 1.0],
    [0.85,  0.0],  // clean text
    [0.90,  0.0],  // hold
    [1.00,  1.0],  // final scatter out → seamless loop
  ]);

  // Rotation drops to 0 as letters sort home (WOW moments keep full chaos)
  const rot = kf(t_loop, [
    [0.00, params.rotation],
    [0.12, params.rotation],
    [0.18, 0],              // snap straight as they land
    [0.22, 0],
    [0.30, params.rotation],
    [0.38, params.rotation],
    [0.60, params.rotation],
    [0.66, 0],
    [0.70, 0],
    [0.725, params.rotation],
    [0.75,  0],
    [0.775, params.rotation],
    [0.80,  0],
    [0.825, params.rotation],
    [0.85,  0],
    [0.90,  0],
    [1.00, params.rotation],
  ]);

  // WOW #1: seed changes every ~0.025 time-units (0.75s) while fully scattered
  // t=0.38–0.60: seed jumps produce new random arrangements
  let seedOverride = null;
  if(t_loop >= 0.38 && t_loop < 0.60){
    const phase = (t_loop - 0.38) / 0.025;
    seedOverride = (params.seed + Math.floor(phase) * 137) % 1000;
  }

  // Update GUI sliders
  if(gui){
    gui.rows.get('scatter')?._write(Math.round(sc * 100) / 100);
    gui.rows.get('rotation')?._write(Math.round(rot));
  }

  rasterizeText();
  paint(sc, rot, null, null, seedOverride);
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

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);
const SCATTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic', 'seed']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(SCATTER_KEYS.has(key)) scatterCache = null; // invalidate position cache
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });

  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-clutter',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X axis → scatter (0..1)
        params.scatter = Math.round(ax * 100) / 100;
        // Y axis → rotation (0..180) — top = max rotation
        params.rotation = Math.round((1 - ay) * 180);
        if(gui){
          gui.rows.get('scatter')?._write(params.scatter);
          gui.rows.get('rotation')?._write(params.rotation);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.scatter = Math.max(0, Math.min(1, params.scatter + dy * 0.002));
        gui?.rows.get('scatter')?._write(Math.round(params.scatter * 100) / 100);
        if(!params.animate) schedule('paint');
      },
      onClick(){
        // Randomize seed
        params.seed = Math.floor(Math.random() * 1000);
        scatterCache = null;
        gui?.rows.get('seed')?._write(params.seed);
        if(!params.animate) schedule('paint');
      },
    });
  }

  window.addEventListener('resize', () => {
    fitCanvas();
    scatterCache = null;
    schedule('raster');
  });

  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
