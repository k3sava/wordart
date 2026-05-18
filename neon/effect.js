// Neon effect — text rendered as a glowing neon sign.
// White-hot core with multiple colored glow halos using shadowBlur layers in
// additive ('lighter') compositing mode. Dark backgrounds make the glow pop.
// Optional flicker: random intensity dips with smooth recovery.
//
// Animate: glow breathes using (1 − cos(2π·t))/2 — minimum at t=0/1 (both
// endpoints identical, seamless), peak glow at t=0.5. The breathing envelope
// gives a pulsing neon sign feel.
// Interactive: cursor X → glowRadius, cursor Y → innerBrightness.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  glowMin: 4,   // CSS px at loop endpoints (t=0/1)
  glowMax: 50,  // CSS px at loop midpoint  (t=0.5)
};

// Glow color presets — vivid saturated hues that read well on dark backgrounds.
const GLOW_PRESETS = ['#ff00ff','#00ffff','#00ff00','#ff6600','#ff69b4','#9966ff'];

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  glowColor: pick(GLOW_PRESETS),
  glowRadius: 20,
  innerBrightness: 80,
  flicker: false,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('heavy') : 'neon',
  textSize: 400,
  bold: true,
  italic: false,
  bg: '#000000',
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
// textBuf holds white text on transparent — the glow mask source.
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Flicker state — values evolve independently of params so they survive
// GUI changes without resetting.
let flickerVal = 1.0;    // current brightness multiplier (0..1)
let flickerTarget = 1.0; // target the smoother is chasing

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
  for(const c of [cv, textBuf]){
    if(c.width !== bw)  c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function rasterizeText(){
  const w = cssW(), h = cssH();
  // Clear in identity (backing pixel) space.
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
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';
  tctx.fillText(params.text, w / 2, h / 2);
}

// Update the flicker multiplier. Called once per paint() call so it evolves
// at display frame-rate, independent of whether animation is active.
function updateFlicker(){
  if(!params.flicker){
    flickerVal    = 1.0;
    flickerTarget = 1.0;
    return;
  }
  // 1.8% chance per call to drop the target to a random low value.
  if(Math.random() < 0.018){
    flickerTarget = 0.2 + Math.random() * 0.5;
  } else if(Math.random() < 0.08){
    // Slow recovery: inch target back toward full brightness.
    flickerTarget = Math.min(1.0, flickerTarget + 0.2);
  }
  // Smooth interpolation — exponential ease toward target.
  flickerVal += (flickerTarget - flickerVal) * 0.10;
}

function paint(overrideGlowRadius){
  window.WAGUI?.flashValues(params);
  updateFlicker();

  const fk = flickerVal;
  const w  = cssW(), h = cssH();

  // Glow radius in CSS px (may be overridden by the animation loop).
  const r        = overrideGlowRadius != null ? overrideGlowRadius : params.glowRadius;
  const rBacking = r * DPR; // convert to backing-buffer px for shadowBlur

  // Fill background in CSS coordinate space (DPR transform active).
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Glow layers — drawn in identity (backing pixel) space so that shadowBlur
  // is specified in backing pixels and behaves identically at all DPR values.
  // Additive blending ('lighter') accumulates the halos so outer layers add
  // atmosphere rather than capping out.
  //
  // Layer design:
  //   Layer 0: wide outer halo   — large blur, low alpha, glow color
  //   Layer 1: mid halo          — medium blur, medium alpha, glow color
  //   Layer 2: tight inner halo  — small blur, higher alpha, glow color
  //   Layer 3: white core        — very tight blur, white, scaled by innerBrightness
  const layers = [
    { blur: rBacking * 4.0, color: params.glowColor, alpha: 0.12 },
    { blur: rBacking * 2.0, color: params.glowColor, alpha: 0.28 },
    { blur: rBacking * 1.0, color: params.glowColor, alpha: 0.50 },
    { blur: rBacking * 0.35, color: '#ffffff',        alpha: 0.70 * (params.innerBrightness / 100) },
  ];

  for(const layer of layers){
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.alpha * fk));
    ctx.shadowBlur    = layer.blur;
    ctx.shadowColor   = layer.color;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(textBuf, 0, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // Core text — drawn source-over without shadow so it's crisp white on top
  // of the accumulated glow stack. Flicker dims this too for realism.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.max(0, Math.min(1, fk));
  ctx.drawImage(textBuf, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // Glow breathes: (1 − cos(2π·t)) / 2 gives 0 at t=0/1 (seamless endpoints),
  // 1 at t=0.5 (peak). Mapped onto the glowMin..glowMax range.
  const pulseShape = (1 - Math.cos(t_loop * 2 * Math.PI)) / 2; // 0 → 1 → 0
  const glow = ANIM.glowMin + pulseShape * (ANIM.glowMax - ANIM.glowMin);

  // Update params so the GUI slider reflects the animated value.
  params.glowRadius = glow;
  if(gui){
    gui.rows.get('glowRadius')?._write(glow);
  }

  // Text content never changes during animation so rasterizeText() is only
  // needed once at start (done by redraw()). Call paint() directly each frame.
  paint(glow);
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

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r  = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  // X axis → glow radius (4..80)
  params.glowRadius       = Math.round(4 + ax * 76);
  // Y axis → inner brightness (0..100)
  params.innerBrightness  = Math.round((1 - ay) * 100);
  if(gui){
    gui.rows.get('glowRadius')?._write(params.glowRadius);
    gui.rows.get('innerBrightness')?._write(params.innerBrightness);
  }
  schedule('paint');
}

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);

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
      name: 'wordart-neon',
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
