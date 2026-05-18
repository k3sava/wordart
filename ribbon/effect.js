// Ribbon effect — text is printed on a flat 3D ribbon that twists and waves
// through space like fabric. Characters are placed along the ribbon surface
// and each is vertically squished by sin(twistAngle) to create the illusion
// of a ribbon rotating in 3D. Characters on the back face are faded. The
// ribbon undulates during animation like a silk banner caught in the wind.
//
// No textBuf pixel data needed — we measure character widths in rasterizeText()
// to build charLayouts, then draw each character individually with a per-
// character ctx.scale(1, scaleY) transform to simulate ribbon perspective.
//
// Animate: 30s keyframed arc — gentle wave → rapid phase scroll → 720° twist
// tornado → near-flat → accordion waves → height chaos → full 3D chaos → resolve.
// Interactive: cursor X → phase, cursor Y → twist, scroll → waves.
//
// Credit: inspired by ribbon typography experiments by Toshi Omagari
// and various CSS 3D ribbon tutorials.
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  twist:  360,           // total twist degrees across the full text length
  waves:  2,             // number of wave cycles in the ribbon
  phase:  0,             // phase offset (degrees)
  height: 60,            // ribbon height modulation amplitude (px)
  animate: false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('playful') : 'ribbon',
  textSize: 380,
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
// Accumulated phase offset for seamless phase scroll during animation.
// We keep a running total that never resets, so scroll is continuous.
let _animPhaseAccum = 0;
let _animLastT = 0;
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
  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  const w  = b  ? 'bold'   : 'normal';
  const s  = it ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

