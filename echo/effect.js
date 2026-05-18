// Echo effect — multiple ghost copies of the text are drawn behind the primary
// layer, each increasingly offset in a direction (angle) with decreasing
// opacity and hue-shifted color. Creates a trailing afterimage / echo
// hallucination.
//
// Rendering order: echoes farthest-to-nearest, then primary text on top.
// Each echo is tinted via a tintBuf (source-in fill over the text mask, same
// technique as glitch). colorShift > 0 spreads the echoes across the hue wheel.
//
// Animation: direction angle sweeps 360° continuously, one full rotation per
// CYCLE_MS. cos/sin are periodic so t=0 and t=1 are pixel-identical — seamless.
// The angle slider tracks the animated value in real time.
//
// Interactive mode: cursor X → angle (0..360), cursor Y → echoDist (4..80).
'use strict';

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 15000;
const ANIM = {
  angleTurns: 1, // one full 360° sweep per cycle
};

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t){ return a + (b - a) * t; }

const params = {
  echoCount:  3 + Math.floor(Math.random() * 4),  // 3..6
  echoDist:   15 + Math.floor(Math.random() * 20), // 15..34
  angle:      Math.floor(Math.random() * 360),
  colorShift: 30 + Math.floor(Math.random() * 60), // 30..89
  fadeMode:   Math.random() < 0.5 ? 'linear' : 'expo',
  animate:    false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'echo',
  textSize: 400,
  bold: Math.random() < 0.5,
  italic: false,
  bg: pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
// textBuf: white text on transparent (rasterised once per text change).
const textBuf = document.createElement('canvas');
const tctx = textBuf.getContext('2d');
// tintBuf: workspace for per-echo hue compositing (source-in fill over mask).
const tintBuf = document.createElement('canvas');
const xctx = tintBuf.getContext('2d');

let gui;
let DPR = 1;

let animationId = null;
let animationStartTime = 0;

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
  for(const c of [cv, textBuf, tintBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function fontSpec(size){
  const w = params.bold ? 'bold' : 'normal';
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
  let size = params.textSize;
  tctx.font = fontSpec(size);
  let measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle = '#FFFFFF';
  tctx.fillText(params.text, w / 2, h / 2);
}

// Render textBuf tinted to hsl(hue, 100%, 60%) into tintBuf.
// Uses the glitch source-in technique: draw mask → source-in fill.
function buildTinted(hue){
  xctx.save();
  xctx.setTransform(1, 0, 0, 1, 0, 0);
  xctx.clearRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.drawImage(textBuf, 0, 0);
  xctx.globalCompositeOperation = 'source-in';
  xctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
  xctx.fillRect(0, 0, tintBuf.width, tintBuf.height);
  xctx.restore();
  xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function paint(overrideAngle){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const angle = (overrideAngle != null) ? overrideAngle : params.angle;
  const angleRad = angle * Math.PI / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const count = Math.round(params.echoCount);
  const dist = params.echoDist;

  // Fill background.
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Draw echoes from farthest to nearest so closer ones are on top.
  for(let i = count; i >= 1; i--){
    const t = i / count; // 1 at farthest echo, approaching 0 at nearest

    // Alpha: fades with distance from primary.
    let alpha;
    if(params.fadeMode === 'expo'){
      alpha = Math.pow(1 - t, 2.0) * 0.75 + 0.05;
    } else {
      // linear
      alpha = (1 - t) * 0.7 + 0.05;
    }

    // Hue for this echo: base hue offset by colorShift * i
    const hue = (i * params.colorShift) % 360;
    buildTinted(hue);

    // Draw tintBuf at the offset position. We operate in backing-resolution
    // coords (setTransform 1,1) and multiply CSS offsets by DPR.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      tintBuf,
      Math.round(i * dist * dx * DPR),
      Math.round(i * dist * dy * DPR)
    );
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // Draw primary text: white, no offset, full opacity.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(textBuf, 0, 0);
  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // Angle sweeps monotonically — seamless because cos/sin are periodic.
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
  // ax → angle: 0..360
  params.angle = Math.round(ax * 360);
  // ay → echoDist: 4..80
  params.echoDist = Math.max(4, Math.round(4 + ay * 76));
  if(gui){
    gui.rows.get('angle')?._write(params.angle);
    gui.rows.get('echoDist')?._write(params.echoDist);
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
      name: 'wordart-echo',
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
