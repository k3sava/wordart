// Global keyboard shortcuts + splash overlay for wordart.
// Effects 1-8 map to line/slice/blur/dither/type/halftone/glitch/mesh.
(function(){
  'use strict';
  const EFFECTS = ['line','slice','blur','dither','type','halftone','glitch','mesh'];
  const SEEN   = 'wa.splash.seen';

  function clickRow(key){
    const row = document.querySelector(`.wg-row[data-key="${key}"]`);
    row?.querySelector('input[type=checkbox]')?.click();
  }
  function go(slug){
    const parts = location.pathname.split('/').filter(Boolean);
    const wa = parts.indexOf('wordart');
    const base = wa >= 0 ? '/' + parts.slice(0, wa + 1).join('/') + '/' : '../';
    location.href = base + slug + '/';
  }

  const CMDS = {
    'a': () => clickRow('animate'),
    'i': () => clickRow('interactive'),
    ' ': () => clickRow('animate'),
    'p': () => document.getElementById('export-png')?.click(),
    'm': () => document.getElementById('export-mp4')?.click(),
    'c': () => document.querySelector('.wg-collapse')?.click(),
    'r': () => document.querySelector('.wg-text .wg-shuffle')?.click(),
    '?': () => showSplash(),
    '/': () => showSplash(),
    'escape': () => hideSplash(),
  };

  function typingTarget(t){
    if(!t) return false;
    if(typeof t.matches === 'function' && t.matches('input, textarea')) return true;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
  }

  document.addEventListener('keydown', (e) => {
    if(typingTarget(e.target)) return;
    if(e.key >= '1' && e.key <= '8'){
      const slug = EFFECTS[parseInt(e.key, 10) - 1];
      if(slug && location.pathname.indexOf(`/${slug}/`) < 0){
        go(slug); e.preventDefault();
      }
      return;
    }
    // T is owned by theme.js (avoid double-fire).
    if(e.key === 't' || e.key === 'T') return;
    const k = e.key.toLowerCase();
    const fn = CMDS[k];
    if(fn){ e.preventDefault(); fn(e); }
  });

  function buildSplash(){
    if(document.getElementById('wa-splash')) return;
    const el = document.createElement('div');
    el.id = 'wa-splash';
    el.className = 'wa-splash';
    el.innerHTML = `
      <div class="wa-splash-inner">
        <div class="wa-splash-title">wordart</div>
        <div class="wa-splash-tag">type a phrase, switch effects, export</div>
        <div class="wa-splash-grid">
          <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd><kbd>6</kbd><kbd>7</kbd><kbd>8</kbd></span><span>switch effect</span>
          <span><kbd>T</kbd></span><span>cycle theme</span>
          <span><kbd>A</kbd> / <kbd>Space</kbd></span><span>animate</span>
          <span><kbd>I</kbd></span><span>interactive (cursor drives params)</span>
          <span><kbd>R</kbd></span><span>shuffle phrase</span>
          <span><kbd>P</kbd></span><span>export PNG</span>
          <span><kbd>M</kbd></span><span>export 15 s MP4</span>
          <span><kbd>C</kbd></span><span>collapse / expand panel</span>
          <span><kbd>?</kbd></span><span>show this again</span>
        </div>
        <div class="wa-splash-tap">tap anywhere or press any key to begin</div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', hideSplash);
    el.addEventListener('keydown', hideSplash);
  }
  function showSplash(){ buildSplash(); document.getElementById('wa-splash')?.classList.add('visible'); }
  function hideSplash(){
    const el = document.getElementById('wa-splash');
    if(el && el.classList.contains('visible')){
      el.classList.remove('visible');
      try { localStorage.setItem(SEEN, '1'); } catch(_){}
    }
  }

  function init(){
    buildSplash();
    const helpBtn = document.getElementById('help-btn');
    if(helpBtn) helpBtn.addEventListener('click', showSplash);
    if(!localStorage.getItem(SEEN)) showSplash();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WAKeys = { show: showSplash, hide: hideSplash };
})();
