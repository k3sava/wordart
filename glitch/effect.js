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
// Animation — controlled wrongness, two legibility moments per loop:
//   * rgbOffset follows cos(2π·t) · AMP — channels swing +amp → 0 → −amp → 0
//     → +amp. The two zero-crossings (t≈0.25, t≈0.75) snap channels into
//     alignment: text reads clean. The polarity flip mid-loop means R and B
//     swap sides — wrongness asymmetric, not symmetric.
//   * tearAmount tracks |sin(2π·t)|^0.6 — tears collapse to 0 *exactly* where
//     RGB collapses, then re-blow between. Power < 1 sharpens the legible
//     window and slurs the chaos.
//   * tearDensity rides 1 − |sin(2π·t)|^1.4 inverse — fewer-but-wider tears
//     at chaos peak, denser-but-shorter at legibility approach.
//   * rollSpeed scrolls the band pattern vertically — the "tape" creeps so
//     successive frames evolve instead of pulsing in place.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// Curve amplitudes (peaks, not rest values — wave does the rest=0 work).
const ANIM = {
  rgbOffsetAmp:  120,
  tearAmountAmp:  55,
  tearDensityHi:  45,
  tearDensityLo:  6,
  rollBandsPerCycle: 4,
};
function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  rgbOffset: 24,
  tearAmount: 10,
  tearDensity: 12,
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
// Signed RGB offset and a vertical roll offset live outside `params` so the
// GUI slider (unsigned, 0..160) doesn't fight the canvas's smooth float math.
let rgbOffsetSigned = 0;
let rollOffsetPx = 0;
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
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  // Animation drives a signed offset; sliders/interactive drive unsigned.
  // When the unsigned slider differs from |signed|, prefer signed (animation
  // is the source of truth while animating).
  const off = params.animate ? rgbOffsetSigned : Math.max(0, params.rgbOffset);
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
  // being torn by ±rand × amount. Roll offset slides the band grid down so
  // bands creep over time rather than blinking in place.
  const BANDS = 24;
  const bandH = Math.ceil(h / BANDS);
  // rollOffsetPx is in *bands* (fractional). Convert to px, wrap modulo bandH.
  // Because rollOffsetPx goes 0 → rollBandsPerCycle exactly across a cycle,
  // and rollBandsPerCycle is an integer, the wrap closes seamlessly at loop end.
  const rollPx = rollOffsetPx * bandH;
  const roll = ((rollPx % bandH) + bandH) % bandH;
  for(let i = -1; i < BANDS; i++){
    const r1 = rng(), r2 = rng();
    if(r1 * 100 > densityPct) continue;
    const dx = Math.round((r2 - 0.5) * 2 * amount);
    if(dx === 0) continue;
    const y = i * bandH + roll;
    const yClamped = Math.max(0, y);
    const sh = Math.min(bandH - (yClamped - y), h - yClamped);
    if(sh <= 0) continue;
    // Read this strip from the canvas and re-paste at a horizontal offset.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clear the destination band first (paint over with bg) so the original
    // pixels don't bleed through.
    ctx.fillStyle = params.bg;
    ctx.fillRect(0, yClamped * DPR, cv.width, sh * DPR);
    ctx.drawImage(
      cv,
      0,           yClamped * DPR,   cv.width,       sh * DPR,
      dx * DPR,    yClamped * DPR,   cv.width,       sh * DPR,
    );
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
}

function redraw(){ rasterizeText(); paint(); }

function applyAnimationT(t_loop){
  // Cosine wave: crosses 0 at t=0.25 and t=0.75 → two clean-text moments per
  // loop. cos(0)=1 so frame 0 == frame 1 (seamless), and the sign flip means
  // R/B channels swap which side they're on at the loop midpoint.
  const phase = 2 * Math.PI * t_loop;
  rgbOffsetSigned = Math.cos(phase) * ANIM.rgbOffsetAmp;

  // |sin(2π·t)| peaks at 0.25 and 0.75 — but those are the *clean* moments.
  // We want the opposite: tear loud at 0, 0.5, 1; quiet at 0.25, 0.75. Use
  // |cos(2π·t)| instead, gated by a soft power curve.
  const tearGate = Math.pow(Math.abs(Math.cos(phase)), 0.6);
  const ta = tearGate * ANIM.tearAmountAmp;
  // Density: high at chaos peaks, low at alignment (so the legible moment
  // is genuinely clean, not partially torn).
  const td = lerp(ANIM.tearDensityLo, ANIM.tearDensityHi, tearGate);
  // Vertical roll — store as a fractional bands count; converted to px in
  // applyTears against the live band height so it wraps exactly each cycle.
  rollOffsetPx = t_loop * ANIM.rollBandsPerCycle; // unit: bands, not px

  // GUI sliders show unsigned magnitudes (visual snap is fine; the actual
  // canvas math uses the float values above).
  const rgbDisplay = Math.abs(rgbOffsetSigned);
  if(gui){
    gui.rows.get('rgbOffset')?._write(rgbDisplay);
    gui.rows.get('tearAmount')?._write(ta);
    gui.rows.get('tearDensity')?._write(td);
  }
  params.rgbOffset = rgbDisplay;
  params.tearAmount = ta;
  params.tearDensity = td;
}

function renderAnimationFrame(t_loop){
  applyAnimationT(t_loop);
  // Reseed tear pattern in 12 slots per cycle (every ~1.25 s) so torn bands
  // shift without flickering frame-to-frame. Round-and-wrap means slot(0) ==
  // slot(1-ε): the loop closes on the same tear pattern it opened with.
  const SLOTS = 12;
  const slot = Math.round(t_loop * SLOTS) % SLOTS;
  // Always derive seed from slot — deterministic, so frame N seeds == frame 0.
  tearSeed = (slot * 9301 + 49297) | 0;
  lastTearStamp = slot;
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
