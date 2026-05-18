'use strict';

// Ripple — GPU-accelerated radial distortion via two-pass strip drawImage.
// No getImageData / putImageData — zero JS pixel loops. Both passes use a
// 1-CSS-px strip loop (~1080 + ~1920 drawImage calls vs 2M JS ops before):
//
//   Pass 1 (Y-warp → tmpBuf): each horizontal strip is displaced vertically
//   by amplitude × sin(2π × |y−cy| / lambda + phase) × sign(y−cy).
//
//   Pass 2 (X-warp → cv): each vertical strip from tmpBuf is displaced
//   horizontally by the same formula over |x−cx|.
//
// The two passes together approximate a true outward radial ripple: text
// bulges away from the canvas centre in both axes simultaneously. The GPU
// handles bilinear resampling per strip, giving sub-pixel smooth anti-aliased
// output at full Retina resolution.
//
// Animate: 30s keyframed arc with WOW moments — tight intense rings, deep
// slow ripple, rapid phase surges. Seamless loop.

const ELECTRIC_COLORS = ["#000000","#ADD8E6","#FF96FF","#ffcf37","#B5651D","#ff781e","#b6b6ed","#00FF00","#FF3333"];
const CYCLE_MS = 30000;
const ANIM = {
  amplitudePeak: 60,
  phaseTurns:    3,   // integer turns → sin(2π·n·0) = sin(2π·n·1) = 0, loop closes
};

// kf(t, stops) — keyframe interpolator. stops = [[t, value], ...]
function kf(t, stops){ for(let i=0;i<stops.length-1;i++){const[t0,v0]=stops[i],[t1,v1]=stops[i+1];if(t>=t0&&t<=t1)return v0+(v1-v0)*((t-t0)/(t1-t0));}return stops[stops.length-1][1]; }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const params = {
  amplitude:   18,
  wavelength:  80,
  phase:        0,
  damp:        false,
  animate:     false,
  interactive: false,
  text: (window.WAState && window.WAState.randomPhrase) ? window.WAState.randomPhrase('dreamy') : 'flow',
  textSize:    400,
  bold:        true,
  italic:      false,
  bg:          pick(ELECTRIC_COLORS),
};
if(window.WAState) window.WAState.hydrate(params);

const cv      = document.getElementById('cv');
const ctx     = cv.getContext('2d');
const textBuf = document.createElement('canvas');
const tctx    = textBuf.getContext('2d');
const tmpBuf  = document.createElement('canvas');  // intermediate for two-pass
const tmpCtx  = tmpBuf.getContext('2d');

let DPR = 1;
let gui;
let animationId = null, animationStartTime = 0;

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
  for(const c of [cv, textBuf, tmpBuf]){
    if(c.width  !== bw) c.width  = bw;
    if(c.height !== bh) c.height = bh;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tmpCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
  let size = params.textSize;
  tctx.font = fontSpec(size);
  const measured = tctx.measureText(params.text).width;
  if(measured > w * FIT && measured > 0){
    size = Math.max(12, Math.floor(size * (w * FIT) / measured));
    tctx.font = fontSpec(size);
  }
  tctx.textAlign    = 'center';
  tctx.textBaseline = 'middle';
  tctx.fillStyle    = '#ffffff';
  tctx.fillText(params.text, w / 2, h / 2);
}

function paint(overridePhase, overrideAmp, overrideDamp){
  window.WAGUI?.flashValues(params);
  const w = cssW(), h = cssH();
  const cx = w / 2, cy = h / 2;
  const amp      = overrideAmp   != null ? overrideAmp   : params.amplitude;
  const lambda   = Math.max(1, params.wavelength);
  const phaseRad = ((overridePhase != null ? overridePhase : params.phase)) * Math.PI / 180;
  const doDamp   = overrideDamp != null ? overrideDamp : params.damp;
  const maxR     = Math.sqrt(cx * cx + cy * cy) || 1;
  const bw       = textBuf.width;
  const bh       = textBuf.height;

  // --- Pass 1: Y-warp into tmpBuf ---
  // For each horizontal strip at CSS y, compute vertical displacement from
  // the canvas centre and sample the corresponding row from textBuf.
  // The browser bilinearly resamples the fractional source row.
  tmpCtx.clearRect(0, 0, w, h);  // clear in CSS space (DPR transform is active)

  for(let y = 0; y < h; y++){
    const dy = y - cy;
    const r  = Math.abs(dy);
    let srcY;
    if(r < 0.5){
      srcY = y;
    } else {
      const damp = doDamp ? Math.max(0, 1 - r / maxR) : 1;
      const disp = amp * Math.sin(2 * Math.PI * r / lambda + phaseRad) * damp;
      const ny   = dy / r;  // ±1 (sign of y offset from centre)
      srcY = Math.max(0, Math.min(h - 1, y - disp * ny));
    }
    // Copy 1 CSS-px-tall strip from textBuf at srcY into tmpBuf at y.
    // Source coords are in backing pixels; dest coords are in CSS space.
    tmpCtx.drawImage(textBuf, 0, srcY * DPR, bw, DPR, 0, y, w, 1);
  }

  // --- Pass 2: X-warp + bg composite into cv ---
  // Fill with background first, then layer the X-warped tmpBuf strips on top.
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, w, h);

  for(let x = 0; x < w; x++){
    const dx = x - cx;
    const r  = Math.abs(dx);
    let srcX;
    if(r < 0.5){
      srcX = x;
    } else {
      const damp = doDamp ? Math.max(0, 1 - r / maxR) : 1;
      const disp = amp * Math.sin(2 * Math.PI * r / lambda + phaseRad) * damp;
      const nx   = dx / r;  // ±1 (sign of x offset from centre)
      srcX = Math.max(0, Math.min(w - 1, x - disp * nx));
    }
    // Copy 1 CSS-px-wide vertical strip from tmpBuf at srcX into cv at x.
    ctx.drawImage(tmpBuf, srcX * DPR, 0, DPR, bh, x, 0, 1, h);
  }

  ctx.restore();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function redraw(){ rasterizeText(); paint(); }

