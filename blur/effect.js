// Blur effect — text rasterised char-by-char with custom letter spacing, then
// blurred via the browser's native gaussian filter, then thresholded into a
// crisp silhouette. The native filter is a true gaussian (σ = radius px in
// backing space); we render at devicePixelRatio backing so the threshold edge
// lands at sub-CSS-pixel resolution and reads as a vector silhouette on
// Retina rather than a 1-bit bitmap.
//
// Animation is built FROM the primitives that make blur blur:
//   - blurAmount (gaussian σ): keyframe arc across 30s with three wow moments
//   - letterSpacing: cosine breath through full negative→positive→negative
//     range so glyphs collide, separate, then collide again.
//   - motionAngle: monotonic 0→2π rotation. When user enables motion blur the
//     streak walks the compass; angle stays float and wraps seamlessly.
// Interactive: WAInteract drives blurAmount (X-axis) and letterSpacing (Y-axis).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

const ANIM = {
  blurMax:       34,
  blurFloor:     0,
  spacingAmp:    60,   // sweeps -60 → +60 → -60
  spacingBias:   -8,   // slight pull toward overlap so collisions feel intentional
};
function lerp(a, b, t){ return a + (b - a) * t; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Keyframe interpolator: stops = [[t, v], ...]
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

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
const bctx = blurBuf.getContext('2d');

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

function paint(){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  // Fill background first
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  // Threshold the blurred text via GPU contrast filter — contrast(999) turns
  // any non-zero pixel into full white/black without a JS pixel loop.
  // brightness(10) boosts dim edges before contrast crushes them to solid.
  ctx.filter = params.invert
    ? 'contrast(999) brightness(10) invert(1)'
    : 'contrast(999) brightness(10)';
  ctx.drawImage(blurBuf, 0, 0, blurBuf.width, blurBuf.height, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); buildBlur(); paint(); }

function renderAnimationFrame(t_loop){
  // t_loop ∈ [0,1). All curves are exact-periodic so frame 0 == frame N.
  // 30-second arc with three wow moments:
  //   t=0.00 — crisp text (radius=0)
  //   t=0.10 — gentle glow ramp starts
  //   t=0.20 — WOW #1: full mist (max blur + spread)
  //   t=0.30 — text resolves back
  //   t=0.33 — invert flips on
  //   t=0.40 — WOW #2: inverted max blur (white field, dark text cutout)
  //   t=0.50 — inverted crisp text
  //   t=0.55 — invert flips back
  //   t=0.65 — crisp normal text
  //   t=0.70 — rapid blur ramp
  //   t=0.80 — WOW #3: extreme blur, text barely a whisper
  //   t=0.90 — resolves from mist
  //   t=1.00 — crisp (seamless loop)

  const b = kf(t_loop, [
    [0.00,  0],
    [0.10,  4],
    [0.20, 34],
    [0.30,  2],
    [0.33,  2],
    [0.40, 34],
    [0.50,  0],
    [0.55,  0],
    [0.65,  0],
    [0.70,  6],
    [0.80, 34],
    [0.90,  2],
    [1.00,  0],
  ]);

  const l = kf(t_loop, [
    [0.00,  -8],
    [0.10, -30],
    [0.20,  40],
    [0.30,  -8],
    [0.40,  50],
    [0.50,  -8],
    [0.55,  -8],
    [0.65,  -8],
    [0.70,  20],
    [0.80,  60],
    [0.90,  -8],
    [1.00,  -8],
  ]);

  // Invert flips on between t=0.33 and t=0.55
  const shouldInvert = t_loop >= 0.33 && t_loop < 0.55;
  if(params.invert !== shouldInvert){
    params.invert = shouldInvert;
    if(gui) gui.rows.get('invert')?._write(shouldInvert);
  }

  // motionAngle: monotonic 0→2π. Wraps cleanly (cos/sin periodic).
  const ang = t_loop * Math.PI * 2;

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

  // WAInteract wiring — if available, replaces old mousemove listener
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.blurAmount    = Math.max(1, Math.round(1 + ax * 39));
        params.letterSpacing = Math.round(-50 + ay * 150);
        gui?.rows.get('blurAmount')?._write(params.blurAmount);
        gui?.rows.get('letterSpacing')?._write(params.letterSpacing);
        schedule('raster');
      },
      onWheel(dy){
        params.blurAmount = Math.max(0, Math.min(40, params.blurAmount + Math.round(dy * 0.05)));
        gui?.rows.get('blurAmount')?._write(params.blurAmount);
        if(!params.animate) schedule('build');
      },
      onClick(){
        // Cycle to a random new bg color
        params.bg = ELECTRIC_COLORS[Math.floor(Math.random() * ELECTRIC_COLORS.length)];
        gui?.rows.get('bg')?._write(params.bg);
        if(!params.animate) schedule('paint');
      },
    });
  } else {
    // Fallback: legacy mousemove handler
    cv.addEventListener('mousemove', handleMouseMove);
  }

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
