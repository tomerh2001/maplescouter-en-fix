// ==UserScript==
// @name         MapleScouter English Fix
// @namespace    https://github.com/tomerh2001/maplescouter-en-fix
// @version      1.3.1
// @description  Complete English translations for maplescouter.com (GMS-context, not literal), plus it remembers your language & server (GMS/KMS) selections.
// @author       tomerh2001
// @license      MIT
// @match        https://maplescouter.com/*
// @match        https://www.maplescouter.com/*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/msfix-data.js
// @updateURL    https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/maplescouter-en-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/maplescouter-en-fix.user.js
// @supportURL   https://github.com/tomerh2001/maplescouter-en-fix/issues
// ==/UserScript==

/*
 * How it works (3 layers):
 * 1. i18n bundle patch  — intercepts the site's webpack chunk that carries en/common.json
 *    and merges in ~3,600 missing/corrected translations, so everything rendered through
 *    i18next comes out as proper GMS English.
 * 2. DOM dictionary     — a MutationObserver + ~55k-entry official KMS→GMS name dictionary
 *    (items/mobs/maps joined by ID from game data) catches Korean text that is hardcoded
 *    in the app or returned by the Nexon API (equipment names, etc.).
 * 3. Persistence        — remembers your last language (/en, /ko, …) and your server/region
 *    selection (GMS/KMS/JMS/TMS/MSEA) across visits and windows.
 */

