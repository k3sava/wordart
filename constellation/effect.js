// Constellation effect — text rasterised into an offscreen buffer once per text
// change. Stars are seeded from text pixel positions (getImageData called ONCE
// in buildStars). Each frame: spring physics moves stars toward home + mouse
// attraction, then edges are drawn between nearby stars, then stars are drawn
// as twinkling points. Signal pulses travel along edges. 30-second animation
// cycle with three WOW moments: constellation formation, maximum density, vortex.
'use strict';

const CYCLE_MS = 30000;
const MAX_SIGNALS = 8;

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t){ return a + (b - a) * t; }
function kf(t, stops){
  for(let i = 0; i < stops.length - 1; i++){
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if(t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}
function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

const params = {
  starCount: 1000,
  threshold: 55,
  twinkle: true,
  gravity: 80,
  animate: false,
  interactive: false,
  text: (window.WAState?.randomPhrase?.('cosmic')) ?? 'stars',
  textSize: 380,
  bold: false,
  italic: false,
  bg: '#000011',
};
if(window.WAState) window.WAState.hydrate(params);

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d', { willReadFrequently: true });

let gui;
let DPR = 1;

// Star array — each: { homeX, homeY, x, y, vx, vy, twinklePhase, twinkleFreq, brightness }
let stars = [];
let textPixels = null;
let needsRebuild = true;

// Signals — travel along edges
// Each edge cached as [starA_idx, starB_idx] after buildEdges
let edgeCache = [];
let signals = [];

// Mouse state (CSS px)
let mouseX = -9999, mouseY = -9999;

// Animation
let currentT = 0;
let animationId = null;
let animationStartTime = 0;
let lastFrameTime = 0;

// Dirty/schedule pattern
const dirty = { raster: false, paint: false };
let rafQueued = false;
function schedule(level){
  if(level === 'raster') dirty.raster = true;
  dirty.paint = true;
  if(rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    if(dirty.raster){ rasterizeText(); needsRebuild = true; }
    paint(currentT, 0);
    dirty.raster = dirty.paint = false;
  });
}

function cssW(){ return cv.clientWidth  || window.innerWidth; }
function cssH(){ return cv.clientHeight || window.innerHeight; }

function fitCanvas(){
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = cssW(), h = cssH();
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  for(const c of [cv, textBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  textPixels = null;
  needsRebuild = true;
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
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
  const MIN_FILL = 0.20; // wrap multi-word text when single-line < 20% of canvas height
  let size = params.textSize;
  const words = params.text.trim().split(/\s+/);

  // Attempt single-line scaling (scale down to fit width, then height)
  tctx.font = fontSpec(size);
  const singleW = tctx.measureText(params.text).width;
  let singleSize = size;
  if(singleW > w * FIT && singleW > 0){
    singleSize = Math.max(12, Math.floor(size * (w * FIT) / singleW));
    tctx.font = fontSpec(singleSize);
  }
  const sm = tctx.measureText(params.text);
  const singleH = (sm.actualBoundingBoxAscent||0) + (sm.actualBoundingBoxDescent||0) || singleSize * 1.1;
  if(singleH > h * FIT){
    singleSize = Math.max(12, Math.floor(singleSize * (h * FIT) / singleH));
  }

  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';

  // Wrap into 2 lines when single-line text would be smaller than MIN_FILL of canvas height
  if(words.length > 1 && singleSize < h * MIN_FILL){
    tctx.font = fontSpec(size);
    let bestSplit = Math.ceil(words.length / 2);
    let bestDiff = Infinity;
    for(let i = 1; i < words.length; i++){
      const d = Math.abs(
        tctx.measureText(words.slice(0, i).join(' ')).width -
        tctx.measureText(words.slice(i).join(' ')).width
      );
      if(d < bestDiff){ bestDiff = d; bestSplit = i; }
    }
    const line1 = words.slice(0, bestSplit).join(' ');
    const line2 = words.slice(bestSplit).join(' ');

    const maxLineW = Math.max(
      tctx.measureText(line1).width,
      tctx.measureText(line2).width
    );
    let lineSize = size;
    if(maxLineW > w * FIT && maxLineW > 0){
      lineSize = Math.max(12, Math.floor(size * (w * FIT) / maxLineW));
    }
    tctx.font = fontSpec(lineSize);
    const lm = tctx.measureText(line1);
    let lineH = (lm.actualBoundingBoxAscent||0) + (lm.actualBoundingBoxDescent||0) || lineSize * 1.1;
    // Constrain total 2-line height (2 lines + 30% leading gap)
    if(lineH * 2.3 > h * FIT){
      lineSize = Math.max(12, Math.floor(lineSize * (h * FIT) / (lineH * 2.3)));
      tctx.font = fontSpec(lineSize);
      const lm2 = tctx.measureText(line1);
      lineH = (lm2.actualBoundingBoxAscent||0) + (lm2.actualBoundingBoxDescent||0) || lineSize * 1.1;
    }
    const gap = lineH * 0.3;
    tctx.fillText(line1, w / 2, h / 2 - lineH / 2 - gap / 2);
    tctx.fillText(line2, w / 2, h / 2 + lineH / 2 + gap / 2);
  } else {
    tctx.font = fontSpec(singleSize);
    tctx.fillText(params.text, w / 2, h / 2);
  }

  textPixels  = null;
  needsRebuild = true;
}

function buildStars(){
  needsRebuild = false;
  const bw = textBuf.width, bh = textBuf.height;

  // getImageData called ONCE here
  tctx.save();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  const imageData = tctx.getImageData(0, 0, bw, bh);
  tctx.restore();
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  textPixels = imageData.data;

  const textPts = [];
  // Step every 2 backing pixels (enough fidelity, much faster collection)
  for(let y = 0; y < bh; y += 2){
    for(let x = 0; x < bw; x += 2){
      const idx = (y * bw + x) * 4;
      if(textPixels[idx + 3] > 128){
        textPts.push({ x: x / DPR, y: y / DPR });
      }
    }
  }

  if(textPts.length === 0){ stars = []; edgeCache = []; signals = []; return; }

  const count = Math.round(params.starCount);
  // Keep previous positions for smooth rebuilds
  const oldStars = stars;
  stars = [];
  for(let i = 0; i < count; i++){
    const src = textPts[Math.floor(Math.random() * textPts.length)];
    const old = oldStars[i];
    stars.push({
      homeX:        src.x,
      homeY:        src.y,
      x:            old ? old.x : src.x,
      y:            old ? old.y : src.y,
      vx:           old ? old.vx : 0,
      vy:           old ? old.vy : 0,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleFreq:  0.5 + Math.random() * 2.5,
      brightness:   0.6 + Math.random() * 0.4,
    });
  }

  // Seed fresh signals on edges (computed lazily in buildEdgeCache)
  edgeCache = null; // mark stale — rebuilt first time draw needs it
  signals = [];
}

// Build edge list for current threshold (CSS px). Called when threshold changes.
function buildEdgeCache(threshold){
  if(stars.length === 0){ edgeCache = []; return; }
  const th2 = threshold * threshold;
  edgeCache = [];
  for(let i = 0; i < stars.length; i++){
    for(let j = i + 1; j < stars.length; j++){
      const dx = stars[i].homeX - stars[j].homeX;
      const dy = stars[i].homeY - stars[j].homeY;
      if(dx * dx + dy * dy <= th2){
        edgeCache.push(i, j); // flat interleaved pairs, more cache-friendly
      }
    }
  }
  // Seed signals if none
  if(edgeCache.length >= 2 && signals.length === 0) seedSignals();
}

function seedSignals(){
  const edgeCount = edgeCache.length / 2;
  if(edgeCount === 0) return;
  signals = [];
  for(let i = 0; i < MAX_SIGNALS; i++){
    signals.push({
      edgeIdx:  Math.floor(Math.random() * edgeCount),
      progress: Math.random(),
      speed:    0.15 + Math.random() * 0.35,
    });
  }
}

// Physics update — spring each star toward home (+animation override) + mouse gravity
function updateStars(dt, animThreshold, vortexT){
  const w = cssW(), h = cssH();
  const cx = w / 2, cy = h / 2; // canvas center for vortex
  const gravR  = params.interactive ? params.gravity : 0;
  const gravR2 = gravR * gravR;

  for(const s of stars){
    // Animated home: vortex rotates around canvas center
    let tx = s.homeX, ty = s.homeY;
    if(vortexT > 0){
      const dx = s.homeX - cx, dy = s.homeY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Full 360° orbit: vortexT goes 0→2π, so stars return to base positions
      // at loop end. Single-direction, no reversal.
      const angle = Math.atan2(dy, dx) + vortexT;
      tx = cx + dist * Math.cos(angle);
      ty = cy + dist * Math.sin(angle);
    }

    // Mouse gravitational attraction
    if(gravR > 0){
      const mdx = mouseX - s.x, mdy = mouseY - s.y;
      const md2 = mdx * mdx + mdy * mdy;
      if(md2 < gravR2 && md2 > 0){
        const md   = Math.sqrt(md2);
        const pull = (1 - md / gravR) * 0.4; // attraction factor
        tx += mdx * pull;
        ty += mdy * pull;
      }
    }

    // Spring toward (tx, ty)
    const springK = 0.12;
    const damp    = 0.82;
    s.vx = (s.vx + (tx - s.x) * springK) * damp;
    s.vy = (s.vy + (ty - s.y) * springK) * damp;
    s.x += s.vx;
    s.y += s.vy;

    // Twinkle phase advance
    if(params.twinkle) s.twinklePhase += s.twinkleFreq * dt * 0.004;
  }
}

// Update signal pulses
function updateSignals(dt){
  const edgeCount = edgeCache ? edgeCache.length / 2 : 0;
  if(edgeCount === 0){ signals = []; return; }
  for(const sig of signals){
    sig.progress += sig.speed * dt * 0.001;
    if(sig.progress >= 1){
      sig.progress = 0;
      sig.edgeIdx  = Math.floor(Math.random() * edgeCount);
      sig.speed    = 0.15 + Math.random() * 0.35;
    }
  }
}

let lastEdgeThreshold = -1;

function paint(t_loop, dt){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();

  if(needsRebuild) buildStars();

  // ── Animation keyframes ─────────────────────────────────────────────────────
  const t = t_loop;

  // Live threshold driven by keyframe during animation, otherwise params value
  const animThreshold = params.animate
    ? kf(t, [
        [0.00, 0],
        [0.08, 0],
        [0.20, params.threshold],
        [0.30, params.threshold],
        [0.40, 120],
        [0.50, 120],
        [0.55, 0],
        [0.65, 0],
        [0.75, params.threshold],
        [0.85, params.threshold],
        [1.00, 0],
      ])
    : params.threshold;

  // Vortex orbit angle (radians): eases in from 0 to 2π for a full 360° orbit.
  // Using a single monotone ramp avoids the direction-reversal that occurred when
  // vortexStrength and vortexT were multiplied together with mismatched keyframes.
  const vortexT = params.animate
    ? kf(t, [
        [0.00, 0],
        [0.55, 0],
        [0.75, 2 * Math.PI],  // full 360° orbit — returns to base position
        [1.00, 2 * Math.PI],
      ])
    : 0;

  // Star count multiplier: t=0.30–0.50 ramp up to 2x, then back down
  const countMult = params.animate
    ? kf(t, [
        [0.00, 1],
        [0.30, 1],
        [0.40, 2],
        [0.50, 2],
        [0.55, 1],
        [1.00, 1],
      ])
    : 1;

  // Effective star count for this frame (only trim, not grow, to avoid rebuild loops)
  const targetCount = Math.round(params.starCount * countMult);
  if(params.animate && targetCount > stars.length && stars.length > 0){
    // Sprinkle extra stars distributed over existing home positions
    const extra = targetCount - stars.length;
    for(let i = 0; i < extra; i++){
      const src = stars[i % stars.length];
      stars.push({
        homeX: src.homeX + (Math.random() - 0.5) * 4,
        homeY: src.homeY + (Math.random() - 0.5) * 4,
        x: src.x, y: src.y, vx: 0, vy: 0,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleFreq:  0.5 + Math.random() * 2.5,
        brightness:   0.6 + Math.random() * 0.4,
      });
    }
    lastEdgeThreshold = -1; // force edge rebuild
  }
  const drawCount = Math.min(targetCount, stars.length);

  // Rebuild edge cache when threshold changes meaningfully
  if(edgeCache === null || Math.abs(animThreshold - lastEdgeThreshold) > 0.5){
    buildEdgeCache(animThreshold);
    lastEdgeThreshold = animThreshold;
  }

  // Physics
  updateStars(dt, animThreshold, vortexT);
  updateSignals(dt);

  // ── Draw ────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Background
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  const edgePairs = edgeCache;
  const edgeCount = edgePairs ? edgePairs.length / 2 : 0;

  // ── Constellation edges ─────────────────────────────────────────────────────
  if(edgeCount > 0 && animThreshold > 0.5){
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    for(let e = 0; e < edgePairs.length; e += 2){
      const ai = edgePairs[e], bi = edgePairs[e + 1];
      if(ai >= drawCount || bi >= drawCount) continue;
      const sa = stars[ai], sb = stars[bi];
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Signal pulses ───────────────────────────────────────────────────────────
  if(edgeCount > 0 && animThreshold > 0.5){
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    for(const sig of signals){
      const eBase = sig.edgeIdx * 2;
      if(eBase + 1 >= edgePairs.length) continue;
      const ai = edgePairs[eBase], bi = edgePairs[eBase + 1];
      if(ai >= drawCount || bi >= drawCount) continue;
      const sa = stars[ai], sb = stars[bi];
      const px = lerp(sa.x, sb.x, sig.progress);
      const py = lerp(sa.y, sb.y, sig.progress);
      ctx.moveTo(px + 3, py);
      ctx.arc(px, py, 3, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  // ── Stars ───────────────────────────────────────────────────────────────────
  ctx.beginPath();
  for(let i = 0; i < drawCount; i++){
    const s = stars[i];
    let b = s.brightness;
    if(params.twinkle) b = clamp(b + 0.35 * Math.sin(s.twinklePhase), 0.1, 1);
    const r = 0.8 + b * 1.2; // radius 0.8–2.0
    // Vary alpha by brightness so dimmer stars are more transparent
    ctx.globalAlpha = clamp(b, 0.15, 1);
    ctx.moveTo(s.x + r, s.y);
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle   = '#ffffff';
  ctx.fill();

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function renderAnimationFrame(t_loop){
  const now = performance.now();
  const dt  = lastFrameTime > 0 ? Math.min(now - lastFrameTime, 100) : 16;
  lastFrameTime = now;
  currentT = t_loop;
  paint(t_loop, dt);
}

function animationLoop(){
  if(!params.animate) return;
  const elapsed = performance.now() - animationStartTime;
  const t_loop  = (elapsed % CYCLE_MS) / CYCLE_MS;
  renderAnimationFrame(t_loop);
  dirty.raster = dirty.paint = false;
  animationId = requestAnimationFrame(animationLoop);
}

function toggleAnimation(){
  if(params.animate){
    lastFrameTime = 0;
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
      lastFrameTime = 0;
      animationStartTime = performance.now();
      animationLoop();
    } else if(!params.animate){
      rasterizeText();
      buildStars();
      paint(0, 0);
    }
  },
};

const RASTER_KEYS = new Set(['text', 'textSize', 'bold', 'italic']);
const REBUILD_KEYS = new Set(['starCount']);

function init(){
  gui = new WAGui(document.getElementById('panel'), params);
  gui.on((key) => {
    if(key === 'animate'){ toggleAnimation(); return; }
    if(window.WAState?.isShared(key)) window.WAState.set(key, params[key]);
    if(RASTER_KEYS.has(key)){ dirty.raster = true; needsRebuild = true; }
    if(REBUILD_KEYS.has(key)){ needsRebuild = true; lastEdgeThreshold = -1; }
    if(key === 'threshold'){ lastEdgeThreshold = -1; }
    if(params.animate) return;
    if(RASTER_KEYS.has(key)) schedule('raster');
    else schedule('paint');
  });

  if(window.WAExport){
    window.WAExport.wire({
      canvas: cv,
      name: 'wordart-constellation',
      pngBtn: document.getElementById('export-png'),
      mp4Btn: document.getElementById('export-mp4'),
      rec: document.querySelector('.wa-rec'),
    });
  }

  WAInteract.wire(cv, {
    onMove(ax, ay, px, py){
      if(!params.interactive) return;
      mouseX = px; mouseY = py;
      if(!params.animate) schedule('paint');
    },
    onWheel(dy){
      params.threshold = clamp(params.threshold - dy * 0.02, 0, 120);
      gui?.rows.get('threshold')?._write(Math.round(params.threshold));
      lastEdgeThreshold = -1;
      if(!params.animate) schedule('paint');
    },
    onClick(ax, ay, px, py){
      // Burst of signals from nearest stars to click point
      if(!stars.length) return;
      const near = stars
        .map((s, i) => ({ i, d2: (s.x - px) ** 2 + (s.y - py) ** 2 }))
        .sort((a, b) => a.d2 - b.d2)
        .slice(0, 5);
      const edgeCount = edgeCache ? edgeCache.length / 2 : 0;
      if(edgeCount === 0) return;
      for(const n of near){
        // Find an edge that includes this star
        for(let e = 0; e < edgeCache.length; e += 2){
          if(edgeCache[e] === n.i || edgeCache[e + 1] === n.i){
            signals.push({
              edgeIdx:  e / 2,
              progress: 0,
              speed:    0.4 + Math.random() * 0.4,
            });
            if(signals.length > MAX_SIGNALS + near.length) signals.shift();
            break;
          }
        }
      }
      if(!params.animate) schedule('paint');
    },
    onPinch(ratio){
      params.threshold = clamp(params.threshold * ratio, 0, 120);
      gui?.rows.get('threshold')?._write(Math.round(params.threshold));
      lastEdgeThreshold = -1;
      if(!params.animate) schedule('paint');
    },
  });

  window.addEventListener('resize', () => {
    fitCanvas();
    schedule('raster');
  });

  fitCanvas();
  rasterizeText();
  buildStars();
  paint(0, 0);
}

document.addEventListener('DOMContentLoaded', init);
