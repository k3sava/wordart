// Collapse effect — each character falls from its reading position to the floor
// under simulated gravity, bounces slightly on landing, sits as a pile, then
// rises back up letter-by-letter to reform the word.
//
// Animation arc (30s loop):
//   t=0.00–0.05  — word intact, all letters at home. Hold.
//   t=0.05–0.50  — WOW #1: letters fall left-to-right (staggered), each bounces.
//   t=0.50–0.55  — pile at floor, word illegible.
//   t=0.55–0.90  — WOW #2: letters rise right-to-left (reverse stagger), word reforms.
//   t=0.90–0.95  — word intact again. Hold.
//   t=0.95–1.00  — WOW #3: all letters drop simultaneously (earthquake), snap back up.
//
// Interactive: X → stagger, Y → gravity, scroll → bounce, click → earthquake.
//
// Credit: inspired by gravity type and typographic collapse.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  gravity:     5.0,
  stagger:     0.6,
  bounce:      0.6,
  animate:     false,
  interactive: false,
  text: 'a lot of',
  textSize:    300,
  bold:        Math.random() < 0.5,
  italic:      false,
  bg:          pick(ELECTRIC_COLORS),
  invert:      false,
};
if(window.WAState) window.WAState.hydrate(params);

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d');

let animationId        = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Per-character layout — rebuilt on rasterizeText().
let charLayouts    = [];   // [{ char, x, width }]
let totalTextWidth = 0;
let computedSize   = params.textSize;

// Click-triggered earthquake state (independent of animate loop).
let quakeStart = -1;      // performance.now() when quake began, -1 = idle
const QUAKE_MS = 700;     // duration of a single earthquake drop+snap

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

function cssW(){ return cv.clientWidth  || window.innerWidth;  }
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

// rasterizeText — measures character widths, builds charLayouts.
// Does NOT draw pixels.
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

  charLayouts    = [];
  let cumX = 0;
  for(const ch of params.text){
    const cw = ctx.measureText(ch).width;
    charLayouts.push({ char: ch, x: cumX, width: cw });
    cumX += cw;
  }
  totalTextWidth = cumX;
  computedSize   = size;

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---------------------------------------------------------------------------
// Drop calculation
// ---------------------------------------------------------------------------

// easeInQuad — accelerating fall (gravity feel)
function easeIn(t){ return t * t; }
// easeOutQuad — decelerating rise
function easeOut(t){ return 1 - (1 - t) * (1 - t); }

/**
 * getDropFrac(i, t_loop, n, gravityScale, stagger, bounceStrength)
 *
 * Returns a 0..1 fraction of how far character i has fallen toward the floor.
 * 0 = home position, 1 = floor.  Values can be slightly above 1 due to bounce.
 *
 * Phases per character (adjusted by stagger):
 *   fall:  fallStart..fallEnd
 *   sit:   fallEnd..riseStart  (with damped bounce oscillation)
 *   rise:  riseStart..riseEnd
 */
function getDropFrac(i, t_loop, n, gravityScale, staggerAmt, bounceStrength){
  const idx = n > 1 ? i / (n - 1) : 0.5;

  // Fall timing: characters fall left-to-right
  const staggerSpread = staggerAmt * 0.30;
  const fallDur       = Math.max(0.04, 0.15 / gravityScale);
  const fallStart     = 0.05 + idx * staggerSpread;
  const fallEnd       = fallStart + fallDur;

  // Rise timing: characters rise right-to-left (inverted stagger index)
  const riseIdx       = n > 1 ? (n - 1 - i) / (n - 1) : 0.5;
  const riseSpread    = staggerAmt * 0.25;
  const riseDur       = Math.max(0.04, 0.12 / gravityScale);
  const riseStart     = 0.58 + riseIdx * riseSpread;
  const riseEnd       = riseStart + riseDur;

  if(t_loop < fallStart) return 0;

  if(t_loop < fallEnd){
    // Accelerating fall
    const p = (t_loop - fallStart) / (fallEnd - fallStart);
    return easeIn(p);
  }

  if(t_loop < riseStart){
    // On the floor — damped bounce oscillation
    const settleT = (t_loop - fallEnd) / Math.max(0.001, riseStart - fallEnd);
    const decay   = Math.exp(-bounceStrength * 12 * settleT);
    const osc     = decay * Math.sin(settleT * 28) * 0.15;
    return 1.0 + osc;
  }

  if(t_loop < riseEnd){
    // Decelerating rise
    const p = (t_loop - riseStart) / (riseEnd - riseStart);
    return 1 - easeOut(p);
  }

  return 0;  // fully home
}

