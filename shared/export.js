// Shared export helpers — PNG and 15 s perfectly-loopable MP4 of the canvas.
// The MP4 forces the active effect into Animate mode, resets the cycle so
// recording begins at the rest state (t=0), captures exactly one cycle, then
// restores the prior animate state. Frame 0 and the final frame produce the
// same canvas content for a seamless loop.
(function(){
  'use strict';
  const RECORD_SECONDS = 15;
  const FPS = 30;

  function pickMime(){
    const tries = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for(const m of tries){
      if(typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function exportPNG(canvas, name){
    const a = document.createElement('a');
    a.download = `${name}-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  async function exportVideo(canvas, name, {onProgress, onDone, onError} = {}){
    const mime = pickMime();
    if(!mime){ onError && onError('MediaRecorder not supported'); return null; }
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const stream = canvas.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if(e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, `${name}-${Date.now()}.${ext}`);
      onDone && onDone(blob);
    };
    rec.onerror = (ev) => { onError && onError(ev.error || ev); };

    // Reset the active effect's animation cycle so recording begins at t=0
    // (the rest state). One RAF lets the first frame paint before capture.
    if(window.WAEffect && window.WAEffect.beginRecording){
      window.WAEffect.beginRecording();
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    rec.start(250);
    const t0 = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      const pct = Math.min(1, elapsed / RECORD_SECONDS);
      onProgress && onProgress(pct);
      if(elapsed >= RECORD_SECONDS){
        rec.stop();
        if(window.WAEffect && window.WAEffect.endRecording){
          window.WAEffect.endRecording();
        }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return rec;
  }

  function wire({canvas, name, pngBtn, mp4Btn, rec}){
    if(pngBtn){
      pngBtn.addEventListener('click', () => exportPNG(canvas, name));
    }
    if(mp4Btn){
      mp4Btn.addEventListener('click', async () => {
        if(mp4Btn.dataset.recording) return;
        mp4Btn.dataset.recording = '1';
        mp4Btn.disabled = true;
        const recEl = rec || document.querySelector('.wa-rec');
        const bar = recEl?.querySelector('.bar');
        recEl?.classList.add('visible');
        await exportVideo(canvas, name, {
          onProgress:(p) => { if(bar) bar.style.width = (p*100).toFixed(1) + '%'; },
          onDone: () => { recEl?.classList.remove('visible'); if(bar) bar.style.width = '0%'; mp4Btn.disabled = false; delete mp4Btn.dataset.recording; },
          onError:(e) => { console.error('record error', e); recEl?.classList.remove('visible'); mp4Btn.disabled = false; delete mp4Btn.dataset.recording; alert('Recording failed: ' + e); },
        });
      });
    }
  }

  window.WAExport = { wire, exportPNG, exportVideo, RECORD_SECONDS, FPS };
})();
