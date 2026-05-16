// Blur effect — text rasterised char-by-char with custom letter spacing, then
// blurred via the browser's native gaussian filter, then thresholded into a
// crisp silhouette. The native filter is a true gaussian (σ = radius px in
// backing space); we render at devicePixelRatio backing so the threshold edge
// lands at sub-CSS-pixel resolution and reads as a vector silhouette on
// Retina rather than a 1-bit bitmap.
//
// Animation is built FROM the primitives that make blur blur:
//   - radius (gaussian σ): breathes |sin(2πt)|-shape so it lands at 0 TWICE
//     per cycle. Those two crisp zeros are the legible moments.
//   - letterSpacing: cosine breath through full negative→positive→negative
//     range so glyphs collide, separate, then collide again. One full breath
//     per cycle, phase-offset from the blur breath so legibility lands while
//     spacing is mid-sweep (text is most readable at neutral-ish spacing).
//   - motionAngle: monotonic 0→2π rotation. When user enables motion blur the
//     streak walks the compass; angle stays float and wraps seamlessly.
// Interactive: mouse X drives blurAmount, mouse Y drives letterSpacing.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// Radius peaks at quarter-cycles (t=0.25, t=0.75) and zeros at t=0, t=0.5, t=1.
// Spacing breathes once over the cycle; its phase is shifted so peak spacing
// chaos coincides with maximum blur, and crispness lands near neutral spacing.
const ANIM = {
  blurMax:       34,
  blurFloor:     0,
  spacingAmp:    60,   // sweeps -60 → +60 → -60
  spacingBias:   -8,   // slight pull toward overlap so collisions feel intentional
};
function lerp(a, b, t){ return a + (b - a) * t; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  blurAmount: 10,
  letterSpacing: -40,
  invert: false,
  motion: false,        // gaussian (false) vs horizontal motion blur (true)
  animate: false,
  interactive: false,
  motionAngle: 0,       // radians; only visible when params.motion is true
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'hello',
  textSize: 400,
  bold: true,
  italic: Math.random() < 0.5,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');
const blurBuf = document.createElement('canvas');
const bctx = blurBuf.getContext('2d', { willReadFrequently: true });

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
    if(dirty.raster) rasterizeText();
    if(dirty.build)  buildBlur();
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
  for(const c of [cv, textBuf, blurBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function measureSpaced(text, size){
  tctx.font = fontSpec(size);
  let total = 0;
  for(const ch of text) total += tctx.measureText(ch).width + params.letterSpacing;
  return total - params.letterSpacing;
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
  let measured = measureSpaced(params.text, size);
  const target = w * FIT;
  if(measured > target && measured > 0){
    size = Math.max(12, Math.floor(size * target / measured));
    measured = measureSpaced(params.text, size);
  }
  tctx.font = fontSpec(size);
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  let x = w / 2 - measured / 2;
  const y = h / 2;
  for(const ch of params.text){
    const cw = tctx.measureText(ch).width;
    tctx.fillText(ch, x + cw / 2, y);
    x += cw + params.letterSpacing;
  }
}

// Native gaussian blur via ctx.filter — true Gaussian σ in backing pixels.
// We multiply by DPR so the σ specified in params.blurAmount is interpreted
// in CSS px, giving stable visual blur radius across display densities.
function buildBlur(){
  const radius = Math.max(0, params.blurAmount);
  bctx.save();
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, blurBuf.width, blurBuf.height);
  if(params.motion && radius > 0){
    // Motion blur — drag a streak of the text along motionAngle. Each ghost
    // is alpha-blended; combined opacity ~1 at any in-trail pixel.
    const steps = Math.max(1, Math.round(radius * 2));
    const spread = radius * DPR * 2;
    const ang = params.motionAngle || 0;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    bctx.globalAlpha = 1 / steps;
    for(let i = 0; i <= steps; i++){
      const s = -spread / 2 + (spread * i) / steps;
      bctx.drawImage(textBuf, s * ux, s * uy);
    }
    bctx.globalAlpha = 1;
  } else if(radius > 0){
    bctx.filter = `blur(${radius * DPR}px)`;
    bctx.drawImage(textBuf, 0, 0);
    bctx.filter = 'none';
  } else {
    bctx.drawImage(textBuf, 0, 0);
  }
  bctx.restore();
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function hexToRgb(hex){
  const m = /^#?([a-f0-9]{6})$/i.exec(hex);
  if(!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function paint(){
  window.WAGUI?.flashValues(params);
  const bw = blurBuf.width, bh = blurBuf.height;
  // Pull blurred pixels at full backing resolution, threshold them, paint
  // result onto cv at backing res too.
  const img = bctx.getImageData(0, 0, bw, bh);
  const px = img.data;
  const [br, bgC, bb] = hexToRgb(params.bg);
  const TH = 128;
  const inv = params.invert;
  for(let i = 0; i < px.length; i += 4){
    const a = px[i + 3];
    const lum = a < 8 ? 0 : (px[i] + px[i + 1] + px[i + 2]) / 3;
    const isWhite = inv ? (lum < TH) : (lum >= TH);
    if(isWhite){
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
    } else {
      px[i] = br;  px[i + 1] = bgC; px[i + 2] = bb;
    }
    px[i + 3] = 255;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); buildBlur(); paint(); }

function renderAnimationFrame(t_loop){
  // t_loop ∈ [0,1). All curves are exact-periodic in t_loop so frame 0 == frame N.
  const TAU = Math.PI * 2;
  // Radius: |sin(2π·t)|-style breath via (1 - cos(4π·t))/2. Zero at t=0, 0.5, 1.
  // Two legible moments per cycle (t≈0 and t≈0.5) — crisp text emerges, smears
  // back into a blob, re-forms, smears again.
  const radiusShape = (1 - Math.cos(t_loop * 2 * TAU)) / 2;       // 0..1..0..1..0
  const b = ANIM.blurFloor + radiusShape * (ANIM.blurMax - ANIM.blurFloor);

  // letterSpacing: full cosine breath through -amp..+amp..-amp over the cycle,
  // phase-shifted by a quarter so spacing crosses zero (most legible) right at
  // the blur zeros. cos(0)=1 means rest spacing = +amp+bias; we want the
  // legible moments to land at neutral spacing, so use sin(2π·t) which is 0
  // at t=0, +1 at t=0.25, 0 at t=0.5, -1 at t=0.75, 0 at t=1.
  const l = ANIM.spacingBias + ANIM.spacingAmp * Math.sin(t_loop * TAU);

  // motionAngle: monotonic 0→2π. Wraps cleanly (cos/sin periodic).
  const ang = t_loop * TAU;

  params.blurAmount = b;
  params.letterSpacing = l;
  params.motionAngle = ang;

  if(gui){
    gui.rows.get('blurAmount')?._write(b);
    gui.rows.get('letterSpacing')?._write(l);
  }
  rasterizeText();
  buildBlur();
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

function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
  params.blurAmount    = Math.max(1, Math.round(1 + ax * 39));
  params.letterSpacing = Math.round(-50 + ay * 150);
  if(gui){
    gui.rows.get('blurAmount')?._write(params.blurAmount);
    gui.rows.get('letterSpacing')?._write(params.letterSpacing);
  }
  dirty.raster = true;
  schedule('raster');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic','letterSpacing']);
const BUILD_KEYS  = new Set(['blurAmount']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState && window.WAState.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)) dirty.raster = true;
    if(RASTER_KEYS.has(key) || BUILD_KEYS.has(key)) dirty.build = true;
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else if(BUILD_KEYS.has(key)) schedule('build');
    else schedule('paint');
  });
  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-blur',
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