/**
 * getEarthquakeFrac(i, t_loop, n)
 *
 * For t=0.95–1.00: ALL characters drop simultaneously (no stagger),
 * then snap back.  Returns 0..1 drop fraction.
 */
function getEarthquakeFrac(t_loop){
  if(t_loop < 0.95) return 0;
  const p = (t_loop - 0.95) / 0.05;  // 0..1 over the 0.05 window
  // Fall fast (first 35%), hold (35–65%), snap back (65–100%)
  if(p < 0.35) return easeIn(p / 0.35);
  if(p < 0.65) return 1.0 + Math.sin((p - 0.35) / 0.30 * Math.PI) * 0.06;
  return 1 - easeOut((p - 0.65) / 0.35);
}

// ---------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------
function paint(dropFracs, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

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
  ctx.fillStyle    = fgColor;

  const n      = charLayouts.length;
  const startX = w / 2 - totalTextWidth / 2;
  const homeY  = h / 2;
  const floorY = h - 60;

  // fracs: either computed array (animation) or null (static)
  const fracs = dropFracs || new Array(n).fill(0);

  for(let i = 0; i < n; i++){
    const c    = charLayouts[i];
    const frac = fracs[i] || 0;
    const dropDist = floorY - homeY;
    const yOff     = frac * dropDist;
    ctx.fillText(c.char, startX + c.x, homeY + yOff);
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(null); }

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------
function renderAnimationFrame(t_loop){
  const n  = charLayouts.length;
  const gv = Math.max(0.1, params.gravity / 5);  // normalised gravity multiplier

  const fracs = new Array(n);

  if(t_loop >= 0.95){
    // WOW #3 — earthquake: all chars, no stagger
    const ef = getEarthquakeFrac(t_loop);
    for(let i = 0; i < n; i++) fracs[i] = ef;
  } else {
    for(let i = 0; i < n; i++){
      fracs[i] = getDropFrac(i, t_loop, n, gv, params.stagger, params.bounce);
    }
  }

  // Update GUI sliders live while animating
  if(gui){
    gui.rows.get('gravity')?._write(+params.gravity.toFixed(1));
  }

  rasterizeText();
  paint(fracs);
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  renderAnimationFrame((elapsed % CYCLE_MS) / CYCLE_MS);
  dirty.raster = dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}

// Earthquake mode (click-triggered, independent of main animation loop)
function quakeLoop(){
  const elapsed = performance.now() - quakeStart;
  if(elapsed >= QUAKE_MS){
    quakeStart = -1;
    if(!params.animate) redraw();
    return;
  }
  const p  = elapsed / QUAKE_MS;
  const n  = charLayouts.length;
  // Simple arc: drop 0→1 in first half, snap back in second half
  let frac;
  if(p < 0.4)       frac = easeIn(p / 0.4);
  else if(p < 0.6)  frac = 1.0;
  else               frac = 1 - easeOut((p - 0.6) / 0.4);
  const fracs = new Array(n).fill(frac);
  rasterizeText();
  paint(fracs);
  requestAnimationFrame(quakeLoop);
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

// ---------------------------------------------------------------------------
// WAEffect API
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GUI + interactivity init
// ---------------------------------------------------------------------------
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
      name: 'wordart-collapse',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X → stagger (0..1)
        params.stagger = Math.round(ax * 100) / 100;
        // Y → gravity (1..20) — top = light, bottom = heavy
        params.gravity = Math.round((1 + ay * 19) * 10) / 10;
        if(gui){
          gui.rows.get('stagger')?._write(params.stagger);
          gui.rows.get('gravity')?._write(params.gravity);
        }
        schedule('paint');
      },
      onWheel(dy){
        if(!params.interactive) return;
        params.bounce = Math.max(0, Math.min(1, Math.round((params.bounce + dy * 0.002) * 100) / 100));
        gui?.rows.get('bounce')?._write(params.bounce);
        if(!params.animate) schedule('paint');
      },
      onClick(){
        if(!params.interactive) return;
        // Trigger synchronized earthquake drop
        if(quakeStart < 0 && !params.animate){
          quakeStart = performance.now();
          requestAnimationFrame(quakeLoop);
        }
      },
    });
  }

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
