// Interference effect — two overlapping sine-wave stripe grids create a
// Moiré-like interference pattern. Text is revealed only where the pattern
// is "bright" (constructive interference) and hidden where it's "dark"
// (destructive interference). During animation one grid slowly rotates while
// the other stays fixed, causing the characteristic Moiré shimmer — the text
// constantly flickers in and out of visibility as the pattern sweeps through.
//
// Rendering approach: NO pixel-by-pixel sampling.
// 1. Draw two families of parallel stripes on an offscreen canvas (as thin
//    opaque bands, one set horizontal, one rotated by `angle`). Stripe width
//    is controlled by `threshold` (0 = hairlines, 1 = solid fill).
// 2. Draw the text as white on black on a second offscreen canvas (mask).
// 3. Composite: pattern canvas uses destination-in with the text mask, so
//    the interference stripes are clipped to the text glyph shapes.
// 4. Draw the masked result over the background on the main canvas.
//
// Credit: inspired by Moiré pattern typography and optical art.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  freq1: 8,
  freq2: 11,
  angle: 20,
  threshold: 0.5,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'interference',
  textSize: 400,
  bold: true,
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

// Computed text size after auto-fit scaling.
let computedSize = params.textSize;

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

// Measure the text at params.textSize and compute a scaling factor so it fits
// the canvas width. Stores result in `computedSize`.
function rasterizeText(boldOverride, italicOverride){
  const w = cssW();
  const FIT = 0.92;
  let size = params.textSize;

  ctx.save();
  ctx.font = fontSpec(size, boldOverride, italicOverride);

  let total = ctx.measureText(params.text).width;

  if(total > w * FIT && total > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / total));
    ctx.font = fontSpec(size, boldOverride, italicOverride);
  }
  computedSize = size;

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---------------------------------------------------------------------------
// makeOffscreen(w, h) — returns { canvas, ctx } at the given CSS pixel size.
// ---------------------------------------------------------------------------
function makeOffscreen(w, h){
  const oc = document.createElement('canvas');
  oc.width  = Math.round(w * DPR);
  oc.height = Math.round(h * DPR);
  const oc2 = oc.getContext('2d');
  oc2.setTransform(DPR, 0, 0, DPR, 0, 0);
  return { canvas: oc, ctx: oc2 };
}

// ---------------------------------------------------------------------------
// drawStripes(oc2, w, h, freq, angleRad, phase, threshold, color)
//
// Draws one family of parallel sine-modulated bands on the context `oc2`.
// Direction is given by `angleRad` (0 = horizontal stripes).
// `freq` is the number of full stripe cycles across the canvas height.
// `phase` (radians) shifts all stripes.
// `threshold` (0–1) controls duty cycle: 0 = hairlines, 1 = fully solid.
// ---------------------------------------------------------------------------
function drawStripes(oc2, w, h, freq, angleRad, phase, threshold, color){
  // Period in CSS px measured along the axis perpendicular to the stripes.
  const period = h / Math.max(0.5, freq);
  // Half-width of each bright band (stripe) in CSS px.
  const halfW  = (threshold * 0.5) * period;
  if(halfW <= 0) return;

  oc2.save();
  oc2.fillStyle = color;

  // We draw stripes by translating/rotating the canvas so that the stripe
  // direction is always "vertical" (along the y axis after transform), then
  // drawing thin horizontal fillRects spaced by `period`.

  // Center of canvas — we rotate around the center so the pattern tiles
  // symmetrically.
  const cx = w / 2;
  const cy = h / 2;

  oc2.translate(cx, cy);
  oc2.rotate(angleRad);
  oc2.translate(-cx, -cy);

  // After rotation, we need to fill a region large enough to cover the whole
  // (rotated) canvas. The diagonal gives a safe oversize.
  const diag = Math.ceil(Math.sqrt(w * w + h * h));
  const startY = cy - diag;
  const endY   = cy + diag;

  // Snap to the grid defined by `phase`.
  // Phase shifts the first stripe origin.
  const phaseOffset = (phase / (2 * Math.PI)) * period;
  const firstY = startY - ((startY - cy - phaseOffset) % period + period) % period;

  for(let y = firstY; y < endY; y += period){
    // Each stripe centered at y, height = 2*halfW.
    oc2.fillRect(-diag, y - halfW, diag * 2, halfW * 2);
  }

  oc2.restore();
}

