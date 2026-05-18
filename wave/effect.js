// Wave effect — each character is placed at a vertically displaced position
// following a sine wave. Characters ride the wave at different phases based on
// their position in the string. The wave travels (phase scrolls) during
// animation, making letters float up and down in sequence like a ripple.
//
// No textBuf pixel data needed — we measure character widths once in
// rasterizeText() to build charLayouts, then draw each character individually
// to the canvas in paint() at its wave-displaced y coordinate.
//
// Animate: 30s keyframed arc with WOW moments — high-freq chaos, slow single
// wave, phase reversal tear, typographic madness. Seamless loop.
// Interactive: cursor X → frequency, cursor Y → amplitude.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
const ANIM = {
  amplitudePeak: 140, // peak amplitude (CSS px) reached at t=0.5
  phaseTurns: 4,      // full phase sweeps per cycle (integer → seamless)
};

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

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

function fontSpec(size, boldOverride, italicOverride){
  const b = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  const w = b  ? 'bold'   : 'normal';
  const s = it ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// rasterizeText() does not draw pixels — it measures character widths using
// the canvas 2D context and builds charLayouts for paint() to use.
function rasterizeText(boldOverride, italicOverride){
  const w = cssW();
  const FIT = 0.92;
  let size = params.textSize;

  ctx.save();
  ctx.font = fontSpec(size, boldOverride, italicOverride);

  // Measure total width at requested size.
  let total = 0;
  for(const ch of params.text) total += ctx.measureText(ch).width;

  // Scale down if the string is wider than the canvas.
  if(total > w * FIT && total > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / total));
    ctx.font = fontSpec(size, boldOverride, italicOverride);
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

function paint(overridePhase, overrideAmplitude, boldOverride, italicOverride){
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
  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  ctx.font          = fontSpec(computedSize, b, it);
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
  // WOW animation — 30s keyframed arc:
  // t=0.00: amplitude=0 (flat, crisp text)
  // t=0.10: gentle sine wave emerges
  // t=0.20: WOW #1 — amplitude=200 + frequency=20 → text shattered into high-freq noise
  // t=0.30: frequency drops to 1 → single massive slow wave, text barely readable
  // t=0.40: WOW #2 — phase reversal mid-cycle + max amplitude → text inverts up/down
  // t=0.50: amplitude drops, text resolves
  // t=0.60: second build-up with bold text animating on/off
  // t=0.70: WOW #3 — italic + bold + max wave → typographic madness
  // t=0.85: all parameters normalize
  // t=1.00: amplitude=0, seamless

  const amp = kf(t_loop, [
    [0.00,   0],
    [0.10,  50],
    [0.20, 200],  // WOW #1: shattered high-freq
    [0.30, 180],  // single slow wave
    [0.40, 200],  // WOW #2: phase reversal peak
    [0.50,  10],  // resolves
    [0.60,  80],  // second build
    [0.70, 200],  // WOW #3: typographic madness
    [0.85,  20],
    [1.00,   0],
  ]);

  const freq = kf(t_loop, [
    [0.00,  3],
    [0.10,  4],
    [0.20, 20],  // WOW #1: high freq chaos
    [0.30,  1],  // drops to single massive wave
    [0.40,  2],
    [0.50,  3],
    [0.60,  5],
    [0.70, 18],  // WOW #3: high freq madness
    [0.85,  4],
    [1.00,  3],
  ]);

  // Phase: monotonic + phase reversal at WOW #2 (t=0.38-0.42)
  let phase;
  if(t_loop >= 0.38 && t_loop < 0.42){
    // rapid 180° flip to create tear/invert illusion
    const sub = (t_loop - 0.38) / 0.04;
    phase = (t_loop * 360 * 4 + sub * 180) % 360;
  } else {
    phase = (t_loop * 360 * 4) % 360;
  }

  // Bold and italic animate during WOW #3
  const boldOn   = t_loop >= 0.62 && t_loop < 0.85 ? (Math.floor(t_loop * 8) % 2 === 0) : params.bold;
  const italicOn = t_loop >= 0.68 && t_loop < 0.85;

  params.amplitude = amp;
  params.frequency = freq;
  params.phase     = phase;

  if(gui){
    gui.rows.get('phase')?._write(Math.round(phase));
    gui.rows.get('amplitude')?._write(Math.round(amp));
    gui.rows.get('frequency')?._write(Math.round(freq));
  }

  // Re-measure if bold/italic changed this frame
  rasterizeText(boldOn, italicOn);
  paint(phase, amp, boldOn, italicOn);
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
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.frequency = Math.max(1, 1 + ax * 19);
        params.amplitude = Math.round((1 - ay) * 200);
        if(gui){
          gui.rows.get('frequency')?._write(params.frequency);
          gui.rows.get('amplitude')?._write(params.amplitude);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.amplitude = Math.max(0, Math.min(200, params.amplitude + dy * 0.1));
        gui?.rows.get('amplitude')?._write(Math.round(params.amplitude));
        if(!params.animate) schedule('paint');
      },
      onClick(ax, ay){
        params.phase = Math.round(Math.random() * 360);
        gui?.rows.get('phase')?._write(params.phase);
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
