// Cross-effect shared state. Common parameters — text, textSize, bold, italic,
// bg — persist across /line/, /slice/ and any future effect. Each is stored as
// localStorage under `wa.<key>`. Per-effect params (lineSize, splits, etc.)
// stay local to their effect's randomized defaults.
(function(){
  'use strict';
  const PREFIX = 'wa.';
  const SHARED_KEYS = ['text', 'textSize', 'bold', 'italic', 'bg'];

  // Line and Slice always open on "hello". Every other mode pulls a fragment
  // from one of these four banks. Pass a bank name to randomPhrase() to skew
  // a mode's mood (e.g. a glitch mode → 'heavy'); omit to draw from any bank.
  // Drawing is bag-without-replacement per session so flipping through modes
  // back to back gives different fragments.
  const PHRASE_BANKS = {
    welcome: [
      'hello',
      'hello again',
      'anybody in?',
      'i\'m listening',
      'you found me',
    ],
    dreamy: [
      'yesterday went blurry',
      'a hill of quiet fools',
      'diamonds in the static',
      'the sky forgot its lines',
      'soft light, strange weather',
    ],
    heavy: [
      'black sun rising',
      'velvet, little doom',
      'thunder in lowercase',
      'flowers with teeth',
      'the riff arrived',
    ],
    playful: [
      'your words grew antlers',
      'letters with jazz hands',
      'tiny chaos, big hat',
      'the font is flirting',
      'this sentence escaped',
    ],
  };

  const _bags = {};
  function _refill(name, source){
    const bag = source.slice();
    for(let i = bag.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    _bags[name] = bag;
  }
  function randomPhrase(bank){
    if(bank && PHRASE_BANKS[bank]){
      if(!_bags[bank] || _bags[bank].length === 0) _refill(bank, PHRASE_BANKS[bank]);
      return _bags[bank].pop();
    }
    if(!_bags._any || _bags._any.length === 0){
      const all = Object.values(PHRASE_BANKS).reduce((a,b) => a.concat(b), []);
      _refill('_any', all);
    }
    return _bags._any.pop();
  }

  function readRaw(key){
    try { return localStorage.getItem(PREFIX + key); } catch(e){ return null; }
  }
  function get(key, fallback){
    const v = readRaw(key);
    if(v == null) return fallback;
    // Coerce booleans + numbers back from string.
    if(v === 'true') return true;
    if(v === 'false') return false;
    if(/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  function set(key, value){
    if(value == null) return;
    try { localStorage.setItem(PREFIX + key, String(value)); } catch(e){}
  }
  function hydrate(params){
    // For each shared key the effect uses, replace the default with the
    // persisted value if present. Effect-specific keys are left alone.
    for(const k of SHARED_KEYS){
      if(!(k in params)) continue;
      const v = readRaw(k);
      if(v == null) continue;
      params[k] = get(k, params[k]);
    }
  }
  function isShared(key){ return SHARED_KEYS.includes(key); }

  window.WAState = {
    get, set, hydrate, isShared,
    SHARED_KEYS, PHRASE_BANKS, randomPhrase,
    // Back-compat with the previous text-only API.
    getText: (fallback) => get('text', fallback),
    setText: (v) => set('text', v),
  };
})();