(function () {
  'use strict';

  var LOCALES = ['ko', 'en', 'ja', 'ch'];
  var LS_LOCALE = 'msfix:locale';
  var LS_REGION = 'msfix:region-backup';

  function data() { return (window.__MSFIX_DATA__ || { i18nPatch: {}, dict: {}, rules: [], css: '' }); }

  function pathLocale(path) {
    var m = (path || location.pathname).match(/^\/(ko|en|ja|ch)(?=\/|$|\?)/);
    return m ? m[1] : null;
  }

  /* ---------------- 1. Language persistence (must run before anything else) ------------- */

  function saveLocale() {
    var loc = pathLocale();
    if (loc) { try { localStorage.setItem(LS_LOCALE, loc); } catch (e) {} }
  }

  // The site 307-redirects every fresh visit to /ko before any client script runs,
  // so we can never observe the unprefixed URL. Instead we use the referrer to tell
  // user intent apart from the forced default:
  //   - same-origin referrer  → in-site navigation (incl. the language switcher):
  //     record the locale as the user's choice.
  //   - external/empty referrer → fresh entry: if the remembered language differs
  //     from the URL, redirect to the remembered one.
  function restoreLocale() {
    var cur = pathLocale();
    if (!cur) return false; // pre-redirect page; the server will bounce us to /ko
    var saved = null;
    try { saved = localStorage.getItem(LS_LOCALE); } catch (e) {}
    var sameOrigin = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (sameOrigin) { saveLocale(); return false; }
    if (saved && LOCALES.indexOf(saved) !== -1 && saved !== cur) {
      var rest = location.pathname.replace(/^\/(ko|en|ja|ch)(?=\/|$)/, '');
      location.replace('/' + saved + rest + location.search + location.hash);
      return true;
    }
    if (!saved) saveLocale();
    return false;
  }

  /* ---------------- 2. Region (GMS/KMS/…) persistence ----------------------------------- */
  // The site stores the selection in localStorage key "region" (zustand persist). If the
  // site ever wipes or resets it (version bumps, errors), restore it from our backup.

  var REGIONS = ['kms', 'gms', 'jms', 'tms', 'msea'];

  function readSiteRegion() {
    try {
      var raw = localStorage.getItem('region');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var r = parsed && parsed.state && parsed.state.region;
      return REGIONS.indexOf(r) !== -1 ? { region: r, raw: raw } : null;
    } catch (e) { return null; }
  }

  function backupRegion() {
    var cur = readSiteRegion();
    if (!cur) return;
    try {
      if (localStorage.getItem(LS_REGION) !== cur.raw) localStorage.setItem(LS_REGION, cur.raw);
    } catch (e) {}
  }

  function restoreRegion() {
    try {
      var backup = localStorage.getItem(LS_REGION);
      if (!backup) return;
      if (!readSiteRegion()) localStorage.setItem('region', backup);
    } catch (e) {}
  }

  /* ---------------- 3. i18n bundle patch ------------------------------------------------ */
  // en/common.json ships as a lazy webpack chunk. We wrap every module factory pushed to
  // webpackChunk_N_E; when a module's exports look like the EN translation table
  // (signature key check), we merge our patch into it before i18next consumes it.

  function isEnBundle(obj) {
    return obj && typeof obj === 'object' && obj['나이트로드'] === 'Night Lord';
  }

  function applyPatch(obj) {
    if (obj.__msfixPatched) return;
    try { Object.defineProperty(obj, '__msfixPatched', { value: true, enumerable: false }); } catch (e) { obj.__msfixPatched = true; }
    var patch = data().i18nPatch;
    for (var k in patch) obj[k] = patch[k];
  }

  function wrapFactory(factory) {
    if (typeof factory !== 'function' || factory.__msfixWrapped) return factory;
    var wrapped = function (module, exports, req) {
      var r = factory.apply(this, arguments);
      try {
        var ex = module && module.exports;
        var payload = ex && ex.default && typeof ex.default === 'object' ? ex.default : ex;
        if (isEnBundle(payload)) applyPatch(payload);
      } catch (e) {}
      return r;
    };
    wrapped.__msfixWrapped = true;
    return wrapped;
  }

  function patchChunkEntry(entry) {
    var modules = entry && entry[1];
    if (!modules) return;
    for (var id in modules) modules[id] = wrapFactory(modules[id]);
  }

  function hookWebpack() {
    var stored = window.webpackChunk_N_E;
    function arm(arr) {
      if (!arr || arr.__msfixArmed) return arr;
      try {
        Object.defineProperty(arr, '__msfixArmed', { value: true, enumerable: false });
        // webpack replaces arr.push with its own callback that installs module
        // factories BEFORE delegating to the previous push — so a plain wrapper
        // would run too late. An accessor property keeps our patcher first in
        // line no matter what webpack assigns; the reentry flag breaks the
        // parent-chain cycle (webpack's callback calls the old push itself).
        var current = arr.push;
        var reentry = false;
        var wrapped = function (entry) {
          try { patchChunkEntry(entry); } catch (e) {}
          if (reentry) return Array.prototype.push.call(arr, entry);
          reentry = true;
          try { return current.apply(arr, arguments); }
          finally { reentry = false; }
        };
        Object.defineProperty(arr, 'push', {
          configurable: true,
          get: function () { return wrapped; },
          set: function (fn) { current = fn; }
        });
        for (var i = 0; i < arr.length; i++) { try { patchChunkEntry(arr[i]); } catch (e) {} }
      } catch (e) {}
      return arr;
    }
    try {
      Object.defineProperty(window, 'webpackChunk_N_E', {
        configurable: true,
        get: function () { return stored; },
        set: function (v) { stored = arm(v); }
      });
      if (stored) arm(stored);
    } catch (e) {
      // defineProperty failed (already non-configurable?) — arm whatever exists now.
      if (window.webpackChunk_N_E) arm(window.webpackChunk_N_E);
    }
  }

  /* ---------------- 4. DOM dictionary layer --------------------------------------------- */

  var HANGUL = /[가-힣]/;

  var KO_NUM_UNITS = { '조': 1e12, '억': 1e8, '만': 1e4 };

  // "2086억 6801만 6589" → "208,668,016,589"
  function koreanNumberToEnglish(t) {
    if (!/^[\d,\s조억만]+$/.test(t) || !/[조억만]/.test(t)) return null;
    var total = 0, rest = t.replace(/,/g, '');
    var re = /(\d+)\s*([조억만])/g, m, tail = rest;
    while ((m = re.exec(rest))) { total += parseInt(m[1], 10) * KO_NUM_UNITS[m[2]]; tail = rest.slice(m.index + m[0].length); }
    var last = tail.trim().match(/^(\d+)$/);
    if (last) total += parseInt(last[1], 10);
    if (!total) return null;
    return total.toLocaleString('en-US');
  }

  var KO_DAYS = { '월': 'Mon', '화': 'Tue', '수': 'Wed', '목': 'Thu', '금': 'Fri', '토': 'Sat', '일': 'Sun' };
  var MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Single-char measure/label nodes that follow numeric inputs.
  var UNIT_LABELS = { '성': '★', '회': 'time(s)', '개': 'pc(s)', '인': 'player(s)', '결과': 'Result', '없음': 'None', '만': '×10k', '억': '×100M', '배': '×' };

  // Built-in dynamic rules — run after dict/JSON rules miss.
  function builtinRules(t, d) {
    var num = koreanNumberToEnglish(t);
    if (num != null) return num;
    var dm = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*([월화수목금토일])요일$/);
    if (dm) return KO_DAYS[dm[4]] + ', ' + MONTHS[+dm[2]] + ' ' + dm[3] + ', ' + dm[1];
    if (UNIT_LABELS[t] != null) return UNIT_LABELS[t];
    var lv = t.match(/^(\d+)\s*~\s*(\d+)제$/);
    if (lv) return 'Lv ' + lv[1] + '~' + lv[2];
    var lv1 = t.match(/^(\d+)제$/);
    if (lv1) return 'Lv ' + lv1[1];
    var arrow = t.match(/^(\d+)\s*→\s*(\d+)\s*레벨$/);
    if (arrow) return 'Lv ' + arrow[1] + ' → ' + arrow[2];
    // "3극 4준(3어센)" = burst-window counts: N full bursts / M semi-bursts (K Ascent uses)
    var burst = t.match(/^(\d+)극\s*(\d+)준(?:\((\d+)어센\))?$/);
    if (burst) return burst[1] + ' full / ' + burst[2] + ' semi burst' + (burst[3] ? ' (' + burst[3] + ' Ascent)' : '');
    var bm = t.match(/^(.+?)\s*\(보약\)$/);
    if (bm) { var base = d.dict[bm[1].trim()]; if (base) return base + ' (Buffs)'; }
    var um = t.match(/^유저 정보\s*:\s*(.*)$/);
    if (um) return 'User Info: ' + hangulRunPass(um[1], d);
    return null;
  }

  // Replace maximal Korean runs inside composite strings when the WHOLE run
  // is a known dict term (class names, boss names inside "nick / class Lv.X").
  function hangulRunPass(t, d) {
    return t.replace(/[가-힣][가-힣 ]*[가-힣]|[가-힣]/g, function (run) {
      var hit = d.dict[run];
      return hit != null ? hit : run;
    });
  }

  function translateString(s) {
    var d = data();
    var trimmed = s.trim();
    if (!trimmed) return null;
    var out = d.dict[trimmed];
    // Exact dict hits work for any language (also fixes Konglish English strings);
    // fuzzy handling below only applies to Korean text.
    if (out == null && !HANGUL.test(trimmed)) return null;
    if (out == null) {
      // "이름 ×3" / "이름 x3" quantity suffixes
      var m = trimmed.match(/^(.+?)\s*([×x]\s*[\d,]+)$/);
      if (m) {
        var base = d.dict[m[1].trim()];
        if (base != null) out = base + ' ' + m[2].replace(/\s+/g, '');
      }
    }
    if (out == null && d.rules) {
      for (var i = 0; i < d.rules.length; i++) {
        var rule = d.rules[i]; // [regexSource, flags, template] — template uses $1..$9
        var re = rule.__re || (rule.__re = new RegExp(rule[0], rule[1]));
        var mm = trimmed.match(re);
        if (mm) { out = rule[2].replace(/\$(\d)/g, function (_, n) { return mm[+n] != null ? mm[+n] : ''; }); break; }
      }
    }
    if (out == null) out = builtinRules(trimmed, d);
    // Last resort for composite nodes: translate embedded known terms.
    // Never touch strings with @handles (author credits, server@nickname).
    if (out == null && trimmed.indexOf('@') === -1) {
      var passed = hangulRunPass(trimmed, d);
      if (passed !== trimmed) out = passed;
    }
    if (out == null) return null;
    return s.replace(trimmed, out);
  }

  function translateTitle() {
    if (pathLocale() !== 'en') return;
    var d = data();
    var t = document.title;
    if (!t || !HANGUL.test(t)) return;
    var parts = t.split(/(\s[-|·]\s|\s\|\s|^\|\s?)/);
    var changed = t.split(' - ').map(function (seg) {
      return seg.split(' | ').map(function (piece) {
        var s2 = piece.replace(/^\|\s*/, '').trim();
        var hit = d.dict[s2];
        if (hit != null) return hit;
        if (s2 === '환산주스탯') return 'Maple Scouter';
        // leading piece is often the searched character's name — leave names alone
        return hangulRunPass(s2, d);
      }).join(' | ');
    }).join(' - ');
    changed = changed.replace(/환산주스탯/g, 'Maple Scouter');
    changed = changed.replace(/^Maple Scouter\s*[-|]\s*Maple Scouter$/, 'Maple Scouter');
    if (changed !== t) document.title = changed;
  }

  // The header logo is two spans reading 환산/주스탯 (the site's Korean brand).
  // Rebrand to the site's own English name instead of a literal translation.
  function fixLogo() {
    if (pathLocale() !== 'en') return;
    // every header link that wraps the logo image (desktop + mobile variants)
    var links = document.querySelectorAll('header a');
    for (var i = 0; i < links.length; i++) {
      if (!links[i].querySelector('img[alt="logo"], img[src*="logo"]')) continue;
      var spans = links[i].querySelectorAll('span');
      if (spans.length >= 2) {
        if (spans[0].textContent !== 'Maple ') spans[0].textContent = 'Maple ';
        if (spans[1].textContent !== 'Scouter') spans[1].textContent = 'Scouter';
      } else if (spans.length === 1 && spans[0].textContent !== 'Maple Scouter') {
        spans[0].textContent = 'Maple Scouter';
      }
    }
  }

  // Remove the (empty) Favorites bar under the search box — it reserves a large
  // block of vertical space. Set to false to keep the favorites feature.
  var REMOVE_FAVORITES = true;

  function hideFavoritesBar() {
    if (!REMOVE_FAVORITES) return;
    var spans = document.querySelectorAll('span.font-semibold');
    for (var i = 0; i < spans.length; i++) {
      var t = spans[i].textContent.trim();
      if (t !== 'Favorite' && t !== '즐겨찾기') continue;
      var block = spans[i].closest('div[class*="min-w-0"][class*="gap-3"]') ||
                  spans[i].closest('div[class*="py-3"]');
      if (block && !block.__msfixHidden) { block.__msfixHidden = true; block.style.display = 'none'; }
    }
  }

  /* ---------------- 4c. Preset export / import ------------------------------------------ */
  // The site keeps manual-input state and named presets in localStorage. These two
  // buttons let you back them up to a file and restore them on any browser/device.
  var PRESET_KEYS = ['character-store', 'preset'];

  function exportPreset() {
    var payload = { app: 'maplescouter-en-fix', type: 'preset-export', v: 1, exportedAt: new Date().toISOString(), data: {} };
    for (var i = 0; i < PRESET_KEYS.length; i++) {
      var v = null;
      try { v = localStorage.getItem(PRESET_KEYS[i]); } catch (e) {}
      if (v != null) payload.data[PRESET_KEYS[i]] = v;
    }
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'maplescouter-preset-' + payload.exportedAt.slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function importPreset() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        var p;
        try { p = JSON.parse(txt); } catch (e) { p = null; }
        if (!p || p.type !== 'preset-export' || !p.data || typeof p.data !== 'object') {
          alert('This is not a valid MapleScouter preset file.');
          return;
        }
        for (var k in p.data) {
          if (PRESET_KEYS.indexOf(k) !== -1 && typeof p.data[k] === 'string') localStorage.setItem(k, p.data[k]);
        }
        location.reload();
      });
    };
    inp.click();
  }

  function ensurePresetButtons() {
    if (document.getElementById('msfix-export-preset')) return;
    var buttons = document.querySelectorAll('button');
    var saveBtn = null;
    for (var i = 0; i < buttons.length; i++) {
      var t = buttons[i].textContent.trim();
      if (t === 'Save Preset' || t === '프리셋 저장') { saveBtn = buttons[i]; break; }
    }
    if (!saveBtn || !saveBtn.parentElement) return;
    var SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide h-4 w-4">';
    var ICONS = {
      // lucide "upload" — mirrors Save Preset's download-tray icon
      export_: SVG_OPEN + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
      // lucide "file-up" — mirrors Load Preset's file-down icon
      import_: SVG_OPEN + '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m15 15-3-3-3 3"/></svg>'
    };
    function mk(id, label, icon, handler) {
      var b = document.createElement('button');
      b.id = id;
      b.className = saveBtn.className;
      b.type = 'button';
      b.appendChild(document.createTextNode(label)); // plain text node = identical typography
      b.insertAdjacentHTML('beforeend', icon);
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); handler(); });
      return b;
    }
    var row = saveBtn.parentElement;
    row.appendChild(mk('msfix-export-preset', 'Export', ICONS.export_, exportPreset));
    row.appendChild(mk('msfix-import-preset', 'Import', ICONS.import_, importPreset));
    // compact the row so all four buttons share the title's line in the 500px panel
    row.style.gap = '6px';
    var all = row.querySelectorAll('button');
    for (var k = 0; k < all.length; k++) {
      all[k].style.paddingLeft = '8px';
      all[k].style.paddingRight = '8px';
      all[k].style.fontSize = '13px';
    }
  }

  // Our longer English labels ("Genesis Liberated" etc.) can make the weapon-state
  // checkbox row wrap — compact that row so all options stay on one line.
  function compactCheckboxRows() {
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) {
      var t = labels[i].textContent.trim();
      if (t !== 'Genesis Liberated' && t !== 'Mu Gong Soul') continue;
      var row = labels[i].parentElement;
      if (!row || row.__msfixCompact) continue;
      row.__msfixCompact = true;
      row.style.flexWrap = 'nowrap';
      row.style.columnGap = '10px';
      var ls = row.querySelectorAll('label');
      for (var j = 0; j < ls.length; j++) {
        ls[j].style.fontSize = '13px';
        ls[j].style.whiteSpace = 'nowrap';
        ls[j].style.gap = '6px';
      }
    }
  }

  // The homepage update-history table is Korean-only API content that cannot be
  // statically translated — hide it in English mode rather than show raw Korean.
  function hideKoreanChangelog() {
    if (pathLocale() !== 'en') return;
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var head = t.rows && t.rows[0] ? t.rows[0].textContent.replace(/\s+/g, '') : '';
      if (!/^(Date(Highlights|Updates?)|날짜)/i.test(head)) continue;
      var kr = 0, n = t.rows.length - 1;
      for (var j = 1; j < t.rows.length; j++) if (HANGUL.test(t.rows[j].textContent)) kr++;
      if (n > 0 && kr / n > 0.5) {
        // hide the whole card (heading + shell), not just the table
        var wrap = t.closest('div[class*="bg-surface-gray-surface-0"]') || t.closest('div') || t;
        if (!wrap.__msfixHidden) { wrap.__msfixHidden = true; wrap.style.display = 'none'; }
      }
    }
  }

  // Character/player names must never be translated. Names appear inside links to
  // /info?name=X and in the live-search ticker rows — skip those contexts entirely.
  function isPlayerNameContext(node) {
    var p = node.parentElement;
    for (var i = 0; i < 5 && p; i++, p = p.parentElement) {
      if (p.tagName === 'A' && /[?&]name=/.test(p.getAttribute('href') || '')) return true;
      var cls = (p.className || '').toString();
      if (cls.indexOf('text-mini') !== -1 && cls.indexOf('h-6') !== -1) return true;
    }
    return false;
  }

  function translateTextNode(node) {
    var v = node.nodeValue;
    if (!v) return;
    if (HANGUL.test(v) && isPlayerNameContext(node)) return;
    var r = translateString(v);
    if (r != null && r !== v) node.nodeValue = r;
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(a);
      if (v) {
        var r = translateString(v);
        if (r != null && r !== v) el.setAttribute(a, r);
      }
    }
  }

  function processTree(root) {
    if (pathLocale() !== 'en') return; // dormant on the Korean/Japanese/Chinese site
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    var tag = root.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var t = p.nodeName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) translateTextNode(nodes[i]);
    if (root.querySelectorAll) {
      if (root.nodeType === 1) translateAttrs(root);
      var els = root.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
      for (var j = 0; j < els.length; j++) translateAttrs(els[j]);
    }
  }

  var observer = null;

  function startDomLayer() {
    if (observer) return;
    // The observer is ALWAYS attached (even on /ko) so that switching language via
    // the SPA selector — no page reload — still translates dynamically-mounted
    // content like tooltips. All translate entry points no-op unless the path is /en.
    processTree(document.body);
    observer = new MutationObserver(function (muts) {
      var en = pathLocale() === 'en';
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var k = 0; k < m.removedNodes.length; k++) onFloatingRemoved(m.removedNodes[k]);
          for (var j = 0; j < m.addedNodes.length; j++) {
            trackFloating(m.addedNodes[j]);
            if (en) processTree(m.addedNodes[j]);
          }
        }
        if (!en) continue;
        if (m.type === 'characterData') translateTextNode(m.target);
        else if (m.type === 'attributes' && m.target.nodeType === 1) translateAttrs(m.target);
      }
      if (en) fixLogo(); // React re-renders restore the Korean logo spans; keep it rebranded
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  /* ---------------- 4a. Tooltip keep-alive ---------------------------------------------- */
  // Some site tooltips (boss hover cards etc.) close the moment the pointer enters
  // them. If a floating layer is removed while the cursor is inside its box, we pin
  // a static clone in place until the mouse genuinely leaves it.
  var mouse = { x: -1, y: -1 };
  document.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, true);

  var FLOAT_SELECTOR = '[data-radix-popper-content-wrapper], [role="tooltip"], [data-side][data-state]';
  var floatRects = new Map(); // element -> DOMRect (last known)
  var pinned = null;
  // keep tracked rects accurate while scrolling (tooltips scroll with content until removed)
  window.addEventListener('scroll', function () { refreshFloatRects(); }, { passive: true, capture: true });

  function trackFloating(root) {
    if (!root || root.nodeType !== 1) return;
    var els = [];
    if (root.matches && root.matches(FLOAT_SELECTOR)) els.push(root);
    if (root.querySelectorAll) els.push.apply(els, root.querySelectorAll(FLOAT_SELECTOR));
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.height > 60 && r.width > 100) floatRects.set(els[i], r);
    }
  }

  function refreshFloatRects() {
    floatRects.forEach(function (_, el) {
      if (!document.contains(el)) { floatRects.delete(el); return; }
      var r = el.getBoundingClientRect();
      if (r.height > 0) floatRects.set(el, r);
    });
  }

  function insideRect(r, pad) {
    return mouse.x >= r.left - pad && mouse.x <= r.right + pad && mouse.y >= r.top - pad && mouse.y <= r.bottom + pad;
  }

  function unpin() {
    if (pinned) { pinned.el.remove(); document.removeEventListener('mousemove', pinned.watch, true); pinned = null; }
  }

  function pinTooltip(node, r) {
    unpin();
    var clone = node.cloneNode(true);
    clone.id = 'msfix-pinned-tooltip';
    clone.style.position = 'fixed';
    clone.style.left = r.left + 'px';
    clone.style.top = r.top + 'px';
    clone.style.zIndex = '2147483000';
    clone.style.pointerEvents = 'auto';
    clone.style.margin = '0';
    clone.style.transform = 'none';
    document.body.appendChild(clone);
    var watch = function () {
      if (!insideRect(r, 14)) unpin();
    };
    pinned = { el: clone, watch: watch };
    document.addEventListener('mousemove', watch, true);
    // NOTE: no scroll-based unpin — the clone is viewport-fixed, so it stays put
    // while scrolling and only closes when the mouse leaves its box.
  }

  function onFloatingRemoved(node) {
    if (node.nodeType !== 1) return;
    var candidates = [node];
    floatRects.forEach(function (_, el) { if (node === el || node.contains(el)) candidates.push(el); });
    for (var i = 0; i < candidates.length; i++) {
      var r = floatRects.get(candidates[i]);
      if (r) {
        floatRects.delete(candidates[i]);
        if (insideRect(r, 6)) { pinTooltip(candidates[i], r); return; }
      }
    }
  }

  /* ---------------- 4b. Ad removal ------------------------------------------------------ */
  // Static slots/banners are hidden by the injected CSS; popup ad modals are built
  // dynamically, so we remove any fixed-position overlay that carries an ad creative.
  var REMOVE_ADS = true;

  function killAdPopups() {
    if (!REMOVE_ADS) return;
    var imgs = document.querySelectorAll('img[src*="/next/ads/"], img[src*="files.maplescouter.com/next/ads"]');
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i], overlay = null, p = el.parentElement;
      while (p && p !== document.body) {
        var pos = getComputedStyle(p).position;
        if (pos === 'fixed') overlay = p;
        p = p.parentElement;
      }
      if (overlay) overlay.remove();
    }
  }

  /* ---------------- 5. UI polish CSS ---------------------------------------------------- */

  function injectCss() {
    var css = data().css;
    if (!css) return;
    var style = document.createElement('style');
    style.id = 'msfix-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------------- boot ---------------------------------------------------------------- */

  if (restoreLocale()) return; // redirecting; nothing else to do on this load
  restoreRegion();
  hookWebpack();

  // Track SPA navigations for locale saving + fresh sweeps.
  var origPush = history.pushState;
  history.pushState = function () {
    var r = origPush.apply(this, arguments);
    onNavigate();
    return r;
  };
  var origReplace = history.replaceState;
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments);
    onNavigate();
    return r;
  };
  window.addEventListener('popstate', onNavigate);

  function onNavigate() {
    saveLocale();
    backupRegion();
    if (document.body && pathLocale() === 'en') {
      setTimeout(function () { processTree(document.body); }, 50);
    }
  }

  function onReady() {
    injectCss();
    // Delay the DOM layer slightly so React hydration finishes first.
    setTimeout(startDomLayer, 250);
    setTimeout(function () { translateTitle(); fixLogo(); killAdPopups(); hideKoreanChangelog(); hideFavoritesBar(); ensurePresetButtons(); compactCheckboxRows(); }, 400);
    setInterval(function () { backupRegion(); translateTitle(); fixLogo(); killAdPopups(); hideKoreanChangelog(); hideFavoritesBar(); ensurePresetButtons(); compactCheckboxRows(); refreshFloatRects(); }, 2000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') onReady();
  else window.addEventListener('DOMContentLoaded', onReady);
})();
