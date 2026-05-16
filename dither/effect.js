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
const CYCLE_MS = 15000;
// Intro/outro IS the dither effect: rest = all dots dropped (no text visible),
// peak = all dots present (text reads clearly). Dots resolve in, then out.
// pixelSize breathes the other way: thicker grain at rest, tight dots at the
// legible peak — smaller cells = more samples per glyph = sharper read.
// cellRotation sweeps 0 → 360° monotonically across the cycle so squares
// turn into diamonds and back; seamless because 360° === 0° visually.
const ANIM = {
  pixelDistortion: { rest:  0, peak: 100 },
  pixelSize:       { rest: 14, peak:   5 },
  pixelSpacing:    { rest:  2, peak:   0 },
  cellRotation:    { start: 0, end: 360 },
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pingpongT(elapsed){ return (1 - Math.cos((elapsed % CYCLE_MS) / CYCLE_MS * Math.PI * 2)) / 2; }

// Deterministic per-frame RNG. Seeded by an integer derived from t_loop so
// frame 0 and frame N share the same seed (and therefore the same distortion
// map). Within a frame the grain still "boils" because each cell pulls a
// fresh value from the sequence. mulberry32 — tiny, fast, good enough.
let _rng = Math.random;
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromT(t01){
  // Map t01 ∈ [0,1) to an integer. t=1 collapses to t=0 (mod 1) so the loop
  // closes pixel-perfect. Resolution ~ 100k discrete frames — plenty.
  const wrapped = ((t01 % 1) + 1) % 1;
  return Math.floor(wrapped * 100003) + 1;
}

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  pixelDistortion: 65 + Math.floor(Math.random() * 11), // 65..75 — dense enough for the wordmark to read on landing across short and long phrases; animation still sweeps to 0 (rest) and 100 (peak) when ON
  pixelSize: 10,
  pixelSpacing: 0,
  cellRotation: 0,
  rounded: Math.random() < 0.5,
  invert: false, // landing frame stays legible; user can flip via UI
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
  const rnd = _rng;
  for(let i = 0; i < n; i++){
    distortionMap[i] = (rnd() * 100) < th ? 1 : 0;
  }
}

function hexToRgb(hex){
  const s = String(hex || '#000000').replace('#','');
  const v = s.length === 3 ? s.split('').map(c => c+c).join('') : s;
  return [parseInt(v.slice(0,2),16)||0, parseInt(v.slice(2,4),16)||0, parseInt(v.slice(4,6),16)||0];
}

function paint(){
  window.WAGUI?.flashValues(params);
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
  // Only rotate visible square cells with enough body to make rotation read.
  // Below ~8px the diamond/square delta is sub-pixel noise and costs more
  // than it shows.
  const rotDeg = (!rounded && ps >= 8) ? (params.cellRotation || 0) % 360 : 0;
  const rotRad = rotDeg * Math.PI / 180;
  const useRot = rotRad !== 0;
  const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);

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
            scale = remap(Math.cos(d / HOVER_RADIUS * Math.PI), 1, -1, MAX_GROWTH, 1);
          }
        }
        const adj = Math.round(ps * scale);
        if(rounded){
          const cx = Math.round(x + ps / 2);
          const cy = Math.round(y + ps / 2);
          ctx.beginPath();
          ctx.ellipse(cx, cy, adj / 2, adj / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if(useRot){
          // Rotated square = diamond at 45°. Draw as a 4-point path around
          // the cell centre; cheaper than setTransform per cell.
          const cx = x + ps / 2;
          const cy = y + ps / 2;
          const r = adj / 2;
          // Corners of the square in local space, rotated.
          const xr = cosR * r, yr = sinR * r;
          ctx.beginPath();
          ctx.moveTo(cx - xr - (-sinR * r), cy - yr - cosR * r); // (-r,-r) rotated
          ctx.lineTo(cx + xr - (-sinR * r), cy + yr - cosR * r); // ( r,-r)
          ctx.lineTo(cx + xr + (-sinR * r), cy + yr + cosR * r); // ( r, r)
          ctx.lineTo(cx - xr + (-sinR * r), cy - yr + cosR * r); // (-r, r)
          ctx.closePath();
          ctx.fill();
        } else {
          const px = Math.round(x + ps / 2 - adj / 2);
          const py = Math.round(y + ps / 2 - adj / 2);
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

function applyAnimationT(t01, tLoop){
  // t01 is the pingpong shape (0 at edges, 1 at midpoint). tLoop is the raw
  // 0..1 loop position used for the monotonic rotation sweep.
  // Float-precise params live on a side channel so the visible slider can
  // snap to int without breaking smooth interpolation.
  const pd = Math.max(0, lerp(ANIM.pixelDistortion.rest, ANIM.pixelDistortion.peak, t01));
  const psF = Math.max(1, lerp(ANIM.pixelSize.rest, ANIM.pixelSize.peak, t01));
  const spF = Math.max(0, lerp(ANIM.pixelSpacing.rest, ANIM.pixelSpacing.peak, t01));
  const rot = lerp(ANIM.cellRotation.start, ANIM.cellRotation.end, ((tLoop % 1) + 1) % 1);
  params.pixelDistortion = Math.round(pd);
  params.pixelSize       = Math.round(psF);
  params.pixelSpacing    = Math.round(spF);
  params.cellRotation    = rot;
  if(gui){
    gui.rows.get('pixelDistortion')?._write(params.pixelDistortion);
    gui.rows.get('pixelSize')?._write(params.pixelSize);
    gui.rows.get('pixelSpacing')?._write(params.pixelSpacing);
    gui.rows.get('cellRotation')?._write(Math.round(rot));
  }
  return null;
}

function redraw(){
  rasterizeText();
  buildDistortion();
  paint();
}

function renderAnimationFrame(t_loop){
  const t01 = (1 - Math.cos(t_loop * 2 * Math.PI)) / 2;
  applyAnimationT(t01, t_loop);
  // Seed the per-frame grain by t_loop so the loop closes exactly: seed at
  // t=0 equals seed at t=1. Each frame still rebuilds (grain "boils") but
  // the sequence at the endpoints is identical.
  _rng = mulberry32(seedFromT(t_loop));
  buildDistortion();
  _rng = Math.random;
  rasterizeText();
  paint();
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  renderAnimationFrame((elapsed % CYCLE_MS) / CYCLE_MS);
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

window.WAEffect = {
  cycleMs: CYCLE_MS,
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

// Keys that require a fresh text raster. pixelSize/Spacing change the grid
// (so distortion needs rebuilding). pixelDistortion just rebuilds distortion.
// rounded/invert/bg are paint-only.
const RASTER_KEYS = new Set(['text','textSize','bold','italic']);
const BUILD_KEYS  = new Set(['pixelSize','pixelSpacing','pixelDistortion']);
const PAINT_KEYS  = new Set(['cellRotation']);

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
