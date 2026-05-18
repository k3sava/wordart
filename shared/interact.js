// shared/interact.js — unified pointer/wheel/touch/click for wordart effects
//
// Usage in each effect:
//   WAInteract.wire(cv, {
//     onMove(ax, ay, px, py)   — ax/ay ∈ [0,1], px/py in CSS px
//     onWheel(dy, dx)          — positive dy = scroll down/zoom out (normalized px)
//     onClick(ax, ay, px, py) — tap or click, same coord convention
//     onPinch(ratio)           — two-finger pinch ratio (>1 = spread, <1 = pinch)
//   });
//
// All touch events preventDefault to stop scroll/zoom on the canvas.
// Wheel events are normalized across deltaMode variants.
// A tap is a touchend with <10px travel and <300ms duration.

'use strict';

window.WAInteract = (() => {
  function rel(canvas, clientX, clientY){
    const r = canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    return { ax: Math.max(0, Math.min(1, px / r.width)),
             ay: Math.max(0, Math.min(1, py / r.height)), px, py };
  }

  return {
    wire(canvas, { onMove, onWheel, onClick, onPinch } = {}){

      // ── Mouse ──────────────────────────────────────────────────────────────
      canvas.addEventListener('mousemove', e => {
        const c = rel(canvas, e.clientX, e.clientY);
        onMove?.(c.ax, c.ay, c.px, c.py);
      });

      canvas.addEventListener('click', e => {
        const c = rel(canvas, e.clientX, e.clientY);
        onClick?.(c.ax, c.ay, c.px, c.py);
      });

      // ── Wheel (mouse scroll + trackpad) ────────────────────────────────────
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        // deltaMode 0 = px, 1 = lines (~24px), 2 = pages
        const scale = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? 400 : 1;
        onWheel?.(e.deltaY * scale, e.deltaX * scale);
      }, { passive: false });

      // ── Touch ──────────────────────────────────────────────────────────────
      let tapStart = null;
      let lastPinchDist = 0;

      canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        if(e.touches.length === 1){
          const t = e.touches[0];
          tapStart = { x: t.clientX, y: t.clientY, time: Date.now() };
          const c = rel(canvas, t.clientX, t.clientY);
          onMove?.(c.ax, c.ay, c.px, c.py);
        }
        if(e.touches.length >= 2){
          tapStart = null;
          const dx = e.touches[1].clientX - e.touches[0].clientX;
          const dy = e.touches[1].clientY - e.touches[0].clientY;
          lastPinchDist = Math.hypot(dx, dy);
        }
      }, { passive: false });

      canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if(e.touches.length === 1){
          const t = e.touches[0];
          if(tapStart){
            const moved = Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y);
            if(moved > 10) tapStart = null;
          }
          const c = rel(canvas, t.clientX, t.clientY);
          onMove?.(c.ax, c.ay, c.px, c.py);
        }
        if(e.touches.length >= 2 && onPinch){
          const dx = e.touches[1].clientX - e.touches[0].clientX;
          const dy = e.touches[1].clientY - e.touches[0].clientY;
          const dist = Math.hypot(dx, dy);
          if(lastPinchDist > 0) onPinch(dist / lastPinchDist);
          lastPinchDist = dist;
        }
      }, { passive: false });

      canvas.addEventListener('touchend', e => {
        e.preventDefault();
        if(tapStart && e.changedTouches.length){
          const t   = e.changedTouches[0];
          const dx  = t.clientX - tapStart.x;
          const dy  = t.clientY - tapStart.y;
          const dt  = Date.now() - tapStart.time;
          if(Math.hypot(dx, dy) < 10 && dt < 300){
            const c = rel(canvas, t.clientX, t.clientY);
            onClick?.(c.ax, c.ay, c.px, c.py);
          }
        }
        tapStart = null;
        if(e.touches.length < 2) lastPinchDist = 0;
      }, { passive: false });
    }
  };
})();