// rasterizeText() measures character widths and builds charLayouts for paint().
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

  // Record per-character x offset (cumulative).
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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// paint() draws each character with ribbon twist/wave transforms.
// overridePhase: global phase in degrees (drives phase scroll)
// overrideGlobalPhase: separate continuously-accumulating phase for wave Y (radians)
function paint(overridePhase, overrideGlobalPhase, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const cx = w / 2, cy = h / 2;

  const phaseRad     = (overridePhase != null ? overridePhase : params.phase) * Math.PI / 180;
  const globalPhase  = overrideGlobalPhase != null ? overrideGlobalPhase : 0;
  const twist        = params.twist;
  const waveCycles   = Math.max(0, params.waves);
  const ht           = params.height;

  const fgColor = params.invert ? params.bg  : '#ffffff';
  const bgColor = params.invert ? '#ffffff'  : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const b  = boldOverride   != null ? boldOverride   : params.bold;
  const it = italicOverride != null ? italicOverride : params.italic;
  ctx.font         = fontSpec(computedSize, b, it);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';

  const n = charLayouts.length;

  for(let i = 0; i < n; i++){
    const c = charLayouts[i];

    // Normalised position across the text (0 = first char, 1 = last).
    // For a single character, use centre position 0.5.
    const t = n > 1 ? c.x / Math.max(totalTextWidth, 1) : 0.5;

    // --- Ribbon twist ---
    // twistRad drives the vertical squish (sin) and height undulation (cos).
    const twistRad = (twist * Math.PI / 180) * t + phaseRad;
    const scaleY   = Math.sin(twistRad);

    // Skip characters that are nearly edge-on (avoids slivers and division issues).
    if(Math.abs(scaleY) < 0.02) continue;

    // Alpha: front face = full opacity, back face = hidden.
    const alpha = Math.max(0, scaleY);
    if(alpha < 0.01) continue;

    // Height undulation: ribbon rises/falls like a wave along its length.
    // (t - 0.5) centres the wave so the ribbon pivots around screen centre.
    const yOffset = ht * Math.cos(twistRad) * (t - 0.5);

    // --- Wave Y undulation (separate sine that animates globally) ---
    const WAVE_AMP = 60;
    const waveY = waveCycles > 0
      ? WAVE_AMP * Math.sin(2 * Math.PI * waveCycles * t + globalPhase)
      : 0;

    // Screen position.
    const screenX = cx + (c.x - totalTextWidth / 2);
    const screenY = cy + yOffset + waveY;

    // Draw character with vertical squish to simulate ribbon twist.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screenX, screenY);
    ctx.scale(1, scaleY);
    ctx.fillStyle = fgColor;
    ctx.fillText(c.char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // 30s WOW animation arc:
  // t=0.00: slow ribbon wave, gentle twist (180°)
  // t=0.15: WOW #1 — rapid phase scroll: ribbon flies toward viewer, letters flip rapidly
  // t=0.28: full 720° twist — typographic tornado
  // t=0.38: slow down, twist drops to 90° — text almost flat
  // t=0.50: WOW #2 — waves increase to 6 cycles: tight accordion
  // t=0.62: waves drop, height modulation goes extreme (±120px)
  // t=0.75: WOW #3 — max twist + max waves + extreme height: full 3D chaos
  // t=0.88: everything resolves to gentle ribbon
  // t=1.00: seamless to t=0.00

  const twist = kf(t_loop, [
    [0.00, 180],
    [0.15, 240],  // build into WOW #1
    [0.28, 720],  // WOW #1 peak: typographic tornado
    [0.38,  90],  // nearly flat
    [0.50, 270],  // rebuild for WOW #2
    [0.62, 360],  // moderate twist with height chaos
    [0.75, 720],  // WOW #3: max twist
    [0.88, 180],  // resolve
    [1.00, 180],  // seamless
  ]);

  const waves = kf(t_loop, [
    [0.00, 2],
    [0.15, 3],
    [0.28, 2],
    [0.38, 1],
    [0.50, 6],   // WOW #2: tight accordion
    [0.62, 1],   // drops
    [0.75, 5],   // WOW #3: chaos
    [0.88, 2],   // resolve
    [1.00, 2],
  ]);

  const ht = kf(t_loop, [
    [0.00,  60],
    [0.15,  60],
    [0.28,  80],
    [0.38,  40],
    [0.50,  60],
    [0.62, 120],  // height chaos
    [0.75, 120],  // WOW #3 full chaos
    [0.88,  60],  // resolve
    [1.00,  60],
  ]);

  // Phase: monotonically accumulating phase scroll (seamless).
  // WOW #1 (t=0.15-0.28): accelerate phase scroll — ribbon flies toward viewer.
  // Otherwise gentle scroll.
  // We track an accumulated value across frames to avoid jumps.
  // dt from last frame:
  const dt = t_loop >= _animLastT
    ? t_loop - _animLastT
    : (1 - _animLastT) + t_loop; // loop wraparound
  _animLastT = t_loop;

  // Speed multiplier: fast scroll during WOW #1.
  let speedMult = 1;
  if(t_loop >= 0.13 && t_loop < 0.30){
    // ramp up to 8x, then ramp back down
    const sub = (t_loop - 0.13) / 0.17;
    speedMult = 1 + 7 * Math.sin(Math.PI * sub);
  }
  _animPhaseAccum += dt * 360 * 2 * speedMult; // 2 full phase turns per cycle normally

  const phase = _animPhaseAccum % 360;

  // Global wave phase: monotonic scroll for wave Y undulation.
  // 3 full cycles in 30s gives a steady silk-banner float.
  const globalPhase = t_loop * 2 * Math.PI * 3;

  params.twist  = twist;
  params.waves  = waves;
  params.height = ht;
  params.phase  = phase;

  if(gui){
    gui.rows.get('twist')?._write(Math.round(twist));
    gui.rows.get('waves')?._write(Math.round(waves * 10) / 10);
    gui.rows.get('height')?._write(Math.round(ht));
    gui.rows.get('phase')?._write(Math.round(phase));
  }

  rasterizeText();
  paint(phase, globalPhase);
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
    _animPhaseAccum = params.phase;
    _animLastT = 0;
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
      _animPhaseAccum = params.phase;
      _animLastT = 0;
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
      name: 'wordart-ribbon',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X → phase (0°–360°)
        params.phase = Math.round(ax * 360);
        // Y → twist (0°–720°) — top of screen = max twist
        params.twist = Math.round((1 - ay) * 720);
        if(gui){
          gui.rows.get('phase')?._write(params.phase);
          gui.rows.get('twist')?._write(params.twist);
        }
        schedule('paint');
      },
      onWheel(dy){
        // Scroll wheel → waves (0–10)
        params.waves = Math.max(0, Math.min(10, params.waves + dy * 0.05));
        gui?.rows.get('waves')?._write(Math.round(params.waves * 10) / 10);
        if(!params.animate) schedule('paint');
      },
      onClick(ax, ay){
        params.phase = Math.round(Math.random() * 360);
        gui?.rows.get('phase')?._write(params.phase);
        if(!params.animate) schedule('paint');
      },
    });
  } else {
    // Fallback mouse listener when WAInteract is not available.
    cv.addEventListener('mousemove', (e) => {
      if(!params.interactive || params.animate) return;
      const r  = cv.getBoundingClientRect();
      const ax = Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width));
      const ay = Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height));
      params.phase = Math.round(ax * 360);
      params.twist = Math.round((1 - ay) * 720);
      if(gui){
        gui.rows.get('phase')?._write(params.phase);
        gui.rows.get('twist')?._write(params.twist);
      }
      schedule('paint');
    });
  }
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
