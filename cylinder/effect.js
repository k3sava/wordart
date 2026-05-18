// Cylinder effect — text letters are wrapped around a 3D cylinder in perspective.
// Characters at the sides of the cylinder appear horizontally squished (foreshortened
// by cos(angle)). The cylinder rotates during animation, giving a satisfying 3D
// spinning reveal.
//
// Inspired by Space Type Generator by Kiel Mutschelknaus (spacetypegenerator.com).
//
// No textBuf pixel data — charLayouts built by measuring character widths, then
// each character is drawn individually with an x-scale from cos(angle) for the
// 3D foreshortening illusion.
//
// Animate: 30s keyframed arc with 3 WOW moments. Seamless loop.
// Interactive: cursor X → rotation (0°–360°), cursor Y → tilt (0°–60°).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — piecewise-linear keyframe interpolator
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  rotation: 0,
  tilt: 15,
  radius: 180,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'cylinder',
  textSize: 360,
  bold: Math.random() < 0.5,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
  invert: false,
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

let animationId   = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Character layout data — recomputed when text/font params change.
// Each entry: { char: string, x: number } (x in CSS px from start of string)
let charLayouts    = [];
let totalTextWidth = 0;
let computedSize   = params.textSize;

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

// rasterizeText: measure character widths and build charLayouts.
// Does NOT draw — paint() uses charLayouts to draw each char with 3D transform.
function rasterizeText(boldOverride, italicOverride){
  const w   = cssW();
  const FIT = 0.92;
  let size  = params.textSize;

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
}