function renderAnimationFrame(t_loop){
  // WOW animation — 30s keyframed arc:
  // t=0.00: amplitude=0, flat crisp text
  // t=0.10: gentle ripple appears
  // t=0.20: WOW #1 — amplitude=60, wavelength=20 → tight intense rings, text unrecognizable
  // t=0.30: wavelength grows → few massive slow waves
  // t=0.40: WOW #2 — amplitude=60, wavelength=80 → deep slow ripple like large pond disturbance
  // t=0.50: amplitude drops, text resolves
  // t=0.60: damp toggles on → center stays crisp, edges ripple
  // t=0.70: WOW #3 — rapid phase surges + amplitude surges → rings travel both in and out
  // t=0.85: damp stays on, amplitude normalizes
  // t=1.00: amplitude=0, seamless

  const amp = kf(t_loop, [
    [0.00,  0],
    [0.10, 20],
    [0.20, 60],  // WOW #1: tight intense rings
    [0.30, 55],  // massive slow wave
    [0.40, 60],  // WOW #2: deep slow ripple
    [0.50,  5],  // resolves
    [0.60, 25],  // damp on: center crisp, edges ripple
    [0.70, 60],  // WOW #3: rings travel both directions
    [0.85, 20],
    [1.00,  0],
  ]);

  const wavelength = kf(t_loop, [
    [0.00,  80],
    [0.10,  50],
    [0.20,  20],   // WOW #1: tight rings
    [0.30, 160],   // massive slow waves
    [0.40,  80],   // WOW #2: deep pond ripple
    [0.50,  60],
    [0.60,  50],
    [0.70,  30],   // WOW #3: tight during surges
    [0.85,  60],
    [1.00,  80],
  ]);

  // WOW #3: phase surges rapidly to simulate rings appearing to travel inward and outward
  let phase;
  if(t_loop >= 0.68 && t_loop < 0.82){
    // 4 rapid phase oscillations in this window (back and forth)
    const sub = (t_loop - 0.68) / 0.14;
    phase = (t_loop * 360 * 3 + Math.sin(sub * 4 * 2 * Math.PI) * 90) % 360;
  } else {
    phase = (t_loop * 360 * 3) % 360;
  }

  // damp toggles on from t=0.58 onwards until t=0.90
  const damp = t_loop >= 0.58 && t_loop < 0.90;

  params.phase      = phase;
  params.amplitude  = amp;
  params.wavelength = Math.round(wavelength);
  params.damp       = damp;

  if(gui){
    gui.rows.get('phase')?._write(Math.round(phase));
    gui.rows.get('amplitude')?._write(Math.round(amp));
    gui.rows.get('wavelength')?._write(Math.round(wavelength));
    gui.rows.get('damp')?.setVal(damp);
  }
  paint(phase, amp, damp);
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
  params.amplitude  = Math.round(ax * 60);
  params.wavelength = Math.max(10, Math.round(10 + ay * 190));
  if(gui){
    gui.rows.get('amplitude')?._write(params.amplitude);
    gui.rows.get('wavelength')?._write(params.wavelength);
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
      canvas:  cv,
      name:    'wordart-ripple',
      pngBtn:  document.getElementById('export-png'),
      mp4Btn:  document.getElementById('export-mp4'),
      rec:     document.querySelector('.wa-rec'),
    });
  }
  if(window.WAInteract){
    window.WAInteract.wire(cv, {
      onMove(ax, ay){
        if(!params.interactive || params.animate) return;
        params.amplitude  = Math.round(ax * 60);
        params.wavelength = Math.max(10, Math.round(10 + ay * 190));
        if(gui){
          gui.rows.get('amplitude')?._write(params.amplitude);
          gui.rows.get('wavelength')?._write(params.wavelength);
        }
        schedule('paint');
      },
      onWheel(dy){
        params.wavelength = Math.max(10, Math.min(200, params.wavelength + dy * 0.1));
        gui?.rows.get('wavelength')?._write(Math.round(params.wavelength));
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
