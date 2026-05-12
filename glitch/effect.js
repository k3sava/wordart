// Glitch effect — text rasterised once, then composited into R, G, B channels
// with independent horizontal offsets. Tear bands shift horizontal strips of
// the composite. Scanlines darken every other row.
//
// We render the text white onto textBuf, then composite three times into the
// main canvas using globalCompositeOperation 'lighter' (additive) — drawing
// the same mask with multiply-tinted red/green/blue copies at three offsets.
// On a black background you get classic CRT chroma split; on a coloured bg
// the channels punch through and read as separation against the bg.
//
// Animate: rgbOffset HUGE → 0 → HUGE. Intro/outro IS the channel separation.
// Interactive: cursor X drives rgbOffset, cursor Y drives tearAmount.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  rgbOffset:   { rest: 110, peak:   0 },
  tearAmount:  { rest:  80, peak:   0 },
  tearDensity: { rest:  70, peak:   8 },
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  rgbOffset: 24,
  tearAmount: 20,
  tearDensity: 30,
  scanlines: 25,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('heavy') : 'hello',
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
// Tint buffer — used to multiply mask × channel colour before additive paste.
const tintBuf = document.createElement('canvas');
const xctx = tintBuf.getContext('2d');

let animationId = null;
let animationStartTime = 0;
let gui;
let DPR = 1;
// Stable per-row jitter seed; refreshed sparingly during animation for a
// "frozen tape" feel rather than a sand-storm.
let tearSeed = Math.random() * 1e9;
let lastTearStamp = 0;

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
  for(const c of [cv, textBuf, tintBuf]){
    if(c.width !== bw) c.width = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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

function buildTinted(color){
  // mask × color → tintBuf. Use 'source-in' to keep only mask alpha, with fill.
  xctx.save();
  xctx.setTransform(1, 0, 0, 1, 0, 0);
  xctx.clearRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.drawImage(textBuf, 0, 0);
  xctx.globalCompositeOperation = 'source-in';
  xctx.fillStyle = color;
  xctx.fillRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.restore();
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function paint(){
  const w = cssW(), h = cssH();
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  const off = Math.max(0, params.rgbOffset);
  // Additive blending so R+G+B reconverge to white where they overlap.
  ctx.globalCompositeOperation = 'lighter';

  const channels = [
    { color: '#FF0000', dx: -off },
    { color: '#00FF00', dx: 0 },
    { color: '#0000FF', dx:  off },
  ];
  for(const ch of channels){
    buildTinted(ch.color);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tintBuf, ch.dx * DPR, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Tear bands — copy strips of the composite to a shifted x.
  applyTears(w, h);

  // Scanlines — translucent dark stripes every 2 rows.
  if(params.scanlines > 0){
    const a = (params.scanlines / 100) * 0.55;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    for(let y = 0; y < h; y += 3){
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }
}

// Cheap deterministic PRNG so band selection is stable per "seed".
function srand(seed){
  let s = seed | 0;
  return function(){
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

function applyTears(w, h){
  const amount = params.tearAmount;
  const densityPct = params.tearDensity;
  if(amount <= 0 || densityPct <= 0) return;
  const rng = srand(tearSeed | 0);
  // Cut the canvas into 24 horizontal bands; each has p(densityPct/100) of
  // being torn by ±rand × amount.
  const BANDS = 24;
  const bandH = Math.ceil(h / BANDS);
  for(let i = 0; i < BANDS; i++){
    const r1 = rng(), r2 = rng();
    if(r1 * 100 > densityPct) continue;
    const dx = Math.round((r2 - 0.5) * 2 * amount);
    if(dx === 0) continue;
    const y = i * bandH;
    const sh = Math.min(bandH, h - y);
    if(sh <= 0) continue;
    // Read this strip from the canvas and re-paste at a horizontal offset.
    // Use the canvas itself as source via drawImage(cv, sx, sy, sw, sh, dx, dy, dw, dh).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clear the destination band first (paint over with bg) so the original
    // pixels don't bleed through.
    ctx.fillStyle = params.bg;
    ctx.fillRect(0, y * DPR, cv.width, sh * DPR);
    ctx.drawImage(
      cv,
      0,           y * DPR,           cv.width,       sh * DPR,
      dx * DPR,    y * DPR,           cv.width,       sh * DPR,
    );
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
}

function redraw(){ rasterizeText(); paint(); }

function applyAnimationT(t01){
  const r = lerp(ANIM.rgbOffset.rest, ANIM.rgbOffset.peak, t01);
  const ta = lerp(ANIM.tearAmount.rest, ANIM.tearAmount.peak, t01);
  const td = lerp(ANIM.tearDensity.rest, ANIM.tearDensity.peak, t01);
  if(gui){
    gui.rows.get('rgbOffset')?._write(r);
    gui.rows.get('tearAmount')?._write(ta);
    gui.rows.get('tearDensity')?._write(td);
  }
  params.rgbOffset = r;
  params.tearAmount = ta;
  params.tearDensity = td;
}

function renderAnimationFrame(t_loop){
  const t01 = (1 - Math.cos(t_loop * 2 * Math.PI)) / 2;
  applyAnimationT(t01);
  // Reseed tear pattern ~6 times per cycle (every ~2.5 s) so torn bands shift
  // without flickering frame-to-frame.
  const slot = Math.floor(t_loop * 6);
  if(slot !== lastTearStamp){ tearSeed = (t_loop * 1e9) | 0; lastTearStamp = slot; }
  paint();
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
  params.rgbOffset  = Math.round(ax * 160);
  params.tearAmount = Math.round(ay * 200);
  if(gui){
    gui.rows.get('rgbOffset')?._write(params.rgbOffset);
    gui.rows.get('tearAmount')?._write(params.tearAmount);
  }
  tearSeed = (performance.now() / 90) | 0;
  schedule('paint');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

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
      name: 'wordart-glitch',
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
