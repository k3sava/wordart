// Wave effect — each character is placed at a vertically displaced position
// following a sine wave. Characters ride the wave at different phases based on
// their position in the string. The wave travels (phase scrolls) during
// animation, making letters float up and down in sequence like a ripple.
//
// No textBuf pixel data needed — we measure character widths once in
// rasterizeText() to build charLayouts, then draw each character individually
// to the canvas in paint() at its wave-displaced y coordinate.
//
// Animate: phase scrolls monotonically (4 full rotations across one cycle —
// integer turns so the loop is seamless). Amplitude follows a sin(π·t)
// envelope — zero at t=0 and t=1 (seamless), peak at t=0.5. This creates a
// gentle "rise and fall of the sea" feel.
// Interactive: cursor X → frequency, cursor Y → amplitude.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  amplitudePeak: 140, // peak amplitude (CSS px) reached at t=0.5
  phaseTurns: 4,      // full phase sweeps per cycle (integer → seamless)
};

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  amplitude: 40 + Math.floor(Math.random() * 40),
  frequency: 2  + Math.floor(Math.random() * 4),
  phase: 0,
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'wave',
  textSize: 400,
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
// Each entry: { char: string, x: number }  (x in CSS px from start of string)
let charLayouts = [];
let totalTextWidth = 0;
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

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// rasterizeText() does not draw pixels — it measures character widths using
// the canvas 2D context and builds charLayouts for paint() to use.
function rasterizeText(){
  const w = cssW();
  const FIT = 0.92;
  let size = params.textSize;

  ctx.save();
  ctx.font = fontSpec(size);

  // Measure total width at requested size.
  let total = 0;
  for(const ch of params.text) total += ctx.measureText(ch).width;

  // Scale down if the string is wider than the canvas.
  if(total > w * FIT && total > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / total));
    ctx.font = fontSpec(size);
  }

  // Record per-character x offset (cumulative) and width.
  charLayouts = [];
  let cumX = 0;
  for(const ch of params.text){
    const cw = ctx.measureText(ch).width;
    charLayouts.push({ char: ch, x: cumX });
    cumX += cw;
  }
  totalTextWidth = cumX;
  computedSize   = size;

  ctx.restore();
  // Restore DPR transform — ctx.save/restore preserves it, but set explicitly
  // in case of any edge case with setTransform state.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function paint(overridePhase, overrideAmplitude){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  const phaseRad = ((overridePhase != null ? overridePhase : params.phase) * Math.PI / 180);
  const amp      = overrideAmplitude != null ? overrideAmplitude : params.amplitude;
  const freq     = Math.max(0.1, params.frequency);
  const n        = charLayouts.length;

  // Determine foreground and background colors.
  // invert = swap: canvas becomes white, text takes the bg color.
  const fgColor  = params.invert ? params.bg  : '#ffffff';
  const bgColor  = params.invert ? '#ffffff'  : params.bg;

  // Fill background in CSS coordinate space (DPR transform active).
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  // Draw each character at its wave-displaced position.
  ctx.font          = fontSpec(computedSize);
  ctx.textAlign     = 'left';
  ctx.textBaseline  = 'middle';
  ctx.fillStyle     = fgColor;

  const startX = w / 2 - totalTextWidth / 2;

  for(let i = 0; i < n; i++){
    const c = charLayouts[i];
    // Normalised position across the string (0 at first char, 1 at last).
    // Single-character strings get position 0.5 so the wave still applies.
    const t   = n > 1 ? i / (n - 1) : 0.5;
    const yOff = amp * Math.sin(2 * Math.PI * freq * t + phaseRad);
    ctx.fillText(c.char, startX + c.x, h / 2 + yOff);
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // Phase: monotonic scroll at phaseTurns rotations per cycle.
  // phaseTurns is an integer → phase at t=1 is 360 × phaseTurns ≡ 0 (mod 360).
  // Seamless: sin is periodic at 360°.
  const phase = (t_loop * 360 * ANIM.phaseTurns) % 360;

  // Amplitude envelope: sin(π·t) — 0 at t=0 and t=1 (both endpoints zero,
  // seamless), peak of 1 at t=0.5. Gives a single swell each loop.
  const amp = ANIM.amplitudePeak * Math.sin(t_loop * Math.PI);

  params.phase     = phase;
  params.amplitude = amp;
  if(gui){
    gui.rows.get('phase')?._write(phase);
    gui.rows.get('amplitude')?._write(amp);
  }
  paint(phase, amp);
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
  // X axis → frequency (1..20)
  params.frequency = Math.max(1, 1 + ax * 19);
  // Y axis → amplitude (0..200) — top of screen = max amplitude
  params.amplitude = Math.round((1 - ay) * 200);
  if(gui){
    gui.rows.get('frequency')?._write(params.frequency);
    gui.rows.get('amplitude')?._write(params.amplitude);
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
      name: 'wordart-wave',
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