// ---------------------------------------------------------------------------
// paint(overrides)
// ---------------------------------------------------------------------------
function paint(overrideAngle, overridePhase1, overridePhase2, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  const angleRad  = ((overrideAngle != null ? overrideAngle : params.angle) * Math.PI / 180);
  const phase1    = overridePhase1 != null ? overridePhase1 : 0;
  const phase2    = overridePhase2 != null ? overridePhase2 : 0;
  const freq1     = Math.max(0.5, params.freq1);
  const freq2     = Math.max(0.5, params.freq2);
  const threshold = Math.max(0, Math.min(1, params.threshold));

  const fgColor = params.invert ? params.bg  : '#ffffff';
  const bgColor = params.invert ? '#ffffff'  : params.bg;

  // ── Background ──────────────────────────────────────────────────────────
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  // ── Offscreen: interference pattern ─────────────────────────────────────
  // Draw two overlapping stripe families. Grid 1 is horizontal (0°), Grid 2
  // is rotated by angleRad. Where both grids are "bright" (constructive
  // interference) fgColor is fully opaque; where only one is bright it's
  // half-bright; where neither (destructive) nothing is drawn.
  //
  // Implementation: draw grid 1 with full opacity, then draw grid 2 on top
  // with globalCompositeOperation = 'source-atop'. This keeps only the
  // pixels where both grids overlap — true constructive interference.
  // Alternatively, draw each grid at alpha=0.75 so their union is bright and
  // their intersection is brilliant. We use the simpler "just draw both and
  // let them stack" approach with globalAlpha=0.7 each so overlay looks good.

  const ptn = makeOffscreen(w, h);
  // Grid 1 — horizontal stripes
  drawStripes(ptn.ctx, w, h, freq1, 0, phase1, threshold, fgColor);
  // Grid 2 — rotated stripes
  // Use 'lighter' so intersections get double-bright — Moiré glow effect.
  ptn.ctx.globalCompositeOperation = 'lighter';
  ptn.ctx.globalAlpha = 0.75;
  drawStripes(ptn.ctx, w, h, freq2, angleRad, phase2, threshold, fgColor);
  ptn.ctx.globalCompositeOperation = 'source-over';
  ptn.ctx.globalAlpha = 1;

  // ── Offscreen: text mask ─────────────────────────────────────────────────
  // White glyph on black background. destination-in will keep only the pixels
  // inside the white glyph shape.
  const mask = makeOffscreen(w, h);
  mask.ctx.fillStyle = '#000000';
  mask.ctx.fillRect(0, 0, w, h);
  mask.ctx.fillStyle = '#ffffff';
  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  mask.ctx.font          = fontSpec(computedSize, b, it);
  mask.ctx.textAlign     = 'center';
  mask.ctx.textBaseline  = 'middle';
  mask.ctx.fillText(params.text, w / 2, h / 2);

  // ── Composite: clip pattern to text ─────────────────────────────────────
  ptn.ctx.globalCompositeOperation = 'destination-in';
  ptn.ctx.drawImage(mask.canvas, 0, 0, ptn.canvas.width, ptn.canvas.height);

  // ── Draw masked pattern onto main canvas ────────────────────────────────
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(ptn.canvas, 0, 0, w, h);

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

// ---------------------------------------------------------------------------
// Animation — 30s keyframed arc
// t=0.00: gentle shimmer, freq1=8, freq2=11, angle=20°
// t=0.20: WOW #1 — freq2 spikes to 40: fine interference, optical vibration
// t=0.35: angle sweeps 90° fast: pattern flips orientation dramatically
// t=0.50: WOW #2 — freq1 and freq2 converge: beat frequency / slow pulsing
// t=0.65: WOW #3 — angle rotates continuously fast: strobe-like text flicker
// t=0.80: resolves to gentle shimmer
// t=1.00: seamless back to start
// ---------------------------------------------------------------------------
function renderAnimationFrame(t_loop){
  const freq1Val = kf(t_loop, [
    [0.00,  8],
    [0.20,  8],
    [0.40, 18],  // converge toward freq2 for beats
    [0.50, 15],  // WOW #2: beats
    [0.60, 10],
    [0.65, 30],  // WOW #3: high freq strobe
    [0.80,  8],
    [1.00,  8],
  ]);

  const freq2Val = kf(t_loop, [
    [0.00, 11],
    [0.20, 40],  // WOW #1: freq2 spike → optical vibration
    [0.35, 40],
    [0.40, 18],  // converge toward freq1 for beats
    [0.50, 15],  // WOW #2: beats — same freq = slow pulsing
    [0.60, 11],
    [0.65, 28],  // WOW #3: near-unison → rapid strobe
    [0.80, 11],
    [1.00, 11],
  ]);

  // Angle: slow rotation baseline; fast sweep at t=0.35; continuous fast at t=0.65
  let angleDeg;
  if(t_loop >= 0.30 && t_loop < 0.42){
    // Fast 90° sweep
    const sub = (t_loop - 0.30) / 0.12;
    angleDeg = 20 + sub * 90;
  } else if(t_loop >= 0.63 && t_loop < 0.78){
    // Continuous fast rotation — strobe WOW
    const sub = (t_loop - 0.63) / 0.15;
    angleDeg = (20 + sub * 720) % 180;
  } else {
    angleDeg = kf(t_loop, [
      [0.00,  20],
      [0.20,  25],
      [0.42, 110],
      [0.50,  90],
      [0.60,  45],
      [0.63,  20],
      [0.78,  20],
      [1.00,  20],
    ]);
  }

  const thresholdVal = kf(t_loop, [
    [0.00, 0.50],
    [0.20, 0.35],  // tighter stripes during vibration
    [0.50, 0.60],  // fatter bands during beats
    [0.65, 0.30],  // thin stripes during strobe
    [0.80, 0.50],
    [1.00, 0.50],
  ]);

  // Phase scrolling — each grid has an independent phase that drifts over time.
  // 4 full turns per cycle for grid1, 3 for grid2 → they desync and resync → beats.
  const phase1 = (t_loop * Math.PI * 2 * 4) % (Math.PI * 2);
  const phase2 = (t_loop * Math.PI * 2 * 3) % (Math.PI * 2);

  params.freq1      = freq1Val;
  params.freq2      = freq2Val;
  params.angle      = angleDeg;
  params.threshold  = thresholdVal;

  if(gui){
    gui.rows.get('freq1')?._write(Math.round(freq1Val * 10) / 10);
    gui.rows.get('freq2')?._write(Math.round(freq2Val * 10) / 10);
    gui.rows.get('angle')?._write(Math.round(angleDeg * 10) / 10);
    gui.rows.get('threshold')?._write(Math.round(thresholdVal * 100) / 100);
  }

  paint(angleDeg, phase1, phase2);
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
      name: 'wordart-interference',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X → angle (0°–180°)
        params.angle     = Math.round(ax * 180 * 10) / 10;
        // Y → threshold (0–1); top = thin stripes, bottom = fat bands
        params.threshold = Math.round((1 - ay) * 100) / 100;
        gui?.rows.get('angle')?._write(params.angle);
        gui?.rows.get('threshold')?._write(params.threshold);
        schedule('paint');
      },
      onWheel(dy){
        // Scroll → freq2
        params.freq2 = Math.max(1, Math.min(40, params.freq2 + dy * 0.05));
        gui?.rows.get('freq2')?._write(Math.round(params.freq2 * 10) / 10);
        if(!params.animate) schedule('paint');
      },
      onClick(ax, ay){
        // Randomise both frequencies on click
        params.freq1 = Math.round((2 + Math.random() * 18) * 2) / 2;
        params.freq2 = Math.round((2 + Math.random() * 18) * 2) / 2;
        gui?.rows.get('freq1')?._write(params.freq1);
        gui?.rows.get('freq2')?._write(params.freq2);
        if(!params.animate) schedule('paint');
      },
    });
  }
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