function paint(overrideRotation, overrideTilt, overrideRadius, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  const rotDeg  = overrideRotation != null ? overrideRotation : params.rotation;
  const tiltDeg = overrideTilt     != null ? overrideTilt     : params.tilt;
  const R       = overrideRadius   != null ? overrideRadius   : params.radius;

  const rotRad  = -rotDeg * Math.PI / 180;  // negative = first letter enters from right
  const tiltRad = tiltDeg * Math.PI / 180;

  const fgColor = params.invert ? params.bg : '#ffffff';
  const bgColor = params.invert ? '#ffffff' : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  ctx.font         = fontSpec(computedSize, b, it);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';

  const cx = w / 2;
  const cy = h / 2;
  const n  = charLayouts.length;

  // Arc span: how much of the cylinder circumference the text covers.
  // We map total text width to an arc of the cylinder.
  // circumference = 2πR, we use the full 2π so text wraps completely.
  // Each char center's angle: θ = ((cumX + w/2) / totalTextWidth) * arcSpan - arcSpan/2
  // arcSpan = 2π means full wrap; text repeats if it's long enough.
  // We use arcSpan = 2π always — the text stretches or squishes around the cylinder.
  const arcSpan = 2 * Math.PI;

  // Sort characters by their screen depth (sin of angle) so farther ones paint first.
  // We build a list of { index, depth } and sort before drawing.
  const drawOrder = [];
  for(let i = 0; i < n; i++){
    const c = charLayouts[i];
    const centerX = c.x + c.w * 0.5;
    const theta   = (centerX / totalTextWidth) * arcSpan - arcSpan / 2;
    const angle   = theta + rotRad;
    // depth: cos(angle) — negative = behind cylinder, positive = in front
    drawOrder.push({ i, angle, depth: Math.cos(angle) });
  }
  // Back-to-front: paint behind characters first (they'll be covered by front ones)
  drawOrder.sort((a, b) => a.depth - b.depth);

  for(const { i, angle, depth } of drawOrder){
    const c      = charLayouts[i];
    const scaleX = Math.cos(angle);         // foreshortening factor
    const screenX = cx + R * Math.sin(angle);
    // Vertical displacement from tilt: cylinder tilts away from viewer
    const yTilt  = R * Math.sin(tiltRad) * Math.cos(angle);
    const screenY = cy + yTilt;

    // Alpha: characters facing viewer are fully opaque; back-facing fade to near-zero.
    // scaleX > 0 = front, scaleX < 0 = back. We allow slight bleed-through.
    const alpha = Math.max(0, scaleX);
    if(alpha < 0.01) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = fgColor;
    ctx.translate(screenX, screenY);
    // Horizontal squeeze for perspective foreshortening
    ctx.scale(scaleX, 1);
    // Center the character glyph at its render position
    ctx.fillText(c.char, -c.w * 0.5, 0);
    ctx.restore();
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // 30s WOW animation arc:
  // t=0.00: rotation=0, tilt=0 — crisp full text facing forward
  // t=0.12: slow rotation begins
  // t=0.25: WOW #1 — fast spin, text blurs across the cylinder
  // t=0.35: stops facing front, all text visible again
  // t=0.45: tilt increases dramatically
  // t=0.60: WOW #2 — extreme tilt + spinning, chaotic
  // t=0.72: resolves — normal tilt, slow spin
  // t=0.80: radius contracts — text wraps tighter
  // t=0.90: WOW #3 — text overlaps at tiny radius, letters collide
  // t=1.00: back to t=0.00

  const rotDeg = kf(t_loop, [
    [0.00,   0],
    [0.12,  15],
    [0.20, 160],   // building up fast spin
    [0.25, 720],   // WOW #1: double rotation (fast spin)
    [0.33, 1080],  // still spinning
    [0.35, 1080],  // lands on full rotation mod — appears at front
    [0.45, 1140],  // slow rotation continues
    [0.55, 1260],  // WOW #2: spin + tilt chaos
    [0.65, 1440],
    [0.72, 1440],  // stop — resolves
    [0.80, 1530],  // gentle spin
    [0.88, 1680],  // WOW #3 spin-up
    [0.95, 1980],
    [1.00, 2160],  // back to exact full rotations (2160 = 6×360 → mod 360 = 0)
  ]);

  const tiltDeg = kf(t_loop, [
    [0.00,   0],
    [0.35,   0],   // flat until WOW #2 setup
    [0.45,  35],   // tilt emerges
    [0.55,  65],   // WOW #2: extreme tilt
    [0.65,  70],
    [0.72,  15],   // resolves
    [0.80,  15],
    [0.90,  30],   // WOW #3 slight tilt
    [1.00,   0],
  ]);

  const radius = kf(t_loop, [
    [0.00, 180],
    [0.35, 180],
    [0.72, 180],
    [0.80, 120],   // contracts
    [0.87,  60],   // WOW #3: tiny radius, text overlaps itself
    [0.94,  40],
    [1.00, 180],   // springs back
  ]);

  // Bold flickers during WOW #3 for typographic chaos
  const boldOn   = (t_loop >= 0.88 && t_loop < 0.98) ? (Math.floor(t_loop * 12) % 2 === 0) : params.bold;
  const italicOn = t_loop >= 0.92 && t_loop < 0.98;

  // Normalise rotDeg into 0–360 for the param display
  const rotDisplay = ((rotDeg % 360) + 360) % 360;

  params.rotation = rotDisplay;
  params.tilt     = tiltDeg;
  params.radius   = radius;

  if(gui){
    gui.rows?.get('rotation')?._write(Math.round(rotDisplay));
    gui.rows?.get('tilt')?._write(Math.round(tiltDeg));
    gui.rows?.get('radius')?._write(Math.round(radius));
  }

  // Use the raw rotDeg (un-modded) so the actual spin angle is monotonically correct,
  // then convert to radians inside paint via rotDeg*π/180.
  // We override rotRad directly: pass raw degree value; paint converts.
  rasterizeText(boldOn, italicOn);
  paint(rotDeg, tiltDeg, radius, boldOn, italicOn);
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

// Interactive: X → rotation (0°–360°), Y → tilt (0°–60°)
function handleMouseMove(e){
  if(!params.interactive || params.animate) return;
  const r  = cv.getBoundingClientRect();
  const ax = Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width));
  const ay = Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height));
  params.rotation = Math.round(ax * 360);
  params.tilt     = Math.round((1 - ay) * 60);
  if(gui){
    gui.rows?.get('rotation')?._write(params.rotation);
    gui.rows?.get('tilt')?._write(params.tilt);
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
      name: 'wordart-cylinder',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.rotation = Math.round(ax * 360);
        params.tilt     = Math.round((1 - ay) * 60);
        if(gui){
          gui.rows?.get('rotation')?._write(params.rotation);
          gui.rows?.get('tilt')?._write(params.tilt);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.radius = Math.max(20, Math.min(400, params.radius - dy * 0.5));
        gui?.rows?.get('radius')?._write(Math.round(params.radius));
        if(!params.animate) schedule('paint');
      },
      onClick(ax, ay){
        params.rotation = Math.round(Math.random() * 360);
        gui?.rows?.get('rotation')?._write(params.rotation);
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
