// Coil effect — text letters are wound into an Archimedean spiral.
// Each character is placed along the arc of the spiral and rotated to align
// with the tangent of the curve. The spiral animates: it rotates, expands,
// and contracts through a 30-second WOW arc.
//
// Archimedean spiral: r(θ) = startR + b*θ  where b = spacing_px / (2π)
// Arc length from 0 to θ: ∫₀^θ √(r² + b²) dθ  — computed numerically.
//
// Credit: inspired by Spiral Text Generator (textcraft.net)
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  turns:    3,
  radius:   120,
  spacing:  1.2,
  rotation: 0,
  animate:  false,
  interactive: false,
  text: 'this is',
  textSize: 48,
  bold: false,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
  invert: false,
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

let animationId  = null;
let animationStartTime = 0;
let gui;
let DPR = 1;

// Per-character layout — { char, cumX } where cumX is cumulative pixel offset.
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

// Measure characters — no pixel drawing. Builds charLayouts for paint().
function rasterizeText(boldOverride, italicOverride){
  ctx.save();
  ctx.font = fontSpec(params.textSize, boldOverride, italicOverride);

  // Measure a single pass of the text to get per-char widths.
  let base = '';
  const cw = [];
  for(const ch of params.text){
    const w = ctx.measureText(ch).width;
    cw.push({ char: ch, w });
    base += ch;
  }

  // Estimate total spiral arc length needed to fill `turns` rotations.
  // We'll use the actual text + repetitions so the spiral is always full.
  // First compute one-pass width to decide how many reps we need.
  let onePassW = cw.reduce((s, c) => s + c.w, 0);
  if(onePassW < 1) onePassW = 1;

  // Compute spiral arc length for `turns` turns.
  // b = spacing_px / (2π),  spiral: r(θ) = startR + b*θ
  // Arc ≈ ∫₀^Θ √(r² + b²) dθ, Θ = turns * 2π
  const size       = params.textSize;
  const spacingPx  = size * params.spacing;
  const b          = spacingPx / (2 * Math.PI);
  const startR     = Math.max(size * 0.5, params.radius - spacingPx * params.turns * 0.5);
  const Theta      = params.turns * 2 * Math.PI;
  const STEPS      = 500;
  const dTheta     = Theta / STEPS;
  let arcLen = 0;
  for(let i = 0; i < STEPS; i++){
    const theta = i * dTheta;
    const r = startR + b * theta;
    arcLen += Math.sqrt(r * r + b * b) * dTheta;
  }

  // How many repetitions of text do we need?
  const reps = Math.max(1, Math.ceil(arcLen / onePassW) + 1);

  // Build full expanded text string.
  charLayouts = [];
  let cumX = 0;
  for(let rep = 0; rep < reps; rep++){
    for(const c of cw){
      charLayouts.push({ char: c.char, cumX });
      cumX += c.w;
    }
  }
  totalTextWidth = cumX;
  computedSize   = size;

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// Place a character on the spiral at the given cumX offset.
// Returns { placed: bool } — stops placing once the spiral ends.
function paint(overrideRotation, overrideTurns, overrideSpacing, boldOverride, italicOverride){
  window.WAGUI?.flashValues(params);

  const w  = cssW(), h = cssH();
  const cx = w / 2, cy = h / 2;

  const rotDeg  = overrideRotation != null ? overrideRotation : params.rotation;
  const turns   = overrideTurns   != null ? overrideTurns   : params.turns;
  const spacMul = overrideSpacing  != null ? overrideSpacing  : params.spacing;

  const rotRad    = rotDeg * Math.PI / 180;
  const size      = computedSize;
  const spacingPx = size * spacMul;
  const b         = spacingPx / (2 * Math.PI);
  // Center the spiral: startR chosen so the middle turn is at params.radius.
  const startR    = Math.max(size * 0.5, params.radius - spacingPx * turns * 0.5);
  const Theta     = turns * 2 * Math.PI;

  const fgColor = params.invert ? params.bg       : '#ffffff';
  const bgColor = params.invert ? '#ffffff'       : params.bg;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const b2  = boldOverride   != null ? boldOverride   : params.bold;
  const it2 = italicOverride != null ? italicOverride : params.italic;
  ctx.font         = fontSpec(size, b2, it2);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = fgColor;

  // Walk the spiral numerically, placing characters at their cumX offsets.
  // Step θ in small increments, accumulate arc length, draw chars as we pass
  // their cumulative offset.
  const STEPS  = Math.ceil(Theta * 200);  // ~200 samples per radian
  const dTheta = Theta / STEPS;

  let arcAcc    = 0;   // accumulated arc length
  let charIdx   = 0;   // index into charLayouts
  let prevTheta = 0;
  let prevR     = startR;

  // Place chars that fall before arc position 0 (safety)
  while(charIdx < charLayouts.length && charLayouts[charIdx].cumX <= 0) charIdx++;

  for(let step = 1; step <= STEPS && charIdx < charLayouts.length; step++){
    const theta = step * dTheta;
    const r     = startR + b * theta;
    // Arc element: √((r·dθ)² + (b·dθ)²) = dθ·√(r²+b²)
    const dArc  = Math.sqrt(r * r + b * b) * dTheta;
    arcAcc += dArc;

    // Place all characters whose cumX falls within [arcAcc - dArc, arcAcc)
    while(charIdx < charLayouts.length && charLayouts[charIdx].cumX <= arcAcc){
      // Interpolate exact angle for this character.
      const frac = dArc > 0 ? (charLayouts[charIdx].cumX - (arcAcc - dArc)) / dArc : 0;
      const charTheta = prevTheta + frac * dTheta;
      const charR     = startR + b * charTheta;

      const px = cx + charR * Math.cos(charTheta + rotRad);
      const py = cy + charR * Math.sin(charTheta + rotRad);

      // Tangent angle of Archimedean spiral at θ:
      // tangent = atan2(r·sinθ + b·cosθ, r·cosθ - b·sinθ) but we simplify:
      // The tangent direction ≈ θ + π/2 + atan(b/r) (outward sweep).
      // For readability, use charTheta + π/2 so letters face outward along arc.
      const tangent = charTheta + rotRad + Math.PI / 2;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(tangent);
      ctx.fillText(charLayouts[charIdx].char, 0, 0);
      ctx.restore();

      charIdx++;
    }

    prevTheta = theta;
    prevR     = r;
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // 30-second WOW animation arc:
  // t=0.00  compact 3-turn spiral, slow rotation
  // t=0.15  spiral expands outward (radius grows)
  // t=0.30  WOW #1 — rapid spin: spiral whirls at high speed
  // t=0.40  slows, spiral fully expanded to 6 turns
  // t=0.50  WOW #2 — simultaneous rapid rotation + tighten (dense coil)
  // t=0.65  coil explodes out again, rotation reverses
  // t=0.75  resolves back to 3 turns, slow reverse rotation
  // t=0.88  WOW #3 — accordion: tight ↔ loose rapid oscillation
  // t=1.00  seamless back to t=0.00

  const turns = kf(t_loop, [
    [0.00,  3],
    [0.15,  3.5],
    [0.30,  5],
    [0.40,  6],   // WOW #1 aftermath: fully expanded
    [0.50,  1.5], // WOW #2: tight dense coil
    [0.65,  6],   // explode outward
    [0.75,  3],
    [0.85,  3],
    // WOW #3 accordion: oscillate in last 15%
    [0.88,  8],
    [0.91,  1],
    [0.94,  7],
    [0.97,  1.5],
    [1.00,  3],
  ]);

  const radius = kf(t_loop, [
    [0.00, 120],
    [0.15, 160],  // expands outward
    [0.30, 200],  // WOW #1 build
    [0.40, 200],
    [0.50,  80],  // WOW #2: tight
    [0.65, 200],  // explode
    [0.75, 120],
    [0.88, 140],
    [1.00, 120],
  ]);

  const spacing = kf(t_loop, [
    [0.00, 1.2],
    [0.50, 0.8],  // WOW #2: tighter spacing
    [0.65, 1.4],
    [0.75, 1.2],
    [1.00, 1.2],
  ]);

  // Rotation: slow drift normally, fast spin during WOW moments.
  // WOW #1 (t=0.28-0.42): rapid forward spin
  // WOW #2 (t=0.48-0.58): rapid backward spin
  // WOW #3 (t=0.85-1.00): forward spin
  let rotation;
  const baseSlowFwd = t_loop * 60;       // +60° over full cycle (slow drift)
  if(t_loop >= 0.28 && t_loop < 0.42){
    // WOW #1: rapid spin overlay — adds up to +720° during this window
    const sub = (t_loop - 0.28) / 0.14;
    rotation = baseSlowFwd + sub * 720;
  } else if(t_loop >= 0.48 && t_loop < 0.60){
    // WOW #2: tight + reverse spin
    const sub = (t_loop - 0.48) / 0.12;
    rotation = baseSlowFwd - sub * 540;
  } else if(t_loop >= 0.85 && t_loop < 1.00){
    // WOW #3: fast spin during accordion
    const sub = (t_loop - 0.85) / 0.15;
    rotation = baseSlowFwd + sub * 360;
  } else {
    rotation = baseSlowFwd;
  }
  rotation = ((rotation % 360) + 360) % 360;

  // Update params for GUI reflection
  params.turns    = turns;
  params.radius   = radius;
  params.spacing  = spacing;
  params.rotation = Math.round(rotation);

  if(gui){
    gui.rows.get('turns')?._write(Math.round(turns * 10) / 10);
    gui.rows.get('radius')?._write(Math.round(radius));
    gui.rows.get('spacing')?._write(Math.round(spacing * 100) / 100);
    gui.rows.get('rotation')?._write(Math.round(rotation));
  }

  rasterizeText();
  paint(rotation, turns, spacing);
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

// Interactive scroll: adjust spacing (zoom)
let interactSpacing = params.spacing;

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic', 'turns', 'radius', 'spacing']);

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
      name: 'wordart-coil',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        // X → rotation (0..360°)
        params.rotation = Math.round(ax * 360);
        // Y → turns (0.5..8), top = max turns
        params.turns = 0.5 + (1 - ay) * 7.5;
        if(gui){
          gui.rows.get('rotation')?._write(params.rotation);
          gui.rows.get('turns')?._write(Math.round(params.turns * 10) / 10);
        }
        schedule('raster');
      },
      onWheel(dy){
        interactSpacing = Math.max(0.5, Math.min(3, interactSpacing + dy * 0.005));
        params.spacing = Math.round(interactSpacing * 100) / 100;
        gui?.rows.get('spacing')?._write(params.spacing);
        if(!params.animate) schedule('raster');
      },
      onClick(ax, ay){
        params.rotation = Math.round(Math.random() * 360);
        gui?.rows.get('rotation')?._write(params.rotation);
        if(!params.animate) schedule('paint');
      },
    });
  }

  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
