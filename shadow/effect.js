// Shadow effect — text drawn N times with incremental (dx, dy) offsets along
// a configurable angle, creating a long-shadow / 3D-extrusion look. Copies are
// drawn farthest-first so near layers overlap far ones. The final text is
// painted on top at full white.
//
// Color modes:
//   solid   — all shadow copies use shadowColor at a fixed alpha.
//   fade    — shadowColor fades from transparent (far) to opaque (near).
//   rainbow — hue sweeps across depth + rotates with angle; adds spectral depth.
//
// Animation: angle sweeps 0 → 360° monotonically across one cycle (0° == 360°,
// so the loop closes seamlessly). One full revolution per 15 s.
//
// Interactive: cursor X → angle (0..360), cursor Y → depth (1..80).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
// One full angle sweep per loop. 0° == 360° → seamless.
const ANIM = { angleTurns: 1 };

function lerp(a, b, t){ return a + (b - a) * t; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const SHADOW_COLORS = ['#ff0066','#6600ff','#00ffcc','#ff6600','#0066ff'];

const params = {
  depth:       20 + Math.floor(Math.random() * 30),   // 20..49
  stepSize:    2,
  angle:       Math.floor(Math.random() * 360),
  shadowColor: pick(SHADOW_COLORS),
  colorMode:   'solid',   // 'solid' | 'fade' | 'rainbow'
  animate:     false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('heavy') : 'deep',
  textSize:    400,
  bold:        true,
  italic:      false,
  bg:          pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d');

let animationId        = null;
let animationStartTime = 0;
let gui;
let DPR         = 1;
let computedSize = params.textSize;  // font size after FIT scaling; set in rasterizeText

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
  for(const c of [cv, textBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold   ? 'bold'   : 'normal';
  const s = params.italic ? 'italic' : 'normal';
  return `${s} ${w} ${size}px Helvetica`;
}

function rasterizeText(){
  // Render white text onto textBuf, centred with FIT-based size clamping.
  // Also computes and stores computedSize for paint().
  const w = cssW(), h = cssH();
  tctx.save();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, textBuf.width, textBuf.height);
  tctx.restore();
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const FIT = 0.92;
  let size = params.textSize;
  tctx.font = fontSpec(size);
  const measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  computedSize = size;
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
}

// Parse a #rrggbb colour into [r,g,b] integers.
function hexToRgb(hex){
  const n = parseInt(hex.replace('#',''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Return a CSS rgba() string from a hex colour + alpha.
function hexAlpha(hex, a){
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function paint(overrideAngle){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const angleDeg = overrideAngle != null ? overrideAngle : params.angle;
  const angleRad = angleDeg * Math.PI / 180;
  const dx  = Math.cos(angleRad);
  const dy  = Math.sin(angleRad);
  const depth = Math.max(1, Math.round(params.depth));
  const step  = params.stepSize;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Background
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  // Set up shared text rendering state.
  ctx.font          = fontSpec(computedSize);
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';

  // Draw shadow copies farthest → nearest so each near layer sits on top.
  for(let d = depth; d >= 1; d--){
    // t = 1 at farthest copy, approaches 0 at nearest copy.
    const t = d / depth;

    let color, alpha;
    if(params.colorMode === 'rainbow'){
      // Hue sweeps with both depth position and current angle offset.
      const hue = ((d / depth) * 300 + angleDeg) % 360;
      color = `hsl(${hue.toFixed(1)}, 100%, 55%)`;
      // Faint far, brighter near.
      alpha = lerp(0.3, 0.85, 1 - t);
    } else if(params.colorMode === 'fade'){
      // shadowColor fades from transparent (far) to opaque (near).
      color = params.shadowColor;
      alpha = lerp(0, 0.8, 1 - t);
    } else {
      // solid — uniform alpha across all copies.
      color = params.shadowColor;
      alpha = 0.7;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.fillText(params.text, w / 2 + dx * d * step, h / 2 + dy * d * step);
    ctx.restore();
  }

  // Top text — full brightness white, no offset.
  ctx.fillStyle   = '#ffffff';
  ctx.globalAlpha = 1;
  ctx.fillText(params.text, w / 2, h / 2);

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // Angle sweeps monotonically: 0 → 360° per loop. 360° == 0° → seamless.
  const angle = (t_loop * 360 * ANIM.angleTurns) % 360;
  params.angle = angle;
  if(gui) gui.rows.get('angle')?._write(angle);
  paint(angle);
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
  params.angle = Math.round(ax * 360);
  params.depth = Math.max(1, Math.round(1 + ay * 79));
  if(gui){
    gui.rows.get('angle')?._write(params.angle);
    gui.rows.get('depth')?._write(params.depth);
  }
  schedule('paint');
}

const RASTER_KEYS = new Set(['text','textSize','bold','italic']);

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
      canvas:  cv,
      name:    'wordart-shadow',
      pngBtn:  document.getElementById('export-png'),
      mp4Btn:  document.getElementById('export-mp4'),
      rec:     document.querySelector('.wa-rec'),
    });
  }
  cv.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', () => { fitCanvas(); schedule('raster'); });
  fitCanvas();
  redraw();
}

document.addEventListener('DOMContentLoaded', init);
