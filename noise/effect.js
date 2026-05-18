// Noise effect — text rasterised into an offscreen buffer, then re-rendered as
// an animated particle field. During init, particles are seeded ON text pixels
// so the text shape is made of living dust. Each particle oscillates away from
// its home position and returns, using integer-frequency sinusoids (1, 2, or 3
// cycles per loop). Because sin(2π · n · 0) = 0 and sin(2π · n · 1) = 0 for
// all integer n, every particle is exactly at its home position at t=0 and t=1,
// giving a seamless loop. Mid-loop the particles have dispersed into a fog.
//
// Interactive mode: cursor X modulates particle size, cursor Y modulates drift.
// Animate mode: seamless 15-second particle breathing cycle.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  maxFreq: 3, // particles oscillate 1, 2, or 3 complete cycles per loop
};

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t){ return a + (b - a) * t; }

const params = {
  count: 1200,
  particleSize: 2.5,
  drift: 30 + Math.floor(Math.random() * 40), // 30..69
  invert: false,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'dust',
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
let DPR = 1;

// Particle array — each: { homeX, homeY, driftAmp, driftAngle, freq }
let particles = [];
let needsRebuild = true;
let textPixels = null; // cached Uint8ClampedArray from textBuf

// Current loop position — updated by animationLoop so schedule's RAF callback
// can repaint at the same t without resetting to 0 while animating.
let currentT = 0;

let animationId = null;
let animationStartTime = 0;

const dirty = { raster: false, paint: false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster){ rasterizeText(); needsRebuild = true; }
    paint(currentT);
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
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  textPixels = null;
  needsRebuild = true;
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
  textPixels = null;
  needsRebuild = true;
}

function getTextPixels(){
  if(!textPixels){
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    textPixels = tctx.getImageData(0, 0, textBuf.width, textBuf.height).data;
    tctx.restore();
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  return textPixels;
}

function buildParticles(){
  needsRebuild = false;
  const w = cssW(), h = cssH();
  const bw = textBuf.width, bh = textBuf.height;
  const pix = getTextPixels();

  // Collect text pixel positions. Sample every 2nd pixel (backing resolution)
  // for speed — still dense enough to faithfully represent the glyph outline.
  const textPts = [];
  for(let y = 0; y < bh; y += 2){
    for(let x = 0; x < bw; x += 2){
      const idx = (y * bw + x) * 4;
      // White text on transparent: alpha is the reliable discriminator.
      const isText = pix[idx + 3] > 128;
      if(params.invert ? !isText : isText){
        // Convert from backing-resolution coords to CSS px.
        textPts.push({ x: x / DPR, y: y / DPR });
      }
    }
  }

  if(textPts.length === 0){ particles = []; return; }

  const count = Math.round(params.count);
  particles = [];
  for(let i = 0; i < count; i++){
    const src = textPts[i % textPts.length];
    particles.push({
      homeX:      src.x,
      homeY:      src.y,
      driftAmp:   params.drift * (0.4 + Math.random() * 0.6),
      driftAngle: Math.random() * 2 * Math.PI,
      freq:       1 + Math.floor(Math.random() * ANIM.maxFreq), // 1, 2, or 3
    });
  }
}

function paint(t_loop){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  if(needsRebuild) buildParticles();

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  // sin(2π · freq · 0) = 0 for all integer freq → particles at home at t=0 ✓
  // sin(2π · freq · 1) = 0 for all integer freq → particles at home at t=1 ✓
  const phase = (t_loop ?? 0) * 2 * Math.PI;
  const ps = params.particleSize;

  ctx.fillStyle = '#ffffff';
  for(const p of particles){
    const d = p.driftAmp * Math.sin(phase * p.freq);
    const px = p.homeX + d * Math.cos(p.driftAngle);
    const py = p.homeY + d * Math.sin(p.driftAngle);
    ctx.fillRect(px - ps / 2, py - ps / 2, ps, ps);
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){
  rasterizeText();
  buildParticles();
  paint(0);
}

function renderAnimationFrame(t_loop){
  currentT = t_loop;
  paint(t_loop);
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  const t_loop = (elapsed % CYCLE_MS) / CYCLE_MS;
  renderAnimationFrame(t_loop);
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
  // ax → particleSize: 1..8
  params.particleSize = 1 + ax * 7;
  // ay → drift: 0..120
  params.drift = Math.round(ay * 120);
  if(gui){
    gui.rows.get('particleSize')?._write(params.particleSize);
    gui.rows.get('drift')?._write(params.drift);
  }
  needsRebuild = true;
  paint(currentT);
}

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)){ dirty.raster = true; needsRebuild = true; }
    if(key === 'count' || key === 'drift' || key === 'invert' || key === 'particleSize'){
      needsRebuild = true;
    }
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-noise',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  cv.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', () => {
    fitCanvas();
    schedule('raster');
  });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
