// ==UserScript==
// @name         MapleScouter English Fix
// @namespace    https://github.com/tomerh2001/maplescouter-en-fix
// @version      1.5.1
// @description  Complete English translations for maplescouter.com (GMS-context, not literal), a character picker with auto-save + cloud sync for the Manual Input page, and it remembers your language & server (GMS/KMS) selections.
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
 * 4. Cloud characters   — on the Manual Input page, a character picker replaces the site's
 *    Load/Save Preset buttons: inputs auto-save into the selected preset, and presets linked
 *    to an IGN sync with scouter.tomerh2001.com (explicit upload, opt-in auto-upload).
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
    siteRefs.enBundle = obj; // the site's EN table (with our patch merged in) — used to name classes
    if (obj.__msfixPatched) return;
    try { Object.defineProperty(obj, '__msfixPatched', { value: true, enumerable: false }); } catch (e) { obj.__msfixPatched = true; }
    var patch = data().i18nPatch;
    for (var k in patch) obj[k] = patch[k];
  }

  /* -- site stores, captured passively as webpack executes each module (no forced requires) */
  var siteRefs = { manualStore: null, presetStore: null, toast: null, enBundle: null, defaultUserStat: null };
  // Test hook: with localStorage msfix:debug=1 the discovered refs are mirrored on window so an
  // end-to-end harness can drive the same stores we use, instead of force-requiring site modules.
  var DEBUG_REFS = false;
  try { DEBUG_REFS = localStorage.getItem('msfix:debug') === '1'; } catch (e) {}
  if (DEBUG_REFS) window.__msfixDebug = siteRefs;
  function looksLikeUserStat(v) {
    return !!(v && typeof v === 'object' && v.stat && v.hexa && v.huntSkill && v.seedRing &&
      typeof v.isGMS === 'boolean' && typeof v.stat.myClass === 'string');
  }
  function noteExports(ex) {
    if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) return;
    var names; try { names = Object.keys(ex); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var v; try { v = ex[names[i]]; } catch (e) { continue; }
      if (!v || (typeof v !== 'object' && typeof v !== 'function')) continue;
      try {
        if (!siteRefs.toast && typeof v.success === 'function' && typeof v.error === 'function' && typeof v.dismiss === 'function') siteRefs.toast = v;
        if (!siteRefs.defaultUserStat && looksLikeUserStat(v)) siteRefs.defaultUserStat = v;
        if (typeof v.getState === 'function' && typeof v.subscribe === 'function') {
          var st = v.getState();
          if (st && !siteRefs.presetStore && st.preset && typeof st.setPreset === 'function' && typeof st.deletePreset === 'function') siteRefs.presetStore = v;
          if (st && !siteRefs.manualStore && ('draftStat' in st) && typeof st.loadDraft === 'function' && typeof st.setDraftStat === 'function') siteRefs.manualStore = v;
        }
      } catch (e) {}
    }
  }

  function wrapFactory(factory) {
    if (typeof factory !== 'function' || factory.__msfixWrapped) return factory;
    var wrapped = function (module, exports, req) {
      var r = factory.apply(this, arguments);
      try {
        var ex = module && module.exports;
        var payload = ex && ex.default && typeof ex.default === 'object' ? ex.default : ex;
        if (isEnBundle(payload)) applyPatch(payload);
        noteExports(ex);
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

  // Phrase-level fallback for recurring composite families (boss measurement
  // notes etc.) whose exact variants are too numerous to enumerate.
  var PHRASES = [
    [/([A-Z]{1,3})직업/g, 'Class $1'],
    [/([A-Z]{1,3})보스/g, 'Boss $1'],
    [/체력 및 패턴 보정/g, 'HP & patterns adjusted'],
    [/체력 보정/g, 'HP adjusted'],
    [/하드 측정/g, 'Hard-mode measured'],
    [/노말 측정/g, 'Normal-mode measured'],
    [/측정 완료/g, 'measurement complete'],
    [/실측 배율/g, 'measured multiplier'],
    [/헥사보정/g, 'HEXA-adjusted'],
    [/타보스 참고/g, 'based on other bosses'],
    [/\(([\d.]+)\s*%\s*상향\)/g, '(+$1%)'],
    [/([\d.]+)\s*%\s*상향/g, '+$1%'],
    [/(\d+)분\s/g, '$1-min ']
  ];

  function phrasePass(t) {
    var out = t;
    for (var i = 0; i < PHRASES.length; i++) out = out.replace(PHRASES[i][0], PHRASES[i][1]);
    return out;
  }

  function translateString(s) {
    var d = data();
    var trimmed = s.trim();
    if (!trimmed) return null;
    var out = d.dict[trimmed];
    // Exact dict hits work for any language (also fixes Konglish English strings);
    // fuzzy handling below only applies to Korean text.
    if (out == null && !HANGUL.test(trimmed)) return null;
    if (out == null && trimmed.charAt(trimmed.length - 1) === ')') {
      // extraction captured many strings without their closing paren — retry
      var noParen = d.dict[trimmed.slice(0, -1)];
      if (noParen != null) out = noParen + (noParen.charAt(noParen.length - 1) === '(' ? ')' : /\([^)]*$/.test(noParen) ? ')' : '');
    }
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
    // Last resort for composite nodes: phrase families first, then embedded
    // known terms. Never touch strings with @handles (author credits).
    if (out == null && trimmed.indexOf('@') === -1) {
      var passed = hangulRunPass(phrasePass(trimmed), d);
      if (passed !== trimmed) out = passed;
    }
    if (out == null) return null;
    return s.replace(trimmed, out);
  }

  function translateTitle() {
    if (pathLocale() !== 'en') return;
    var d = data();
    var t = document.title;
    if (!t) return;
    var out = t.split(' - ').map(function (seg) {
      var s = seg.replace(/^\s*\|\s*/, '').trim(); // some titles start with a stray "| "
      var hit = d.dict[s];
      if (hit != null) return hit;
      if (/환산주스탯/.test(s)) return 'Maple Scouter';
      return HANGUL.test(s) ? hangulRunPass(s, d) : s;
    }).join(' - ');
    out = out
      .replace(/환산주스탯/g, 'Maple Scouter')
      .replace(/Boss Cut\b/g, 'Boss Clear Spec')       // stale site title uses the old wording
      .replace(/^\s*[|\-·∙]\s*/, '')                    // drop any leading separator
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (out && out !== t) document.title = out;
  }

  // The header logo is two spans reading 환산/주스탯 (the site's Korean brand).
  // Rebrand to the site's own English name instead of a literal translation.
  function fixLogo() {
    if (pathLocale() !== 'en') return;
    // every header link that wraps the logo image (desktop + mobile variants)
    var links = document.querySelectorAll('header a');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (!link.querySelector('img[alt="logo"], img[src*="logo"]')) continue;
      var spans = link.querySelectorAll('span');
      if (spans.length >= 2) {
        if (spans[0].textContent !== 'Maple ') spans[0].textContent = 'Maple ';
        if (spans[1].textContent !== 'Scouter') spans[1].textContent = 'Scouter';
      } else if (spans.length === 1 && spans[0].textContent !== 'Maple Scouter') {
        spans[0].textContent = 'Maple Scouter';
      }
      addCredit(link);
    }
  }

  // "Patched by Tomerh2001" tucked under the logo wordmark. It is positioned
  // ABSOLUTELY, anchored to the logo link itself (which we make position:relative),
  // so it is taken out of flow — the header's flex/justify-between layout, and its
  // responsive variants, can never move it, center it, or resize the row. left is
  // the wordmark's own offset (aligns under the text, past the icon); top:100% sits
  // it just below the logo. It is a <span> (a nested <a> is invalid) with a click
  // handler opening the repo, and every size/weight is forced with !important so the
  // site's CSS cannot inflate it. Re-applied after React re-renders by fixLogo().
  var CREDIT_URL = 'https://github.com/tomerh2001/maplescouter-en-fix';
  function addCredit(link) {
    if (link.querySelector('.msfix-credit')) return;
    if (!link.offsetHeight || !link.offsetWidth) return; // not laid out yet; retry next tick
    link.style.removeProperty('flex-wrap'); // undo any earlier-version wrapping
    if (getComputedStyle(link).position === 'static') link.style.position = 'relative';
    var wordmark = link.querySelector('span');
    var indent = wordmark ? wordmark.offsetLeft : 28;
    var s = document.createElement('span');
    s.className = 'msfix-credit';
    s.textContent = 'Patched by Tomerh2001';
    s.title = 'English patch by tomerh2001 — click for the source';
    var force = function (k, v) { s.style.setProperty(k, v, 'important'); };
    force('position', 'absolute');
    force('left', indent + 'px');
    force('top', '100%');
    force('margin-top', '2px');
    force('font-size', '9px');
    force('line-height', '1');
    force('font-weight', '600');
    force('letter-spacing', '0.4px');
    force('opacity', '0.45');
    force('color', 'currentColor');
    force('white-space', 'nowrap');
    force('cursor', 'pointer');
    force('pointer-events', 'auto');
    force('z-index', '2');
    force('text-decoration', 'none');
    s.addEventListener('mouseenter', function () { force('opacity', '0.85'); force('text-decoration', 'underline'); });
    s.addEventListener('mouseleave', function () { force('opacity', '0.45'); force('text-decoration', 'none'); });
    s.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); window.open(CREDIT_URL, '_blank', 'noopener'); });
    link.appendChild(s);
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

  /* ---------------- 4c. Preset JSON: legacy files, character picker, overwrite ---------- */
  // The site ships its own JSON preset export/import (Aug 2026), so we no longer add
  // Export/Import buttons of our own. Two gaps are left, and this section fills both.
  //
  //  1. A file exported by our OLD button holds EVERY preset that was saved at the time
  //       {app:'maplescouter-en-fix', type:'preset-export', v:1, data:{'character-store','preset'}}
  //     whereas the site imports one preset per file and rejects our shape outright. We
  //     translate such a file into the site's native format as it is read and let the site's
  //     OWN importer take it from there (it validates, adds a slot, toasts, no reload). When
  //     the file holds more than one character we first ask which one to import.
  //
  //  2. The site's import can only ever ADD a preset. To refresh one that already exists we
  //     add an Import button to the Save window — file, character, target preset, name, then
  //     an explicit confirm — writing through the site's own preset store so the UI updates
  //     live. (Note the manual-input form renders from 'manual-store'/draftStat, NOT from
  //     'character-store', which is why restoring localStorage wholesale never showed up.)
  function isLegacyExport(obj) {
    return obj && typeof obj === 'object' &&
      (obj.app === 'maplescouter-en-fix' || obj.type === 'preset-export') &&
      obj.data && typeof obj.data === 'object';
  }

  // The site validates an imported preset's data against its CURRENT schema and throws on any
  // missing key. Old files were exported against an older schema, so deep-conform their data
  // to the shape of a current, live userStat (fills any keys added since) before handing it over.
  function conformTo(template, data) {
    if (Array.isArray(template)) {
      return (Array.isArray(data) && data.length === template.length)
        ? template.map(function (t, i) { return conformTo(t, data[i]); })
        : template;
    }
    if (template && typeof template === 'object') {
      var out = {};
      for (var k in template) {
        out[k] = (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, k))
          ? conformTo(template[k], data[k]) : template[k];
      }
      return out;
    }
    return (data !== null && data !== undefined && typeof data === typeof template) ? data : template;
  }

  // A current, schema-current userStat to use as the conform template (preset slot > live build).
  function currentUserStatTemplate() {
    try {
      var pr = JSON.parse(localStorage.getItem('preset'));
      var slots = pr && pr.state && pr.state.preset;
      for (var k in slots) { var d = slots[k] && slots[k].data; if (d && d.stat && ('myClass' in d.stat)) return d; }
    } catch (e) {}
    try {
      var cs = JSON.parse(localStorage.getItem('character-store'));
      var us = cs && cs.state && cs.state.searchResult && cs.state.searchResult.userStat;
      if (us && us.stat) return us;
    } catch (e) {}
    try {
      var ms = JSON.parse(localStorage.getItem('manual-store'));
      var ds = ms && ms.state && ms.state.draftStat;
      if (ds && ds.stat) return ds;
    } catch (e) {}
    return null;
  }

  // Pull every usable preset out of an old export, as native-format {data,label,savedAt} entries.
  function legacyPresets(oldObj) {
    var tmpl = currentUserStatTemplate();
    var list = [];
    var src = oldObj.data || {};
    function add(rawData, label, savedAt) {
      if (!rawData || typeof rawData !== 'object' || !rawData.stat || !rawData.stat.myClass) return;
      list.push({
        data: tmpl ? conformTo(tmpl, rawData) : rawData,
        label: typeof label === 'string' ? label : '',
        savedAt: typeof savedAt === 'string' ? savedAt : null
      });
    }
    try {
      var pr = src.preset ? JSON.parse(src.preset) : null;
      var slots = pr && pr.state && pr.state.preset;
      if (slots) Object.keys(slots).sort(function (a, b) { return (+a) - (+b); })
        .forEach(function (k) { add(slots[k] && slots[k].data, slots[k] && slots[k].label, slots[k] && slots[k].savedAt); });
    } catch (e) {}
    if (!list.length) { // no saved slots → fall back to the backed-up live build
      try {
        var cs = src['character-store'] ? JSON.parse(src['character-store']) : null;
        var us = cs && cs.state && cs.state.searchResult && cs.state.searchResult.userStat;
        add(us, 'Imported backup', null);
      } catch (e) {}
    }
    return list;
  }

  function nativePresetJson(p) {
    // Give it a caption of its own: an unlabelled preset is otherwise captioned from whichever
    // character happens to be loaded, which would misname what we just imported.
    return JSON.stringify({
      type: 'maplescouter-manual-preset', v: 1,
      savedAt: p.savedAt, label: p.label || autoPresetLabel(p.data), data: p.data
    });
  }

  // Read any preset file we understand: ours (which may hold many characters) or the site's own.
  function parsePresetFile(txt) {
    var obj = null;
    try { obj = JSON.parse(txt); } catch (e) { return null; }
    if (isLegacyExport(obj)) return { kind: 'legacy', presets: legacyPresets(obj) };
    if (obj && obj.type === 'maplescouter-manual-preset' && obj.data) {
      return { kind: 'native', presets: [{
        data: obj.data,
        label: typeof obj.label === 'string' ? obj.label : '',
        savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : null,
        ign: typeof obj.ign === 'string' && IGN_RE.test(obj.ign) ? obj.ign : null   // our export enrichment (4d)
      }] };
    }
    return null;
  }

  // The site names an unlabelled preset "Lv <level> <class>"; mirror that, but store the class
  // already translated so the saved label reads as English everywhere it is shown or exported.
  function autoPresetLabel(d) {
    try {
      var cls = d.stat.myClass;
      var dict = data().dict || {};
      return 'Lv ' + d.stat.level + ' ' + (dict[cls] || cls);
    } catch (e) { return ''; }
  }
  // An untouched preset slot still holds the site's default data (level 0), and offering that
  // as something to import is just noise — the site itself treats level > 0 as "really saved".
  function presetDataOk(d) {
    if (!d || !d.stat || !d.stat.myClass) return false;
    var lv = Number(d.stat.level);
    return isFinite(lv) && lv > 0 && lv <= 300;
  }
  function shortDate(s) {
    if (!s) return '';
    var t = new Date(s);
    return isNaN(t.getTime()) ? '' : t.toLocaleDateString() + ' ' + t.toLocaleTimeString();
  }

  /* -- the site's own preset store + toast, found by SHAPE so module ids may change ------- */
  var _wpReq = null;
  function wpRequire() {
    if (_wpReq) return _wpReq;
    try {
      var arr = self.webpackChunk_N_E;
      if (arr && typeof arr.push === 'function') arr.push([[Symbol('msfix')], {}, function (r) { _wpReq = r; }]);
    } catch (e) {}
    return _wpReq;
  }
  // Normally both were captured passively while the site loaded; the scan (scanSiteModules,
  // section 4d) is only a fallback for anything missed, and only runs once the page is loaded.
  function siteApi() {
    if (!siteRefs.presetStore) scanSiteModules();
    return siteRefs.presetStore ? { presetStore: siteRefs.presetStore, toast: siteRefs.toast } : null;
  }
  function siteToast() { if (siteRefs.toast) return siteRefs.toast; var a = siteApi(); return a ? a.toast : null; }
  function toastOk(m) { var t = siteToast(); if (t) try { t.success(m); } catch (e) {} }
  function toastErr(m) { var t = siteToast(); if (t) try { t.error(m); } catch (e) {} }

  /* -- dialogs assembled from the site's own utility classes so they look native --------- */
  var CLS = {
    box: 'bg-surface-gray-surface-0 fixed top-[50%] left-[50%] z-[2147483647] grid max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg w-[440px] max-w-[95vw]',
    body: 'flex w-full flex-col gap-4',
    list: 'flex w-full flex-col gap-2',
    head: 'text-center text-sm font-semibold',
    hint: 'text-text-gray-low text-center text-xs',
    hintLeft: 'text-text-gray-low text-xs',
    row: "inline-flex cursor-pointer justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline outline-outline-gray-med text-text-gray-high hover:bg-surface-gray-surface-1 active:bg-surface-gray-surface-1 px-4 has-[>svg]:px-3 h-auto w-full flex-col items-center gap-0.5 py-2",
    rowMain: 'w-full truncate text-center',
    rowSub: 'text-text-gray-low text-xs',
    soft: "inline-flex items-center cursor-pointer justify-center whitespace-nowrap text-sm font-medium transition-all [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 bg-surface-gray-surface-2 text-text-gray-high hover:bg-surface-gray-surface-3 h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
    primary: "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 bg-primary text-text-gray-white hover:bg-surface-primary-primary-hover h-9 px-4 py-2 has-[>svg]:px-3 flex-1",
    ghost: 'inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all outline outline-outline-gray-med text-text-gray-high hover:bg-surface-gray-surface-1 h-9 px-4 py-2 flex-1',
    input: 'placeholder:text-muted-gray-low outline-outline-gray-med bg-surface-gray-surface-0 flex w-full min-w-0 rounded-[4px] text-sm outline transition-[color,box-shadow] md:text-sm h-8 px-2 py-[5.5px] focus:outline-outline-gray-high',
    footer: 'border-outline-gray-med flex flex-col gap-2 border-t pt-3',
    close: 'absolute top-4 right-4 cursor-pointer rounded-xs opacity-70 transition-opacity hover:opacity-100',
    iconGroup: 'absolute top-1/2 right-2 flex -translate-y-1/2 gap-1',
    iconBtn: "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline outline-outline-gray-med text-text-gray-high active:bg-surface-gray-surface-1 border-outline-gray-med bg-surface-gray-surface-0 hover:bg-surface-gray-surface-1 size-7 shadow-sm"
  };
  var ICON_FILE_UP = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-up size-4"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/></svg>';
  var ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x size-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // Dialogs stack (character -> name -> confirm), so only the front-most one may be dismissed:
  // a click or Escape must never reach through and close the ones waiting behind it.
  var dlgStack = [];

  function msDialog(opts) {
    // The site's dialog is modal, and Radix parks `pointer-events:none` on <body> while it is
    // open — which our dialog would inherit — so both layers opt back in explicitly. Both also
    // sit at the same z-index as the site's dialog, letting DOM order do the stacking.
    var overlay = document.createElement('div');
    overlay.className = 'msfix-dialog-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;pointer-events:auto';
    var box = document.createElement('div');
    box.className = CLS.box + ' msfix-dialog';
    box.style.setProperty('pointer-events', 'auto', 'important');
    box.setAttribute('role', 'dialog');
    box.setAttribute('data-msfix-ui', ''); overlay.setAttribute('data-msfix-ui', ''); // never translated (IGNs/labels inside)
    var body = document.createElement('div');
    body.className = CLS.body;
    box.appendChild(body);

    var handle = {};
    dlgStack.push(handle);
    function isTop() { return dlgStack[dlgStack.length - 1] === handle; }
    function close() {
      var i = dlgStack.indexOf(handle);
      if (i !== -1) dlgStack.splice(i, 1);
      window.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    function cancel() { if (!isTop()) return; close(); if (opts.onCancel) opts.onCancel(); }
    // Escape must dismiss ONLY the front-most window. The site's dialog listens on document,
    // so we take the key on `window` — which captures first — and stop it dead there.
    function onKey(e) {
      if (e.key !== 'Escape' || !isTop()) return;
      e.preventDefault(); e.stopImmediatePropagation(); cancel();
    }
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', cancel);

    // The site's dialog dismisses itself on any pointer event outside its own box — which is
    // every click in ours. Keep those from reaching it so the window we opened on top of never
    // takes the one behind it down with it.
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'focusin'].forEach(function (t) {
      var swallow = function (e) { e.stopPropagation(); };
      overlay.addEventListener(t, swallow);
      box.addEventListener(t, swallow);
    });

    var x = document.createElement('button');
    x.type = 'button'; x.className = CLS.close; x.innerHTML = ICON_X;
    x.addEventListener('click', cancel);
    box.appendChild(x);

    var head = document.createElement('span');
    head.className = CLS.head; head.textContent = opts.title;
    body.appendChild(head);
    if (opts.subtitle) {
      var sub = document.createElement('span');
      sub.className = CLS.hint; sub.textContent = opts.subtitle;
      body.appendChild(sub);
    }
    if (opts.build) opts.build(body, close);

    document.body.appendChild(overlay);
    document.body.appendChild(box);
    return { close: close };
  }

  function msRow(main, sub, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = CLS.row;
    var m = document.createElement('span'); m.className = CLS.rowMain; m.textContent = main;
    b.appendChild(m);
    if (sub) { var s = document.createElement('span'); s.className = CLS.rowSub; s.textContent = sub; b.appendChild(s); }
    b.addEventListener('click', onClick);
    return b;
  }
  function msActions(body, cancelLabel, onCancel, goLabel, onGo) {
    var row = document.createElement('div');
    row.className = 'flex w-full gap-2';
    var no = document.createElement('button');
    no.type = 'button'; no.className = CLS.ghost; no.textContent = cancelLabel;
    no.addEventListener('click', onCancel);
    var yes = document.createElement('button');
    yes.type = 'button'; yes.className = CLS.primary; yes.textContent = goLabel;
    yes.addEventListener('click', onGo);
    row.appendChild(no); row.appendChild(yes);
    body.appendChild(row);
  }

  // Step 1 — an old file can hold every preset we ever saved, so ask which character to use.
  // Skipped entirely when the file only holds one.
  function pickPreset(presets, cb, onCancel) {
    if (presets.length === 1) { cb(presets[0]); return; }
    msDialog({
      title: 'Select the character to import',
      subtitle: 'This file holds ' + presets.length + ' saved presets.',
      onCancel: onCancel,
      build: function (body, close) {
        var list = document.createElement('div'); list.className = CLS.list;
        presets.forEach(function (p, i) {
          list.appendChild(msRow(
            p.label || autoPresetLabel(p.data) || ('Preset ' + (i + 1)),
            shortDate(p.savedAt),
            function () { close(); cb(p); }
          ));
        });
        body.appendChild(list);
      }
    });
  }

  // Step 2 — the name: keep what the slot has, take the file's, auto, or type one.
  function pickName(p, slotKey, isNew, current) {
    var fromFile = p.label || '';
    var auto = autoPresetLabel(p.data);
    var currentName = current ? (current.label || '') : '';
    msDialog({
      title: 'Name for Preset ' + slotKey,
      subtitle: 'Pick a name, or type your own.',
      build: function (body, close) {
        var input = document.createElement('input');
        input.className = CLS.input;
        input.setAttribute('maxlength', '40');
        input.placeholder = 'Preset name (auto if left blank)';
        input.value = fromFile || currentName || '';
        body.appendChild(input);

        var list = document.createElement('div'); list.className = CLS.list;
        if (fromFile) list.appendChild(msRow('Use the name from the file', fromFile,
          function () { input.value = fromFile; input.focus(); }));
        if (!isNew && currentName) list.appendChild(msRow('Keep the current name', currentName,
          function () { input.value = currentName; input.focus(); }));
        if (auto) list.appendChild(msRow('Use the automatic name', auto,
          function () { input.value = auto; input.focus(); }));
        body.appendChild(list);

        msActions(body, 'Cancel', function () { close(); },
          'Continue', function () { close(); confirmWrite(p, slotKey, isNew, current, input.value.trim()); });
        setTimeout(function () { input.focus(); }, 30);
      }
    });
  }

  // Step 4 — overwriting throws away a saved preset, so confirm it explicitly.
  function confirmWrite(p, slotKey, isNew, current, label) {
    var shown = label || autoPresetLabel(p.data);
    var currentName = current ? (current.label || (presetDataOk(current.data) ? autoPresetLabel(current.data) : '')) : '';
    msDialog({
      title: isNew ? ('Add as Preset ' + slotKey + '?') : ('Overwrite Preset ' + slotKey + '?'),
      subtitle: isNew
        ? (shown + ' will be saved as Preset ' + slotKey + '.')
        : ('Preset ' + slotKey + (currentName ? ' (' + currentName + ')' : '') + ' will be replaced by ' + shown + '. This cannot be undone.'),
      build: function (body, close) {
        msActions(body, 'Cancel', function () { close(); },
          isNew ? 'Add preset' : 'Overwrite', function () { close(); applyPreset(p, slotKey, label); });
      }
    });
  }

  function applyPreset(p, slotKey, label) {
    var api = siteApi();
    if (!api) { toastErr('Preset storage is unavailable'); return; }
    var st = api.presetStore.getState();
    var map = {}, cur = st.preset || {};
    for (var k in cur) map[k] = cur[k];
    var tmpl = currentUserStatTemplate();
    // An unlabelled preset is captioned from whatever character is loaded right now, not from
    // the preset itself — which would show the wrong name here — so always store one.
    map[slotKey] = {
      data: tmpl ? conformTo(tmpl, p.data) : p.data,
      label: label || autoPresetLabel(p.data),
      savedAt: new Date().toISOString()
    };
    try { st.setPreset(map); } catch (e) { toastErr('Could not save the preset'); return; }
    if (p.ign && !bindingByIgn(p.ign)) bindSlot(slotKey, p.ign, null); // file carried an IGN: link the slot
    toastOk('Preset ' + slotKey + ' updated' + (label ? ' (' + label + ')' : ''));
    var closeBtn = document.querySelector('[data-slot=dialog-close]');
    if (closeBtn) closeBtn.click();
  }

  function pickJsonFile(cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.style.display = 'none';
    inp.__msfixOwn = true; // so the interception below ignores our own picker
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!f) return;
      if (f.size > 5e6) { toastErr('File is abnormally large'); return; }
      f.text().then(cb, function () { toastErr("Couldn't read the file"); });
    });
    document.body.appendChild(inp);
    inp.click();
  }

  // The Save window is the dialog with the name field; the Load window has none.
  function saveDialogEl() {
    var dlgs = document.querySelectorAll('[data-slot=dialog-content]');
    for (var i = 0; i < dlgs.length; i++) if (dlgs[i].querySelector('input[data-slot=input]')) return dlgs[i];
    return null;
  }

  // The site's own import can only ever ADD a preset. Give every row in the Save window an
  // Import icon next to its Save-as-JSON / Delete pair, so a file can refresh THAT preset:
  // file -> character (when the file holds several) -> name -> confirm.
  function ensureSaveImportIcons() {
    var dlg = saveDialogEl();
    if (!dlg) return;
    var list = dlg.querySelector('div.flex.w-full.flex-col.gap-2');
    if (!list) return;
    var rows = list.querySelectorAll(':scope > div.group.relative');
    for (var i = 0; i < rows.length; i++) addRowImportIcon(rows[i], String(i + 1));
  }

  function addRowImportIcon(row, slotKey) {
    if (row.querySelector('.msfix-row-import')) return;
    // Saved presets already carry an icon group; empty slots have none, so make one.
    var group = row.querySelector('div.absolute.top-1\\/2.right-2');
    if (!group) {
      group = document.createElement('div');
      group.className = CLS.iconGroup;
      row.appendChild(group);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CLS.iconBtn + ' msfix-row-import';
    btn.title = 'Import from JSON file (overwrite this preset)';
    btn.innerHTML = ICON_FILE_UP;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var api = siteApi();
      var cur = api ? (api.presetStore.getState().preset || {})[slotKey] : null;
      var isNew = !(cur && presetDataOk(cur.data));
      pickJsonFile(function (txt) {
        var parsed = parsePresetFile(txt);
        var usable = parsed ? parsed.presets.filter(function (p) { return presetDataOk(p.data); }) : [];
        if (!usable.length) { toastErr("This isn't MapleScouter manual-preset data"); return; }
        pickPreset(usable, function (p) { pickName(p, slotKey, isNew, cur); });
      });
    });
    group.insertBefore(btn, group.firstChild);

    // The row's caption is centred across the full width, so an extra icon would have it run
    // underneath the icons. Reserve the icon strip's width on BOTH sides: the caption stays
    // centred and `truncate` clips it before it reaches them.
    var main = row.querySelector(':scope > button');
    if (!main) return;
    var pad = function () {
      var w = group.offsetWidth;
      if (!w) return;
      var v = (w + 12) + 'px';
      main.style.paddingLeft = v;
      main.style.paddingRight = v;
    };
    pad();
    setTimeout(pad, 50);
  }

  // The Load window's own Import reads one preset per file. Hold its handler until we know
  // what the file is: ours with several characters gets a picker first, then goes through as a
  // single native preset; anything else is handed straight back so the site imports it as usual.
  function installPresetImportBridge() {
    if (window.__msfixPresetBridge) return;
    window.__msfixPresetBridge = true;
    document.addEventListener('change', function (e) {
      var input = e.target;
      if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
      if (input.__msfixOwn) return;
      if (!/json/i.test(input.accept || '')) return;
      if (input.__msfixPass) { input.__msfixPass = false; return; } // our own replay
      var f = input.files && input.files[0];
      if (!f || typeof DataTransfer === 'undefined') return;

      e.stopImmediatePropagation();
      e.preventDefault();

      function deliver(text, name) {
        try {
          var dt = new DataTransfer();
          dt.items.add(new File([text], name || f.name, { type: 'application/json' }));
          input.__msfixPass = true;
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) { input.__msfixPass = false; }
      }

      f.text().then(function (txt) {
        var parsed = (typeof txt === 'string' && txt.length < 5e6) ? parsePresetFile(txt) : null;
        if (parsed && parsed.kind === 'native' && parsed.presets[0].ign) {   // link the slot the site is about to add
          cloud.pendingImport = { ign: parsed.presets[0].ign, label: parsed.presets[0].label, at: Date.now() };
        }
        if (!parsed || parsed.kind !== 'legacy') { deliver(txt); return; } // site handles its own files
        var usable = parsed.presets.filter(function (p) { return presetDataOk(p.data); });
        if (!usable.length) { deliver(txt); return; }                      // let the site explain why
        pickPreset(usable,
          function (p) { deliver(nativePresetJson(p), 'scouter-preset-import.json'); },
          function () { try { input.value = ''; } catch (err) {} });       // cancelled — allow a re-pick
      }, function () { deliver(''); });
    }, true);
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

  // Compact boss-viability badges carry their full meaning in a hover tooltip.
  var BADGE_TITLES = {
    '6 Players': 'Minimum spec to clear with 6 players',
    '4 Players': 'Minimum spec to clear with 4 players',
    '3 Players': 'Minimum spec to clear with 3 players',
    '2 Players': 'Minimum spec to clear with 2 players',
    '3 DPS': 'Minimum spec for a party of 3 DPS players',
    '2 Players + B': 'Minimum spec for 2 DPS plus a Bishop',
    'Soloable-': 'Bare minimum spec to solo this boss',
    'Soloable+': 'You can comfortably solo this boss',
    'Partyable': 'You can clear this boss in a party (as DPS)',
    'Partyable-': 'Minimum spec to clear in a party',
    'Soloable': 'You can solo this boss',
    'N/A': "Below this boss's entry requirements"
  };

  // Nodes we render ourselves (character picker, dialogs) hold raw IGNs and labels — several
  // ASCII dictionary keys ARE player names — so the whole translation layer skips them.
  function inOwnUi(n) {
    var e = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(e && e.closest && e.closest('[data-msfix-ui]'));
  }

  function translateTextNode(node) {
    var v = node.nodeValue;
    if (!v || inOwnUi(node)) return;
    if (HANGUL.test(v) && isPlayerNameContext(node)) return;
    var r = translateString(v);
    if (r != null && r !== v) node.nodeValue = r;
    var shown = (r != null ? r : v).trim();
    if (BADGE_TITLES[shown] && node.parentElement && !node.parentElement.title) {
      node.parentElement.title = BADGE_TITLES[shown];
    }
  }

  // Second-chance matching for paragraphs whose text is split across several
  // nodes (styled spans, <br>) or differs from the extracted literal only by
  // whitespace: match the element's combined, normalized text against the dict.
  function normKey(s) { return s.replace(/\s+/g, ' ').trim(); }

  function normIndex(d) {
    if (!d.__norm) {
      var m = {};
      for (var k in d.dict) {
        if (k.length >= 8 && HANGUL.test(k)) m[normKey(k)] = d.dict[k];
      }
      d.__norm = m;
    }
    return d.__norm;
  }

  var INLINE_TAGS = { BR: 1, SPAN: 1, B: 1, STRONG: 1, I: 1, EM: 1 };

  // Per-element replacement counter. Replacing textContent nukes React's child
  // spans; on a live-updating page React restores the Korean and we would replace
  // again — an infinite loop that freezes the tab. Capping attempts breaks it.
  var elAttempts = new WeakMap();

  function tryElementTranslate(el, d) {
    if (inOwnUi(el)) return;
    var kids = el.children;
    if (kids.length > 8) return;
    for (var i = 0; i < kids.length; i++) if (!INLINE_TAGS[kids[i].tagName]) return;
    var txt = el.textContent;
    if (!txt || txt.length < 8 || txt.length > 500 || !HANGUL.test(txt)) return;
    var tries = elAttempts.get(el) || 0;
    if (tries >= 2) return; // stop fighting a React re-render
    var idx = normIndex(d);
    var key = normKey(txt);
    var hit = idx[key];
    if (hit == null && key.charAt(key.length - 1) === ')') {
      // many extracted literals are missing their closing paren
      var h0 = idx[key.slice(0, -1)];
      if (h0 != null) hit = h0 + (/\([^)]*$/.test(h0) ? ')' : '');
    }
    if (hit && hit !== txt) { el.textContent = hit; elAttempts.set(el, tries + 1); }
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function translateAttrs(el) {
    if (inOwnUi(el)) return;
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
    if (inOwnUi(root)) return;
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
    // element-level pass FIRST — split paragraphs must match before the
    // per-node pass translates fragments inside them
    var d = data();
    var ew = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (el) {
        var t = el.nodeName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // Bound the work of a single (possibly huge) subtree so one processTree call
    // can never pin the CPU — a giant modal gets partial translation, not a freeze.
    var MAX = 2500, budget = MAX;
    if (root.nodeType === 1) tryElementTranslate(root, d);
    while (budget-- > 0 && ew.nextNode()) tryElementTranslate(ew.currentNode, d);
    var nodes = [], tbudget = MAX;
    while (tbudget-- > 0 && walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) translateTextNode(nodes[i]);
    if (root.querySelectorAll) {
      if (root.nodeType === 1) translateAttrs(root);
      var els = root.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
      for (var j = 0; j < els.length; j++) translateAttrs(els[j]);
    }
  }

  var observer = null;
  // Mutations are queued and drained during idle time with a time budget, rather
  // than processed synchronously inside the observer callback. On data-heavy pages
  // (e.g. the boss result page) React fires a torrent of mutations; processing them
  // inline froze the tab. Idle-time draining keeps the page responsive.
  var qAdded = new Set(), qChar = new Set(), qAttr = new Set(), qRemoved = [];
  var flushScheduled = false;
  var scheduleImpl = window.requestIdleCallback
    ? function (f) { window.requestIdleCallback(f, { timeout: 400 }); }
    : function (f) { setTimeout(function () { f({ timeRemaining: function () { return 8; } }); }, 50); };

  function scheduleFlush() { if (!flushScheduled) { flushScheduled = true; scheduleImpl(flush); } }

  function flush(deadline) {
    flushScheduled = false;
    // tooltip pinning must react to removals regardless of locale
    for (var r = 0; r < qRemoved.length; r++) onFloatingRemoved(qRemoved[r]);
    qRemoved.length = 0;
    var en = pathLocale() === 'en';
    if (!en) { qAdded.clear(); qChar.clear(); qAttr.clear(); return; }
    var start = Date.now();
    var hasTime = function () { return deadline && deadline.timeRemaining ? deadline.timeRemaining() > 3 : Date.now() - start < 25; };
    observer.disconnect(); // don't let our own writes re-trigger us
    try {
      var added = []; qAdded.forEach(function (n) { added.push(n); }); qAdded.clear();
      var ai = 0;
      for (; ai < added.length; ai++) { trackFloating(added[ai]); processTree(added[ai]); if (!hasTime()) { ai++; break; } }
      for (; ai < added.length; ai++) qAdded.add(added[ai]);
      if (hasTime()) {
        var chars = []; qChar.forEach(function (n) { chars.push(n); }); qChar.clear();
        var ci = 0;
        for (; ci < chars.length; ci++) { translateTextNode(chars[ci]); if (!hasTime()) { ci++; break; } }
        for (; ci < chars.length; ci++) qChar.add(chars[ci]);
      }
      if (hasTime()) {
        var attrs = []; qAttr.forEach(function (n) { attrs.push(n); }); qAttr.clear();
        var xi = 0;
        for (; xi < attrs.length; xi++) { if (attrs[xi].nodeType === 1) translateAttrs(attrs[xi]); if (!hasTime()) { xi++; break; } }
        for (; xi < attrs.length; xi++) qAttr.add(attrs[xi]);
      }
      fixLogo();
    } catch (e) {} finally {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    if (qAdded.size || qChar.size || qAttr.size) scheduleFlush();
  }

  function startDomLayer() {
    if (observer) return;
    // The observer is ALWAYS attached (even on /ko) so that switching language via
    // the SPA selector — no page reload — still translates dynamically-mounted
    // content. All translate entry points no-op unless the path is /en.
    processTree(document.body);
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var k = 0; k < m.removedNodes.length; k++) qRemoved.push(m.removedNodes[k]);
          for (var j = 0; j < m.addedNodes.length; j++) qAdded.add(m.addedNodes[j]);
        } else if (m.type === 'characterData') qChar.add(m.target);
        else if (m.type === 'attributes') qAttr.add(m.target);
      }
      scheduleFlush();
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

  /* ---------------- 4d. Cloud characters ------------------------------------------------ */
  // The Manual Input page gets a Character picker in place of the site's Load Preset /
  // Save Preset buttons (hidden, not removed — React owns them, and the picker's footer still
  // opens both windows). Every preset slot is a character: whatever you type into the form is
  // saved into the selected slot as you go, and a slot linked to an IGN can be uploaded to /
  // pulled from scouter.tomerh2001.com so the same character is available from any browser.
  // Uploads stay explicit (the sync icon, or the add flow) unless the opt-in auto-upload
  // toggle is on. Everything runs through the site's own zustand stores — `manual-store`
  // (the draft the form renders from) and `preset` (the slots) — captured passively while
  // webpack executes them (noteExports), so switching characters never needs a reload.
  //
  // Gotchas this code is shaped around (all observed on the live site):
  //  - loadDraft/seedDraft/resetDraft bump draftVersion, which REMOUNTS the whole panel and
  //    destroys our wrapper → ensureCharPicker() is idempotent and re-run after such changes.
  //  - preset slot keys are positional (deletePreset renumbers) → bindings are re-resolved by
  //    label (= the IGN) / savedAt on every store change, never trusted by key alone.
  //  - the DOM translation layer rewrites ASCII strings that collide with dictionary keys
  //    (several are IGNs) → every node we own carries data-msfix-ui and is skipped.
  //  - the cloud is public and unauthenticated (by design): anyone can read or overwrite an
  //    IGN, so the footer says so and nothing here is treated as private.

  var CLOUD_URL = 'https://scouter.tomerh2001.com';
  var LS_CLOUD_URL = 'msfix:cloud:url', LS_CLOUD_SLOTS = 'msfix:cloud:slots', LS_CLOUD_SELECTED = 'msfix:cloud:selected';
  var LS_CLOUD_ENABLED = 'msfix:cloud:enabled', LS_CLOUD_AUTO = 'msfix:cloud:auto';
  var IGN_RE = /^[A-Za-z0-9]{1,16}$/;
  var AUTOSAVE_MS = 500, AUTOUPLOAD_MS = 3000, POLL_MS = 30000, POLL_MAX_MS = 120000, LIST_CACHE_MS = 2000, FETCH_TIMEOUT_MS = 10000;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJson(k, fb) { var v = lsGet(k); if (v == null) return fb; try { var o = JSON.parse(v); return o == null ? fb : o; } catch (e) { return fb; } }
  function cloudUrl() { var u = lsGet(LS_CLOUD_URL); return (u && /^https?:\/\//.test(u) ? u : CLOUD_URL).replace(/\/+$/, ''); }
  // v1.5.1: cloud sync is always on and auto-upload always off (no toggles). The storage keys
  // stay reserved so values written by older builds are ignored rather than misread.
  function cloudEnabled() { return true; }
  function autoUploadOn() { return false; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function eqi(a, b) { return String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase(); }
  function nowIso() { return new Date().toISOString(); }

  /* -- route gate: the picker and the hide rules apply to /{locale}/input only ---------- */
  function isInputRoute() { return /^\/(ko|en|ja|ch)\/input(?:\/|$)/.test(location.pathname); }
  var ROW_SEL = 'div.flex.w-full.items-center.justify-between > div.flex.gap-2:has(> button[data-slot=dialog-trigger] > svg.lucide-file-down)';
  var IGN_SEL = 'div.flex.items-center.gap-2:has(> div.relative > input[data-slot=input] + button[data-slot=popover-trigger])';
  // React owns <html>/<body> (attributes we set there get reconciled away), so the hide rules
  // live in their own <style> that is simply enabled/disabled with the route.
  var ROUTE_CSS = ROW_SEL + '{display:none!important}\n' + IGN_SEL + '{display:none!important}';
  var CLOUD_CSS = [
    '.msfix-charpicker [hidden]{display:none!important}',
    '.msfix-charpicker .msfix-dd{top:100%}',
    '.msfix-charpicker .msfix-opt[aria-selected="true"]{box-shadow:inset 3px 0 0 var(--color-primary,#e5772f)}',
    '.msfix-charpicker .msfix-row-menu{opacity:.55}.msfix-charpicker .msfix-opt:hover .msfix-row-menu,.msfix-charpicker .msfix-opt.msfix-active .msfix-row-menu,.msfix-charpicker .msfix-row-menu:focus{opacity:1}',
    '@media (prefers-reduced-motion: reduce){.msfix-charpicker .animate-spin{animation:none}}'
  ].join('\n');
  var _hasSupport = null;
  function hasSelectorSupport() {
    if (_hasSupport === null) { try { _hasSupport = !!(window.CSS && CSS.supports && CSS.supports('selector(div:has(> a))')); } catch (e) { _hasSupport = false; } }
    return _hasSupport;
  }
  function routeStyle() {
    var st = document.getElementById('msfix-cloud-route');
    if (st) return st;
    if (!document.head) return null;
    st = document.createElement('style');
    st.id = 'msfix-cloud-route';
    st.textContent = ROUTE_CSS;
    document.head.appendChild(st);
    return st;
  }
  function applyRouteGate() {
    var on = isInputRoute();
    var st = routeStyle();
    if (st && st.disabled !== !on) st.disabled = !on;
    try { if (document.documentElement.getAttribute('data-msfix-route') !== (on ? 'input' : '')) document.documentElement.setAttribute('data-msfix-route', on ? 'input' : ''); } catch (e) {}
    if (hasSelectorSupport() || !document.body) return;
    // Browsers without :has() — hide/unhide by hand (the header search persists across SPA
    // navigations, so it must be shown again when leaving the page).
    var row = nativePresetRow();
    if (row) row.style.display = on ? 'none' : '';
    var btns = document.querySelectorAll('input[data-slot=input] + button[data-slot=popover-trigger]');
    for (var i = 0; i < btns.length; i++) {
      var block = btns[i].parentElement && btns[i].parentElement.parentElement;
      if (block) block.style.display = on ? 'none' : '';
    }
  }
  function injectCloudCss() {
    if (document.getElementById('msfix-cloud-style')) return;
    var st = document.createElement('style');
    st.id = 'msfix-cloud-style';
    st.textContent = CLOUD_CSS;
    (document.head || document.documentElement).appendChild(st);
    applyRouteGate();
  }
  // The native row: [Load Preset][Save Preset] — the Load button carries the file-down icon.
  function nativePresetRow() {
    var svg = document.querySelector('div.flex.w-full.items-center.justify-between > div.flex.gap-2 > button[data-slot=dialog-trigger] > svg.lucide-file-down');
    return svg ? svg.parentElement.parentElement : null;
  }
  function nativeTrigger(kind) {
    var row = nativePresetRow(); if (!row) return null;
    var svg = row.querySelector(kind === 'load' ? 'svg.lucide-file-down' : 'svg.lucide-download');
    return svg ? svg.parentElement : null;
  }

  /* -- site stores (passively captured in wrapFactory; lazy scan only after load) -------- */
  var _scanAt = 0;
  function scanSiteModules() {
    var req = wpRequire(); if (!req || !req.m) return;
    _scanAt = Date.now();
    for (var id in req.m) {
      if (siteRefs.presetStore && siteRefs.toast && siteRefs.manualStore) break;
      var ex; try { ex = req(id); } catch (e) { continue; }
      noteExports(ex);
    }
  }
  function cloudStores() {
    if (!siteRefs.manualStore || !siteRefs.presetStore) {
      // Force-requiring modules while chunks are still arriving has produced page errors;
      // only fall back to a scan once the page is fully loaded, and not more than every 5 s.
      if (document.readyState === 'complete' && Date.now() - _scanAt > 5000) scanSiteModules();
    }
    return (siteRefs.manualStore && siteRefs.presetStore) ? { ms: siteRefs.manualStore, ps: siteRefs.presetStore } : null;
  }
  function presetMap() { var s = cloudStores(); if (!s) return {}; try { return s.ps.getState().preset || {}; } catch (e) { return {}; } }
  function setPresetMap(map) { var s = cloudStores(); if (!s) return false; try { s.ps.getState().setPreset(map); return true; } catch (e) { toastErr('Could not write the preset'); return false; } }
  function currentDraft() { var s = cloudStores(); if (!s) return null; try { return s.ms.getState().draftStat; } catch (e) { return null; } }
  function slotKeys(map) { return Object.keys(map).sort(function (a, b) { return (+a) - (+b); }); }

  /* -- bindings: slotKey -> { ign, label, savedAt, cloudUpdatedAt, remoteUpdatedAt, syncedHash, syncedAt } */
  var cloud = {
    bindings: {}, selected: null,       // selected = { key, ign, label, savedAt }
    list: null, listAt: 0, listErr: false, listBusy: false,
    offline: false, busy: 0, subscribed: false, lastLoaded: null,
    saveTimer: null, uploadTimer: null, pollTimer: null, pollDelay: POLL_MS, pendingImport: null, conflictToastKey: null
  };
  function loadBindings() {
    var b = lsJson(LS_CLOUD_SLOTS, {}); cloud.bindings = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
    var s = lsJson(LS_CLOUD_SELECTED, null); cloud.selected = (s && typeof s === 'object' && s.key) ? s : null;
  }
  function saveBindings() {
    lsSet(LS_CLOUD_SLOTS, JSON.stringify(cloud.bindings));
    lsSet(LS_CLOUD_SELECTED, cloud.selected ? JSON.stringify(cloud.selected) : null);
  }
  function slotMatchesBinding(s, b) {
    if (!s) return false;
    if (eqi(s.label, b.ign)) return true;
    if (b.label && eqi(s.label, b.label)) return true;
    return !!(b.savedAt && s.savedAt === b.savedAt);
  }
  function slotMatchesSel(s, sel) {
    if (!s) return false;
    if (sel.label) return eqi(s.label, sel.label) || (sel.ign && eqi(s.label, sel.ign));
    return !!(sel.savedAt && s.savedAt === sel.savedAt);
  }
  // Slot keys are positional and the site renumbers them on delete, so bindings are matched
  // by content (label = IGN, or the savedAt we wrote) against the live map on every change.
  function reconcileBindings() {
    var map = presetMap(), keys = slotKeys(map), out = {}, used = {}, old = cloud.bindings;
    Object.keys(old).forEach(function (k) {
      var b = old[k]; if (!b || !b.ign) return;
      var hit = null;
      if (map[k] && !used[k] && slotMatchesBinding(map[k], b)) hit = k;
      for (var i = 0; i < keys.length && !hit; i++) if (!used[keys[i]] && slotMatchesBinding(map[keys[i]], b)) hit = keys[i];
      if (!hit) return;
      used[hit] = true; b.label = map[hit].label || ''; if (map[hit].savedAt) b.savedAt = map[hit].savedAt; out[hit] = b;
    });
    cloud.bindings = out;
    if (cloud.selected) {
      var sel = cloud.selected, key = null;
      if (map[sel.key] && slotMatchesSel(map[sel.key], sel)) key = sel.key;
      for (var j = 0; j < keys.length && !key; j++) if (slotMatchesSel(map[keys[j]], sel)) key = keys[j];
      if (!key) cloud.selected = null;
      else { sel.key = key; sel.label = map[key].label || ''; if (map[key].savedAt) sel.savedAt = map[key].savedAt; sel.ign = out[key] ? out[key].ign : null; }
    }
    saveBindings();
  }
  function selectedKey() { return cloud.selected ? cloud.selected.key : null; }
  function bindingByIgn(ign) { for (var k in cloud.bindings) if (cloud.bindings[k] && eqi(cloud.bindings[k].ign, ign)) return { key: k, binding: cloud.bindings[k] }; return null; }
  function ignForSlot(slotKey) { var b = cloud.bindings[slotKey]; return b && b.ign ? b.ign : null; }

  /* -- hashing (canonical JSON, sorted keys) to tell "edited since last upload" ---------- */
  function canon(v) {
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(canon(v[i])); return '[' + a.join(',') + ']'; }
    if (v && typeof v === 'object') { var ks = Object.keys(v).sort(), o = []; for (var j = 0; j < ks.length; j++) o.push(JSON.stringify(ks[j]) + ':' + canon(v[ks[j]])); return '{' + o.join(',') + '}'; }
    return JSON.stringify(v === undefined ? null : v);
  }
  function hashData(d) {
    var s = canon(d || null), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8) + ':' + s.length;
  }

  /* -- display helpers ------------------------------------------------------------------- */
  function classEn(ko) { var d = data(); return (siteRefs.enBundle && siteRefs.enBundle[ko]) || d.i18nPatch[ko] || d.dict[ko] || ko || ''; }
  var LS_CLOUD_HEXA = 'msfix:cloud:hexa';
  // "HEXA" = the site's HEXA-converted main stat under Boss 300 (calculatedData.boss300_hexaStat,
  // the figure the result page labels HEXA). The site only computes it when Result is pressed, so
  // remember it per input-hash and show it for any preset — local or cloud — whose inputs match.
  var hexaCache = null;
  function hexaMap() { if (!hexaCache) hexaCache = lsJson(LS_CLOUD_HEXA, {}); return hexaCache; }
  // The site's result.userStat is the submitted inputs plus derived fields (hexa.hexaSkill*,
  // hexa.character_class, hexa.hexaStat_opened) with `power` zeroed, so hash a projection that
  // drops exactly those and the same inputs — draft, slot or cloud copy — map to the same key.
  var HEXA_CORE_RE = /^(?:skillCore|masteryCore|reinCore|generalCore)\d+$|^hexaStat$/;
  function hexaKey(d) {
    var c = {};
    for (var k in d) { if (k === 'power') continue; if (k === 'hexa') { var hx = {}; for (var j in d.hexa || {}) if (HEXA_CORE_RE.test(j)) hx[j] = d.hexa[j]; c.hexa = hx; } else c[k] = d[k]; }
    return hashData(c);
  }
  function noteResult(res) {
    var cd = res && res.calculatedData, us = res && res.userStat;
    if (!cd || !us) return;
    var v = Number(cd.boss300_hexaStat);
    if (!isFinite(v) || v <= 0) return;
    var h = hexaKey(us), m = hexaMap();
    if (m[h] && m[h].v === Math.round(v)) return;
    m[h] = { v: Math.round(v), at: nowIso() };
    var ks = Object.keys(m);
    if (ks.length > 80) { ks.sort(function (a, b) { return m[a].at < m[b].at ? -1 : 1; }); while (ks.length > 80) delete m[ks.shift()]; }
    lsSet(LS_CLOUD_HEXA, JSON.stringify(m));
    if (picker.open) renderDropdown();
  }
  function hexaForData(d) { if (!d) return null; var e = hexaMap()[hexaKey(d)]; return e ? e.v : null; }
  function fmtNum(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtK(n) { n = Math.round(n); return n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }
  function slotMeta(sd) {
    var st = (sd && sd.stat) || {}; var lv = Number(st.level);
    return { classKo: st.myClass || '', classEn: classEn(st.myClass || ''), level: isFinite(lv) && lv > 0 ? lv : 0, hexa: hexaForData(sd) };
  }
  function docMeta(doc) {
    var m = doc && doc.meta; var p = doc && doc.preset && doc.preset.data;
    var r;
    if (p && p.stat) r = slotMeta(p);
    else { var lv = m ? Number(m.level) : 0; r = { classKo: (m && m.class) || '', classEn: classEn((m && m.class) || ''), level: isFinite(lv) && lv > 0 ? lv : 0, hexa: null }; }
    var hc = m ? Number(m.hexaConverted) : NaN;
    if (r.hexa == null && isFinite(hc) && hc > 0) r.hexa = Math.round(hc);
    return r;
  }
  function metaLine(m) { if (!m.classKo && !m.level) return 'empty preset'; return (m.classEn || '?') + ' Lv ' + m.level + ', ' + (m.hexa ? fmtK(m.hexa) + ' HEXA' : 'HEXA n/a'); }
  function relTime(iso) {
    if (!iso) return 'never';
    var t = new Date(iso).getTime(); if (isNaN(t)) return '';
    var d = Math.max(0, Date.now() - t), m = Math.round(d / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 48) return h + ' h ago';
    var days = Math.round(h / 24); if (days < 30) return days + ' d ago';
    return new Date(iso).toLocaleDateString();
  }
  function dayDate(iso) { if (!iso) return ''; var t = new Date(iso); return isNaN(t.getTime()) ? '' : t.toLocaleDateString(); }
  function slotName(key, slot) {
    var b = cloud.bindings[key];
    if (b && b.ign) return b.ign + (slot && slot.label && !eqi(slot.label, b.ign) ? ' (' + slot.label + ')' : '');
    return (slot && slot.label) || (slot && presetDataOk(slot.data) ? autoPresetLabel(slot.data) : '') || ('Preset ' + key);
  }
  function svgIcon(name, extra) {
    var P = {
      'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
      'cloud-off': '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
      'cloud-check': '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742"/>',
      'cloud-alert': '<path d="M12 12v4"/><path d="M12 20h.01"/><path d="M17 18h.5a1 1 0 0 0 0-9h-1.79A7 7 0 1 0 5 17.5"/>',
      'cloud-upload': '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
      'cloud-download': '<path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/>',
      'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
      'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
      'check': '<path d="M20 6 9 17l-5-5"/>',
      'ellipsis': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
      'file-up': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
      'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
      'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
      'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
      'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
      'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
      'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'
    };
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-' + name + ' size-4' + (extra ? ' ' + extra : '') + '">' + (P[name] || '') + '</svg>';
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* -- network (all failures are soft: the icon goes "offline", nothing else breaks) ----- */
  function setOffline(flag) {
    if (cloud.offline === flag) return;
    cloud.offline = flag;
    if (flag) toastErr('Cloud unavailable. Working offline.');
    updateIcon(); renderDropdown();
  }
  function cloudFetch(method, path, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!cloudEnabled()) { reject({ disabled: true }); return; }
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT_MS);
      var headers = {}; if (opts.body) headers['Content-Type'] = 'application/json';
      if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
      var init = { method: method, headers: headers, mode: 'cors', cache: 'no-store' };
      if (opts.body) init.body = JSON.stringify(opts.body);
      if (ctrl) init.signal = ctrl.signal;
      var done = function (res, json) {
        setOffline(false);
        var etag = (res.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
        resolve({ status: res.status, ok: res.ok, json: json, etag: etag });
      };
      fetch(cloudUrl() + path, init).then(function (res) {
        clearTimeout(timer);
        if (method === 'HEAD' || res.status === 204) { done(res, null); return; }
        res.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} done(res, j); }, function () { done(res, null); });
      }, function (err) { clearTimeout(timer); setOffline(true); reject({ offline: true, error: err }); });
    });
  }
  function busy(delta) { cloud.busy = Math.max(0, cloud.busy + delta); updateIcon(); }
  function cloudPath(ign) { return '/v1/characters/' + encodeURIComponent(String(ign)); } // the server lowercases the key

  // The public list is everyone's characters; it is only fetched when the dropdown opens
  // (never per keystroke) and is shown in full only once you have typed two characters.
  function refreshCloudList(force, cb) {
    if (!cloudEnabled()) { cloud.list = null; if (cb) cb(); return; }
    if (!force && cloud.list && Date.now() - cloud.listAt < LIST_CACHE_MS) { if (cb) cb(); return; }
    if (cloud.listBusy) { if (cb) cb(); return; }
    cloud.listBusy = true; renderDropdown();
    cloudFetch('GET', '/v1/characters').then(function (r) {
      cloud.listBusy = false;
      if (r.ok && r.json && Array.isArray(r.json.characters)) {
        cloud.list = r.json.characters.filter(function (c) { return c && IGN_RE.test(c.ign || ''); });
        cloud.listAt = Date.now(); cloud.listErr = false;
        for (var k in cloud.bindings) {
          var b = cloud.bindings[k]; if (!b || !b.ign) continue;
          for (var i = 0; i < cloud.list.length; i++) if (eqi(cloud.list[i].ign, b.ign)) { b.remoteUpdatedAt = cloud.list[i].updatedAt || b.remoteUpdatedAt; break; }
        }
        saveBindings();
      } else cloud.listErr = true;
      renderDropdown(); updateIcon(); if (cb) cb();
    }, function () { cloud.listBusy = false; cloud.listErr = true; renderDropdown(); updateIcon(); if (cb) cb(); });
  }
  function checkRemote(key, cb) {
    var b = cloud.bindings[key];
    if (!b || !b.ign || !cloudEnabled()) { if (cb) cb(null); return; }
    cloudFetch('HEAD', cloudPath(b.ign)).then(function (r) {
      if (r.status === 404) { b.remoteUpdatedAt = null; b.cloudUpdatedAt = null; }
      else if (r.ok && r.etag) b.remoteUpdatedAt = r.etag;
      saveBindings(); updateIcon(); if (cb) cb(r);
    }, function () { updateIcon(); if (cb) cb(null); });
  }
  function fetchDoc(ign, cb) {
    busy(1);
    cloudFetch('GET', cloudPath(ign)).then(function (r) {
      busy(-1);
      if (r.status === 404) { cb(null, null); return; }
      if (!r.ok || !r.json) { cb({ status: r.status, json: r.json }, null); return; }
      cb(null, r.json);
    }, function (e) { busy(-1); cb(e, null); });
  }
  function docPresetData(doc) {
    var d = doc && doc.preset && doc.preset.data;
    if (!d || !d.stat) return null;
    var tmpl = currentUserStatTemplate() || siteRefs.defaultUserStat;
    return tmpl ? conformTo(tmpl, d) : d;
  }

  /* -- polling: HEAD the selected character every 30 s (backing off) and on focus -------- */
  function stopPolling() { if (cloud.pollTimer) { clearTimeout(cloud.pollTimer); cloud.pollTimer = null; } }
  function startPolling() { if (cloud.pollTimer) return; cloud.pollTimer = setTimeout(pollTick, cloud.pollDelay); }
  function pollTick(immediate) {
    stopPolling();
    var key = selectedKey();
    if (!isInputRoute() || !cloudEnabled() || !key || !cloud.bindings[key] || !cloud.bindings[key].ign) { cloud.pollDelay = POLL_MS; return; }
    if (document.hidden && !immediate) { cloud.pollTimer = setTimeout(pollTick, cloud.pollDelay); return; }
    checkRemote(key, function (r) {
      cloud.pollDelay = r ? POLL_MS : Math.min(POLL_MAX_MS, cloud.pollDelay * 2);
      cloud.pollTimer = setTimeout(pollTick, cloud.pollDelay);
    });
  }

  /* -- sync state ------------------------------------------------------------------------ */
  function syncInfo() {
    var key = selectedKey();
    if (!key) return { state: 'none' };
    var b = cloud.bindings[key];
    if (!b || !b.ign) return { state: 'unlinked', key: key };
    if (!cloudEnabled()) return { state: 'off', key: key, b: b };
    var d = currentDraft(), h = d ? hashData(d) : null;
    var localChanged = !b.syncedHash || (!!h && h !== b.syncedHash);
    if (!b.cloudUpdatedAt) return { state: 'not-uploaded', key: key, b: b };
    if (cloud.offline) return { state: 'offline', key: key, b: b };
    var cloudChanged = !!(b.remoteUpdatedAt && b.remoteUpdatedAt !== b.cloudUpdatedAt);
    if (!localChanged && !cloudChanged) return { state: 'synced', key: key, b: b };
    if (localChanged && !cloudChanged) return { state: 'local-ahead', key: key, b: b };
    if (!localChanged && cloudChanged) return { state: 'cloud-ahead', key: key, b: b };
    return { state: 'conflict', key: key, b: b };
  }
  var ICON_STATES = {
    'none':         { icon: 'cloud',          color: 'text-text-gray-low', title: 'No character selected. Your inputs are not being saved. Pick one from the list.' },
    'unlinked':     { icon: 'cloud-off',      color: 'text-text-gray-low', title: 'Saved locally, not linked to an IGN. Click to link and upload.' },
    'off':          { icon: 'cloud-off',      color: 'text-text-gray-low', title: 'Cloud sync is off.' },
    'not-uploaded': { icon: 'cloud-upload',   color: 'text-text-gray-low', title: 'Not in the cloud yet. Click to upload.' },
    'offline':      { icon: 'cloud-off',      color: 'text-red-500',       title: 'Cloud unavailable. Click to retry.' },
    'synced':       { icon: 'cloud-check',    color: 'text-green-600',     title: 'Synced with the cloud.' },
    'local-ahead':  { icon: 'cloud-alert',    color: 'text-amber-500',     title: 'Edited since the last upload. Click to upload.' },
    'cloud-ahead':  { icon: 'cloud-download', color: 'text-amber-500',     title: 'The cloud copy is newer. Click to compare.' },
    'conflict':     { icon: 'cloud-alert',    color: 'text-amber-500',     title: 'Changed here and in the cloud. Click to compare.' }
  };
  /* -- site-styled hover tooltip for the sync icon (the native title is slow and unstyled) -- */
  var TIP_CLS = 'bg-popover text-popover-foreground z-[2147483647] w-fit rounded-md px-3 py-1.5 text-xs text-balance shadow-md msfix-tip';
  var TIP_ARROW_CLS = 'bg-popover fill-popover z-[2147483647] size-2.5 rotate-45 msfix-tip-arrow';
  function attachTooltip(btn) {
    if (btn.__msfixTip) return;
    var tip = null, arrow = null;
    function text() { return btn.getAttribute('data-msfix-tip') || btn.getAttribute('aria-label') || ''; }
    function place() {
      if (!tip) return;
      var r = btn.getBoundingClientRect();
      tip.style.left = '0px'; tip.style.top = '0px';
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      var top = r.bottom + 8, above = false;
      if (top + h > window.innerHeight - 8) { top = r.top - h - 8; above = true; }
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      arrow.style.left = (r.left + r.width / 2 - 5) + 'px';
      arrow.style.top = (above ? top + h - 5 : top - 5) + 'px';
    }
    function show() {
      var t = text(); if (!t) return;
      if (!tip) {
        tip = el('div', TIP_CLS); tip.setAttribute('role', 'tooltip'); tip.setAttribute('data-msfix-ui', '');
        tip.id = 'msfix-tip-' + Math.random().toString(36).slice(2, 8);
        tip.style.cssText = 'position:fixed;max-width:280px;pointer-events:none;white-space:normal';
        arrow = el('div', TIP_ARROW_CLS); arrow.setAttribute('data-msfix-ui', '');
        arrow.style.cssText = 'position:fixed;pointer-events:none';
        document.body.appendChild(tip); document.body.appendChild(arrow);
        btn.setAttribute('aria-describedby', tip.id);
      }
      tip.textContent = t; place();
    }
    function hide() { if (tip) { tip.remove(); arrow.remove(); tip = arrow = null; btn.removeAttribute('aria-describedby'); } }
    btn.addEventListener('mouseenter', show); btn.addEventListener('focus', show);
    btn.addEventListener('mouseleave', hide); btn.addEventListener('blur', hide); btn.addEventListener('click', hide);
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    btn.__msfixTip = { refresh: function () { if (tip) show(); }, hide: hide };
  }
  function updateIcon() {
    if (!picker.icon) return;
    var info = syncInfo(), st = ICON_STATES[info.state] || ICON_STATES.none;
    var b = info.b, title = st.title;
    if (b && b.ign) title = title + (info.state === 'synced' && b.syncedAt ? ' Uploaded ' + relTime(b.syncedAt) + '.' : '');
    var busyNow = cloud.busy > 0;
    picker.icon.className = SOFT_BASE + ' msfix-sync ' + (busyNow ? 'text-text-gray-low' : st.color);
    picker.icon.innerHTML = busyNow ? svgIcon('loader', 'animate-spin') : svgIcon(st.icon);
    var tipText = busyNow ? 'Working...' : title;
    picker.icon.setAttribute('data-msfix-tip', tipText); picker.icon.removeAttribute('title');
    picker.icon.setAttribute('aria-label', tipText);
    if (picker.icon.__msfixTip) picker.icon.__msfixTip.refresh();
    picker.icon.setAttribute('data-msfix-sync', busyNow ? 'busy' : info.state);
    if (picker.live && picker.live.textContent !== title) picker.live.textContent = title;
  }

  /* -- selection / loading --------------------------------------------------------------- */
  function loadIntoForm(key) {
    var s = cloudStores(), slot = presetMap()[key];
    if (!s || !slot || !slot.data) return false;
    var d = clone(slot.data);
    cloud.lastLoaded = d;
    try { s.ms.getState().loadDraft(d); } catch (e) { toastErr('Could not load the character'); return false; }
    return true;
  }
  function setSelected(key, load, quiet) {
    var map = presetMap(), slot = map[key];
    if (!slot) return false;
    var b = cloud.bindings[key];
    cloud.selected = { key: key, ign: b ? b.ign : null, label: slot.label || '', savedAt: slot.savedAt || null };
    saveBindings();
    if (load && !loadIntoForm(key)) return false;
    renderTrigger(); updateIcon();
    if (!quiet) toastOk((load ? 'Loaded ' : 'Selected ') + slotName(key, slot));
    if (b && b.ign) { cloud.pollDelay = POLL_MS; checkRemote(key); startPolling(); }
    return true;
  }
  function deselect(reason) {
    if (!cloud.selected) return;
    cloud.selected = null; saveBindings();
    renderTrigger(); updateIcon();
    if (reason) toastOk(reason);
  }
  // After a structural draft change we did not cause (native Load, Reset, a seeded search
  // result, Undo) find out which slot — if any — the form now shows.
  function resolveSelectionFromDraft(draft, strict) {
    if (!draft) return;
    var h = hashData(draft), map = presetMap(), keys = slotKeys(map), cur = selectedKey();
    if (cur && map[cur] && hashData(map[cur].data) === h) return;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === cur || !map[keys[i]] || !presetDataOk(map[keys[i]].data)) continue;
      if (hashData(map[keys[i]].data) === h) { setSelected(keys[i], false, true); return; }
    }
    if (strict && cur) deselect('Inputs no longer match ' + slotName(cur, map[cur]) + '. Pick a character to resume saving.');
  }

  /* -- auto-save: the draft goes into the selected slot 500 ms after the last change ------ */
  function writeDraftToSlot(key, draft) {
    var map = clone(presetMap()), slot = map[key];
    if (!slot) return false;
    var now = nowIso();
    map[key] = { data: clone(draft), label: slot.label || '', savedAt: now };
    if (!setPresetMap(map)) return false;
    var b = cloud.bindings[key]; if (b) { b.savedAt = now; b.label = map[key].label; }
    if (cloud.selected && cloud.selected.key === key) { cloud.selected.savedAt = now; cloud.selected.label = map[key].label; }
    saveBindings();
    return true;
  }
  function flushAutosave() {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    autosaveTick(true);
  }
  function autosaveTick(noUpload) {
    cloud.saveTimer = null;
    var key = selectedKey(); if (!key) return;
    var d = currentDraft(); if (!d || !presetDataOk(d)) return;
    var slot = presetMap()[key]; if (!slot) return;
    if (hashData(slot.data) === hashData(d)) return;
    if (!writeDraftToSlot(key, d)) return;
    pushHistory(key, 'edit', d);
    updateIcon(); if (picker.open) renderDropdown();
    var b = cloud.bindings[key];
    if (!noUpload && autoUploadOn() && cloudEnabled() && b && b.ign) scheduleAutoUpload(key);
  }
  function scheduleAutoUpload(key) {
    if (cloud.uploadTimer) clearTimeout(cloud.uploadTimer);
    cloud.uploadTimer = setTimeout(function () {
      cloud.uploadTimer = null;
      var info = syncInfo();
      if (info.key !== key || (info.state !== 'local-ahead' && info.state !== 'not-uploaded')) return;
      uploadSlot(key, { quiet: true, onConflict: function () {
        // never pop a modal mid-edit: the icon shows the conflict, one toast per character
        if (cloud.conflictToastKey !== key) { cloud.conflictToastKey = key; toastErr(cloud.bindings[key].ign + ' changed in the cloud. Click the sync icon to compare.'); }
      } });
    }, AUTOUPLOAD_MS);
  }
  function onDraftChange(s, prev) {
    if (s && prev && s.result !== prev.result) noteResult(s.result);
    if (!s || !prev || s.draftStat === prev.draftStat) return;
    var structural = s.draftVersion !== prev.draftVersion;
    if (structural) { setTimeout(ensureCharPicker, 0); setTimeout(ensureCharPicker, 250); setTimeout(ensureCharPicker, 900); }
    if (s.draftStat === cloud.lastLoaded) { updateIcon(); return; }   // our own load echoing back
    if (structural) { resolveSelectionFromDraft(s.draftStat, true); updateIcon(); return; }
    if (cloud.saveTimer) clearTimeout(cloud.saveTimer);
    cloud.saveTimer = setTimeout(autosaveTick, AUTOSAVE_MS);
    updateIcon();
  }
  function onPresetChange() {
    reconcileBindings(); checkPendingImport();
    renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
  }
  function ensureSubscriptions() {
    if (cloud.subscribed) return true;
    var s = cloudStores(); if (!s) return false;
    cloud.subscribed = true;
    reconcileBindings();
    resolveSelectionFromDraft(currentDraft(), false);
    try { noteResult(s.ms.getState().result); } catch (e) {}
    try { s.ms.subscribe(onDraftChange); } catch (e) {}
    try { s.ps.subscribe(onPresetChange); } catch (e) {}
    return true;
  }
  // A native import of a file that carries "ign" (our export enrichment) is bound once the
  // site has added its slot.
  function checkPendingImport() {
    var p = cloud.pendingImport; if (!p) return;
    if (Date.now() - p.at > 15000) { cloud.pendingImport = null; return; }
    if (bindingByIgn(p.ign)) { cloud.pendingImport = null; return; }
    var map = presetMap(), keys = slotKeys(map);
    for (var i = keys.length - 1; i >= 0; i--) {
      var s = map[keys[i]];
      if (cloud.bindings[keys[i]] || !s || !presetDataOk(s.data)) continue;
      if (eqi(s.label, p.label) || eqi(s.label, p.ign)) { bindSlot(keys[i], p.ign, null); cloud.pendingImport = null; return; }
    }
  }
  function bindSlot(key, ign, doc) {
    var slot = presetMap()[key]; if (!slot) return;
    var prev = cloud.bindings[key] || {};
    if (prev.ign && eqi(prev.ign, ign)) ign = prev.ign;   // keep the case the user typed
    cloud.bindings[key] = {
      ign: ign, label: slot.label || '', savedAt: slot.savedAt || null,
      cloudUpdatedAt: doc ? doc.updatedAt : (prev.ign && eqi(prev.ign, ign) ? prev.cloudUpdatedAt : null),
      remoteUpdatedAt: doc ? doc.updatedAt : null,
      syncedHash: doc ? hashData(slot.data) : (prev.ign && eqi(prev.ign, ign) ? prev.syncedHash : null),
      syncedAt: doc ? nowIso() : null
    };
    if (cloud.selected && cloud.selected.key === key) cloud.selected.ign = ign;
    saveBindings();
  }

  /* -- slot writes ----------------------------------------------------------------------- */
  function allocSlotKey(map) {
    var keys = slotKeys(map);
    for (var i = 0; i < keys.length; i++) {   // reuse an untouched slot before appending
      var s = map[keys[i]];
      if (s && !presetDataOk(s.data) && !(s.label || '').trim() && !cloud.bindings[keys[i]]) return keys[i];
    }
    var max = 0; keys.forEach(function (k) { if (+k > max) max = +k; });
    return String(max + 1);
  }
  // Write `data` under `label` into `key` (or a fresh slot) and return the key.
  function writeSlot(key, data, label) {
    var map = clone(presetMap());
    if (!key) key = allocSlotKey(map);
    map[key] = { data: clone(data), label: label || '', savedAt: nowIso() };
    return setPresetMap(map) ? key : null;
  }
  // Pull the cloud document into a slot (writing it, re-binding, and reloading the form if
  // that slot is the selected one).
  function applyCloudDoc(key, doc) {
    var dataIn = docPresetData(doc);
    if (!dataIn || !presetDataOk(dataIn)) { toastErr('The cloud copy of ' + doc.ign + ' is not a valid preset'); return null; }
    var cur = presetMap()[key];
    if (cur && presetDataOk(cur.data)) pushHistory(key, 'keep', cur.data);
    key = writeSlot(key, dataIn, (cur && cur.label) || doc.ign);
    if (!key) return null;
    bindSlot(key, doc.ign || cloud.bindings[key].ign, doc);
    pushHistory(key, 'pull', dataIn);
    if (selectedKey() === key) { loadIntoForm(key); renderTrigger(); updateIcon(); }
    return key;
  }
  function uploadSlot(key, opts, cb) {
    opts = opts || {};
    if (key === selectedKey()) flushAutosave();
    var slot = presetMap()[key], b = cloud.bindings[key];
    if (!slot || !b || !b.ign) { if (cb) cb(false); return; }
    if (!presetDataOk(slot.data)) { toastErr('Enter a class and level before uploading'); if (cb) cb(false); return; }
    var m = slotMeta(slot.data);
    var body = {
      preset: { type: 'maplescouter-manual-preset', v: 1, savedAt: slot.savedAt || nowIso(), label: slot.label || b.ign, data: slot.data },
      label: slot.label || b.ign,
      meta: { 'class': m.classKo, level: m.level, hexaStat: (slot.data.hexa && Number(slot.data.hexa.hexaStat)) || 0, hexaConverted: m.hexa || null }
    };
    var headers = {};
    if (b.cloudUpdatedAt && opts.ifMatch !== false) headers['If-Match'] = '"' + b.cloudUpdatedAt + '"';
    busy(1);
    cloudFetch('PUT', cloudPath(b.ign), { body: body, headers: headers }).then(function (r) {
      busy(-1);
      if (r.ok) {
        var up = (r.json && r.json.updatedAt) || r.etag || nowIso();
        b.cloudUpdatedAt = up; b.remoteUpdatedAt = up; b.syncedHash = hashData(slot.data); b.syncedAt = nowIso();
        pushHistory(key, 'upload', slot.data);
        cloud.conflictToastKey = null; cloud.listAt = 0; saveBindings(); updateIcon();
        if (!opts.quiet) toastOk('Uploaded to the cloud');
        if (cb) cb(true);
      } else if (r.status === 409) {
        var remote = r.json ? r.json.updatedAt : undefined;
        if (remote === null) { b.cloudUpdatedAt = null; b.remoteUpdatedAt = null; } else if (remote) b.remoteUpdatedAt = remote;
        saveBindings(); updateIcon();
        if (opts.onConflict) opts.onConflict(); else toastErr(b.ign + ' changed in the cloud. Click the sync icon to compare.');
        if (cb) cb(false);
      } else {
        toastErr(r.status === 429 ? 'The cloud is rate limiting uploads. Try again in a minute.'
          : 'Cloud upload failed (' + r.status + (r.json && r.json.error ? ' ' + r.json.error : '') + ')');
        if (cb) cb(false);
      }
    }, function (e) { busy(-1); if (!e.disabled) toastErr('Cloud unavailable. Upload skipped.'); updateIcon(); if (cb) cb(false); });
  }

  /* -- dialogs --------------------------------------------------------------------------- */
  function confirmDialog(title, subtitle, goLabel, onGo, extraBuild) {
    msDialog({ title: title, subtitle: subtitle, build: function (body, close) {
      if (extraBuild) extraBuild(body);
      msActions(body, 'Cancel', function () { close(); }, goLabel, function () { close(); onGo(); });
    } });
  }
  function leafDiff(a, b, path, out) {
    if (out.length > 300) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var keys = {}; Object.keys(a).forEach(function (k) { keys[k] = 1; }); Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).sort().forEach(function (k) { leafDiff(a[k], b[k], path ? path + '.' + k : k, out); });
      return;
    }
    if (a !== b && !(a == null && b == null)) out.push({ path: path, a: a, b: b });
  }
  function fmtVal(v) {
    if (v === '' || v == null) return 'empty';
    if (typeof v === 'string' && HANGUL.test(v)) v = classEn(v);
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 22 ? s.slice(0, 21) + '...' : s;
  }
  function infoCard(body, heading, lines) {
    var card = el('div', 'outline outline-outline-gray-med rounded-lg px-3 py-2 flex flex-col gap-0.5 text-left');
    card.appendChild(el('span', 'text-sm font-semibold truncate', heading));
    lines.forEach(function (l) { if (l) card.appendChild(el('span', 'text-text-gray-low text-xs truncate', l)); });
    body.appendChild(card);
    return card;
  }
  // Both sides of a local/cloud disagreement with what actually differs, then a choice.
  function compareDialog(o) {
    closePicker();
    var lm = slotMeta(o.localData), cm = docMeta(o.doc), cloudData = docPresetData(o.doc);
    var diffs = []; if (cloudData) leafDiff(o.localData, cloudData, '', diffs);
    msDialog({
      title: o.title || (o.ign + ' already exists in the cloud'),
      subtitle: o.subtitle || '',
      build: function (body, close) {
        infoCard(body, 'Your inputs', [metaLine(lm),
          'Edited ' + relTime(o.localSavedAt) + ', uploaded ' + relTime(o.localSyncedAt)]);
        infoCard(body, 'Cloud copy', [metaLine(cm),
          'Updated ' + relTime(o.doc.updatedAt) + (o.doc.updatedAt ? ' (' + shortDate(o.doc.updatedAt) + ')' : '')]);
        if (diffs.length) {
          var box = el('div', 'flex flex-col gap-0.5 text-left');
          box.appendChild(el('span', 'text-xs font-semibold', diffs.length + ' field' + (diffs.length === 1 ? '' : 's') + ' differ' + (diffs.length === 1 ? 's' : '') + ' (yours to cloud)'));
          diffs.slice(0, 8).forEach(function (d) { box.appendChild(el('span', 'text-text-gray-low text-xs truncate', d.path + ': ' + fmtVal(d.a) + ' to ' + fmtVal(d.b))); });
          if (diffs.length > 8) box.appendChild(el('span', 'text-text-gray-low text-xs', 'and ' + (diffs.length - 8) + ' more'));
          body.appendChild(box);
        } else if (cloudData) body.appendChild(el('span', CLS.hint, 'Same inputs on both sides.'));
        var list = el('div', CLS.list);
        list.appendChild(msRow('Upload my inputs', 'Replaces the cloud copy', function () { close(); o.onOverwriteCloud(); }));
        list.appendChild(msRow('Use cloud copy', 'Loads it into the form', function () { close(); o.onReplaceLocal(); }));
        if (o.onSaveAsNew) list.appendChild(msRow('Keep both', 'Saves the cloud copy as a new preset', function () { close(); o.onSaveAsNew(); }));
        body.appendChild(list);
        var cancel = el('button', CLS.ghost, 'Cancel'); cancel.type = 'button';
        cancel.addEventListener('click', function () { close(); });
        body.appendChild(cancel);
      }
    });
  }
  // The sync icon's click: one action per state.
  function onSyncClick() {
    closePicker();
    var info = syncInfo(), key = info.key, b = info.b, map = presetMap();
    switch (info.state) {
      case 'none': openPicker(); return;
      case 'off': openPicker(); toastOk('Cloud sync is off.'); return;
      case 'unlinked': openAddDialog(map[key] && IGN_RE.test(map[key].label || '') ? map[key].label : '', { linkKey: key }); return;
      case 'offline': cloud.pollDelay = POLL_MS; checkRemote(key, function (r) { if (r) toastOk('Cloud is back'); else toastErr('Still offline'); }); return;
      case 'synced': checkRemote(key, function (r) { if (r && syncInfo().state === 'synced') toastOk(b.ign + ' is up to date'); }); return;
      case 'not-uploaded':
        confirmDialog('Upload to the cloud?', '', 'Upload', function () { uploadSlot(key, { ifMatch: false }); });
        return;
      case 'local-ahead':
        msDialog({ title: 'Upload changes to the cloud?', subtitle: '', build: function (body, close) {
          var row = el('div', 'flex w-full gap-2');
          var mk = function (label, cls, fn) { var x = el('button', cls, label); x.type = 'button'; x.addEventListener('click', function () { close(); if (fn) fn(); }); row.appendChild(x); return x; };
          mk('Cancel', CLS.ghost, null);
          mk('Discard', CLS.ghost + ' text-red-500', function () { discardToCloud(key); });
          mk('Upload', CLS.primary, function () { uploadSlot(key, { onConflict: function () { openCompareForSlot(key); } }); });
          body.appendChild(row);
        } });
        return;
      default: openCompareForSlot(key); return;
    }
  }
  // Throw away local edits: the cloud copy replaces the slot and the form.
  function discardToCloud(key) {
    var b = cloud.bindings[key]; if (!b || !b.ign) return;
    flushAutosave();
    fetchDoc(b.ign, function (err, doc) {
      if (err) { toastErr(err.offline ? 'Cloud unavailable' : 'Could not read ' + b.ign + ' from the cloud'); return; }
      if (!doc) { b.cloudUpdatedAt = null; b.remoteUpdatedAt = null; saveBindings(); updateIcon(); toastErr(b.ign + ' is no longer in the cloud. Nothing to restore.'); return; }
      if (applyCloudDoc(key, doc)) toastOk('Restored from the cloud');
    });
  }
  function openCompareForSlot(key) {
    var b = cloud.bindings[key], slot = presetMap()[key];
    if (!b || !slot) return;
    flushAutosave();
    fetchDoc(b.ign, function (err, doc) {
      if (err) { toastErr(err.offline ? 'Cloud unavailable' : 'Could not read ' + b.ign + ' from the cloud'); return; }
      if (!doc) { b.cloudUpdatedAt = null; b.remoteUpdatedAt = null; saveBindings(); updateIcon(); toastErr(b.ign + ' is no longer in the cloud. Click the icon to upload it again.'); return; }
      slot = presetMap()[key];
      compareDialog({
        ign: b.ign, doc: doc, localData: slot.data, localLabel: slotName(key, slot), localSavedAt: slot.savedAt, localSyncedAt: b.syncedAt,
        title: b.ign + ' differs from the cloud',
        onOverwriteCloud: function () { b.cloudUpdatedAt = doc.updatedAt; saveBindings(); uploadSlot(key, { onConflict: function () { openCompareForSlot(key); } }); },
        onReplaceLocal: function () { if (applyCloudDoc(key, doc)) toastOk('Loaded the cloud copy'); },
        onSaveAsNew: function () {
          var d = docPresetData(doc); if (!d) return;
          var nk = writeSlot(null, d, doc.ign + ' (cloud)');
          if (nk) { toastOk('Saved the cloud copy as Preset ' + nk); }
        }
      });
    });
  }
  // "+ Add character": IGN → look it up → save current inputs (and upload) or compare.
  function openAddDialog(prefill, opts) {
    opts = opts || {};
    closePicker();
    var map = presetMap(), sel = selectedKey();
    // With an unlinked preset selected, adding links THAT preset (the form shows its inputs)
    // instead of duplicating it into a new slot.
    var linkKey = opts.linkKey || (sel && map[sel] && !(cloud.bindings[sel] && cloud.bindings[sel].ign) ? sel : null);
    var draft = currentDraft();
    var localData = (linkKey && linkKey !== sel) ? map[linkKey].data : draft;
    if (!presetDataOk(localData)) { toastErr('Enter a class and level first'); return; }
    msDialog({
      title: linkKey ? 'Link ' + slotName(linkKey, map[linkKey]) + ' to an IGN' : 'Add character',
      subtitle: linkKey ? 'Renames this preset to the IGN.' : 'Starts a new character from the current inputs. Upload it later from the sync icon.',
      build: function (body, close) {
        var input = el('input', CLS.input); input.setAttribute('maxlength', '16'); input.placeholder = 'IGN'; input.value = prefill || '';
        input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false');
        body.appendChild(input);
        var err = el('span', 'text-red-500 text-xs text-center'); err.hidden = true; body.appendChild(err);
        body.appendChild(el('span', CLS.hint, metaLine(slotMeta(localData))));
        var go = function () {
          var ign = input.value.trim();
          if (!IGN_RE.test(ign)) { err.textContent = '1 to 16 letters or digits'; err.hidden = false; input.focus(); return; }
          var existing = bindingByIgn(ign);
          if (existing && existing.key !== linkKey) { close(); openExistsLocally(ign, existing.key, localData); return; }
          close(); addCharacter(ign, linkKey, localData);
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        msActions(body, 'Cancel', function () { close(); }, 'Add', go);
        setTimeout(function () { input.focus(); input.select(); }, 30);
      }
    });
  }
  // The IGN is already one of the saved characters: overwrite it with these inputs, or switch to it.
  function openExistsLocally(ign, key, localData) {
    var map = presetMap(), slot = map[key]; if (!slot) return;
    var b = cloud.bindings[key];
    msDialog({ title: ign + ' already exists', subtitle: metaLine(slotMeta(slot.data)) + ', saved ' + relTime(slot.savedAt), build: function (body, close) {
      var list = el('div', CLS.list);
      list.appendChild(msRow('Overwrite with these inputs', b && b.cloudUpdatedAt ? 'The cloud copy is uploaded too' : 'Replaces the saved preset', function () {
        close();
        if (!writeDraftToSlot(key, localData)) return;
        setSelected(key, false, true);
        if (b && b.ign) uploadSlot(key, { onConflict: function () { openCompareForSlot(key); } }); else toastOk('Overwritten');
      }));
      list.appendChild(msRow('Switch to it', 'Loads the saved preset into the form', function () { close(); setSelected(key, true); }));
      body.appendChild(list);
      var cancel = el('button', CLS.ghost, 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', function () { close(); }); body.appendChild(cancel);
    } });
  }
  function addCharacter(ign, linkKey, localData) {
    var sel = selectedKey();
    var bindLocal = function (doc) {
      var key = writeSlot(linkKey, localData, ign);
      if (!key) return null;
      bindSlot(key, ign, doc);
      setSelected(key, !!linkKey && linkKey !== sel, true);   // the form already shows these inputs
      return key;
    };
    if (!cloudEnabled()) {
      confirmDialog('Add ' + ign + '?', 'Saved in this browser only.', 'Add', function () { if (bindLocal(null)) toastOk('Saved ' + ign); });
      return;
    }
    fetchDoc(ign, function (err, doc) {
      if (err) {
        confirmDialog('Cloud unavailable', 'Save ' + ign + ' locally and upload it later from the sync icon?', 'Save locally', function () { if (bindLocal(null)) toastOk('Saved ' + ign + '. Not uploaded yet.'); });
        return;
      }
      if (!doc) {
        confirmDialog('Add ' + ign + '?', 'Starts it from the current inputs. Upload it later from the sync icon.', 'Add', function () {
          if (bindLocal(null)) toastOk('Added. Click the sync icon to upload.');
        });
        return;
      }
      compareDialog({
        ign: ign, doc: doc, localData: localData, localLabel: linkKey ? slotName(linkKey, presetMap()[linkKey]) : 'current inputs',
        localSavedAt: linkKey && presetMap()[linkKey] ? presetMap()[linkKey].savedAt : nowIso(), localSyncedAt: null,
        onOverwriteCloud: function () { var key = bindLocal(doc); if (!key) return; cloud.bindings[key].syncedHash = null; uploadSlot(key, { onConflict: function () { openCompareForSlot(key); } }); },
        onReplaceLocal: function () { var key = bindLocal(doc); if (!key) return; if (applyCloudDoc(key, doc)) toastOk('Loaded ' + ign + ' from the cloud'); },
        onSaveAsNew: linkKey ? null : function () {
          var d = docPresetData(doc); if (!d) return;
          var nk = writeSlot(null, d, ign); if (!nk) return;
          bindSlot(nk, ign, doc); setSelected(nk, true, true); toastOk('Saved the cloud copy of ' + ign + ' as a new preset');
        }
      });
    });
  }
  function selectCloudOnly(ign) {
    closePicker();
    var existing = bindingByIgn(ign);
    if (existing) { setSelected(existing.key, true); return; }
    fetchDoc(ign, function (err, doc) {
      if (err || !doc) { toastErr(err && err.offline ? 'Cloud unavailable' : 'Could not load ' + ign + ' from the cloud'); cloud.listAt = 0; return; }
      var d = docPresetData(doc);
      if (!d || !presetDataOk(d)) { toastErr('The cloud copy of ' + ign + ' is not a valid preset'); return; }
      var key = writeSlot(null, d, doc.ign || ign); if (!key) return;
      bindSlot(key, doc.ign || ign, doc);
      setSelected(key, true, true);
      toastOk('Loaded ' + (doc.ign || ign) + ' from the cloud');
    });
  }

  /* -- history: the last 10 saves of each character, restorable locally -------------------- */
  var LS_CLOUD_HISTORY = 'msfix:cloud:history', HISTORY_MAX = 10, HISTORY_EDIT_GAP_MS = 120000;
  var WHY = { upload: 'Uploaded', edit: 'Saved', pull: 'Cloud copy', keep: 'Before a change', restore: 'Restored', import: 'Imported' };
  var histCache = null;
  function histMap() { if (!histCache) histCache = lsJson(LS_CLOUD_HISTORY, {}); return histCache; }
  function histKey(key) { var b = cloud.bindings[key]; if (b && b.ign) return b.ign.toLowerCase(); var s = presetMap()[key]; return 'slot:' + ((s && s.label) || key); }
  function saveHist() {
    var m = histMap();
    for (var tries = 0; tries < 8; tries++) {
      try { lsSet(LS_CLOUD_HISTORY, JSON.stringify(m)); return; }
      catch (e) {   // storage quota: drop the oldest snapshot anywhere and retry
        var ok = null, oi = -1, oat = null;
        for (var k in m) for (var i = 0; i < m[k].length; i++) if (!oat || m[k][i].at < oat) { oat = m[k][i].at; ok = k; oi = i; }
        if (ok === null) return;
        m[ok].splice(oi, 1); if (!m[ok].length) delete m[ok];
      }
    }
  }
  // Rapid edits collapse into the latest "Saved" entry (one per two minutes); every other kind
  // of save gets its own entry. Identical content never creates a duplicate.
  function pushHistory(key, why, data) {
    if (!data || !presetDataOk(data)) return;
    var hk = histKey(key), m = histMap(), list = m[hk] || (m[hk] = []), h = hashData(data);
    if (list.length && list[0].hash === h) { if (why !== 'edit') list[0].why = why; list[0].at = nowIso(); saveHist(); return; }
    if (why === 'edit' && list.length && list[0].why === 'edit' && Date.now() - new Date(list[0].at).getTime() < HISTORY_EDIT_GAP_MS) {
      list[0] = { at: nowIso(), why: 'edit', hash: h, data: clone(data) }; saveHist(); return;
    }
    list.unshift({ at: nowIso(), why: why, hash: h, data: clone(data) });
    while (list.length > HISTORY_MAX) list.pop();
    saveHist();
  }
  function historyFor(key) { return histMap()[histKey(key)] || []; }
  function moveHistory(fromKey, toKey) { if (fromKey === toKey) return; var m = histMap(); if (m[fromKey]) { m[toKey] = m[fromKey]; delete m[fromKey]; saveHist(); } }
  function openHistory(key) {
    closePicker();
    var slot = presetMap()[key]; if (!slot) return;
    var list = historyFor(key), cur = hashData(slot.data);
    msDialog({ title: 'History', subtitle: list.length ? 'Pick a save to load it into the form. Nothing is uploaded.' : 'No saves yet.', build: function (body, close) {
      var box = el('div', CLS.list);
      list.forEach(function (h, i) {
        var same = h.hash === cur;
        box.appendChild(msRow((WHY[h.why] || 'Saved') + ' ' + relTime(h.at) + (i === 0 ? ' (latest)' : ''), metaLine(slotMeta(h.data)) + (same ? ', same as now' : ''), function () { close(); restoreHistory(key, h); }));
      });
      body.appendChild(box);
      var cancel = el('button', CLS.ghost, 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', function () { close(); }); body.appendChild(cancel);
    } });
  }
  function restoreHistory(key, h) {
    var slot = presetMap()[key]; if (!slot) return;
    if (hashData(slot.data) === h.hash) { toastOk('That is the current version'); return; }
    if (selectedKey() === key) flushAutosave();
    pushHistory(key, 'keep', presetMap()[key].data);
    if (!writeSlot(key, h.data, slot.label)) return;
    if (selectedKey() === key) loadIntoForm(key); else setSelected(key, true, true);
    pushHistory(key, 'restore', h.data);
    renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
    toastOk('Loaded the save from ' + relTime(h.at) + '. Upload it from the sync icon if you want it in the cloud.');
  }

  /* -- row actions: overwrite / rename / delete local / delete cloud ---------------------- */
  function overwriteFromDraft(key) {
    var slot = presetMap()[key]; if (!slot) return;
    var d = currentDraft(); if (!d || !presetDataOk(d)) { toastErr('Enter a class and level first'); return; }
    var name = slotName(key, slot), b = cloud.bindings[key];
    confirmDialog('Overwrite this character?', 'The current inputs replace the saved character' + (b && b.ign && b.cloudUpdatedAt ? ' and its cloud copy.' : '.'), 'Overwrite', function () {
      if (cloud.selected && cloud.selected.key === key) flushAutosave();
      pushHistory(key, 'keep', slot.data);
      if (!writeDraftToSlot(key, d)) return;
      pushHistory(key, 'edit', d);
      setSelected(key, false, true);
      if (b && b.ign) uploadSlot(key, { onConflict: function () { openCompareForSlot(key); } }); else toastOk('Overwritten');
    });
  }
  function renameSlot(key) {
    var slot = presetMap()[key]; if (!slot) return;
    var b = cloud.bindings[key], cur = b && b.ign ? b.ign : (IGN_RE.test(slot.label || '') ? slot.label : '');
    msDialog({ title: 'Rename', subtitle: b && b.ign && b.cloudUpdatedAt ? 'The cloud copy keeps the old name until you upload under the new one.' : '', build: function (body, close) {
      var input = el('input', CLS.input); input.setAttribute('maxlength', '16'); input.placeholder = 'IGN'; input.value = cur;
      input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false'); body.appendChild(input);
      var err = el('span', 'text-red-500 text-xs text-center'); err.hidden = true; body.appendChild(err);
      var go = function () {
        var ign = input.value.trim();
        if (!IGN_RE.test(ign)) { err.textContent = '1 to 16 letters or digits'; err.hidden = false; input.focus(); return; }
        var other = bindingByIgn(ign); if (other && other.key !== key) { err.textContent = ign + ' is already another character'; err.hidden = false; return; }
        close();
        var same = !!(b && b.ign && eqi(b.ign, ign));
        var wasSelected = !!(cloud.selected && cloud.selected.key === key);
        var oldHist = histKey(key);
        // Keep the binding and the selection in step with the new label BEFORE the store changes,
        // so the reconciler (label/savedAt matching) does not drop them on the way through.
        if (b) b.label = ign; if (wasSelected) cloud.selected.label = ign; saveBindings();
        var m2 = clone(presetMap()); if (!m2[key]) return; m2[key].label = ign; if (!setPresetMap(m2)) return;
        bindSlot(key, ign, null);
        moveHistory(oldHist, histKey(key));
        if (wasSelected) setSelected(key, false, true);
        renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
        toastOk('Renamed to ' + ign + (same || !cloudEnabled() ? '' : '. Click the sync icon to upload it.'));
      };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      msActions(body, 'Cancel', function () { close(); }, 'Rename', go);
      setTimeout(function () { input.focus(); input.select(); }, 30);
    } });
  }
  function deleteLocalSlot(key) {
    var slot = presetMap()[key]; if (!slot) return;
    var name = slotName(key, slot), b = cloud.bindings[key];
    confirmDialog('Delete this character?', 'Removes the local preset.' + (b && b.ign && b.cloudUpdatedAt ? ' The cloud copy stays.' : ''), 'Delete', function () {
      var s = cloudStores(); if (!s) return;
      if (cloud.selected && cloud.selected.key === key) { if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; } cloud.selected = null; }
      var hm = histMap(); delete hm[histKey(key)]; saveHist();
      delete cloud.bindings[key]; saveBindings();
      try { s.ps.getState().deletePreset(key); } catch (e) { toastErr('Could not delete the preset'); return; }
      reconcileBindings(); renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
      toastOk('Deleted');
    });
  }
  function deleteCloud(key) {
    var b = cloud.bindings[key]; if (!b || !b.ign) return;
    confirmDialog('Delete from the cloud?', 'The local preset stays.', 'Delete from cloud', function () {
      busy(1);
      cloudFetch('DELETE', cloudPath(b.ign), { headers: { 'X-Confirm': b.ign } }).then(function (r) {
        busy(-1);
        if (r.ok || r.status === 404) {
          b.cloudUpdatedAt = null; b.remoteUpdatedAt = null; b.syncedHash = null; b.syncedAt = null; saveBindings(); updateIcon(); if (picker.open) renderDropdown();
          toastOk('Deleted from the cloud');
        } else toastErr('Could not delete ' + b.ign + ' from the cloud (' + r.status + ')');
      }, function (e) { busy(-1); if (!e.disabled) toastErr('Cloud unavailable'); updateIcon(); });
    });
  }
  // Download a saved character as a native preset file (with "ign" so importing re-links it).
  function downloadSlotJson(key) {
    var slot = presetMap()[key]; if (!slot || !presetDataOk(slot.data)) { toastErr('Nothing to download'); return; }
    var b = cloud.bindings[key], ign = b && b.ign ? b.ign : null, name = ign || slot.label || autoPresetLabel(slot.data) || ('preset-' + key);
    var file = { type: 'maplescouter-manual-preset', v: 1, savedAt: slot.savedAt || nowIso(), label: slot.label || name, data: slot.data };
    if (ign) file.ign = ign;
    var blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'scouter-character-' + String(name).replace(/[\/\\:*?"<>|\s]+/g, '_') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 60000);
    toastOk('Downloaded ' + a.download);
  }
  function openRowMenu(key) {
    closePicker();
    var slot = presetMap()[key]; if (!slot) return;
    var b = cloud.bindings[key], name = slotName(key, slot), inCloud = !!(b && b.ign && b.cloudUpdatedAt);
    msDialog({ title: name, subtitle: metaLine(slotMeta(slot.data)), build: function (body, close) {
      // Compact: icon + one word each, two per row; destructive ones in red.
      var grid = el('div', 'grid w-full grid-cols-2 gap-2');
      var act = function (icon, label, extra, fn) {
        var x = el('button', CLS.ghost + (extra ? ' ' + extra : '')); x.type = 'button';
        x.innerHTML = svgIcon(icon); x.appendChild(el('span', '', label));
        x.addEventListener('click', function () { close(); fn(); });
        grid.appendChild(x);
      };
      act('save', 'Overwrite', '', function () { overwriteFromDraft(key); });
      act('pencil', b && b.ign ? 'Rename' : 'Set IGN', '', function () { if (b && b.ign) renameSlot(key); else openAddDialog(IGN_RE.test(slot.label || '') ? slot.label : '', { linkKey: key }); });
      act('download', 'Download', '', function () { downloadSlotJson(key); });
      act('history', 'History', '', function () { openHistory(key); });
      act('trash', 'Delete', 'text-red-500', function () { deleteLocalSlot(key); });
      if (inCloud) act('cloud-off', 'Delete from cloud', 'text-red-500 col-span-2', function () { deleteCloud(key); });
      body.appendChild(grid);
      var cancel = el('button', CLS.ghost, 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', function () { close(); }); body.appendChild(cancel);
    } });
  }
  // "Import JSON…": a native or legacy preset file becomes a character (or overwrites one).
  function importJsonFlow() {
    closePicker();
    pickJsonFile(function (txt) {
      var parsed = parsePresetFile(txt);
      var usable = parsed ? parsed.presets.filter(function (p) { return presetDataOk(p.data); }) : [];
      if (!usable.length) { toastErr("This isn't a MapleScouter preset file"); return; }
      pickPreset(usable, function (p) {
        var data = conformTo(currentUserStatTemplate(), p.data);
        var ign = p.ign || (IGN_RE.test(p.label || '') ? p.label : null);
        var existing = ign ? bindingByIgn(ign) : null;
        var finish = function (key, what) { if (ign) bindSlot(key, ign, null); setSelected(key, true, true); toastOk(what + ' ' + (ign || p.label || 'preset')); };
        if (!existing) { var k = writeSlot(null, data, ign || p.label || autoPresetLabel(data)); if (k) finish(k, 'Imported'); return; }
        msDialog({ title: ign + ' already exists', subtitle: 'The file contains ' + metaLine(slotMeta(data)) + '.', build: function (body, close) {
          var list = el('div', CLS.list);
          list.appendChild(msRow('Replace it', 'The file replaces the saved preset', function () { close(); var old = presetMap()[existing.key]; if (old) pushHistory(existing.key, 'keep', old.data); var k2 = writeSlot(existing.key, data, ign); if (k2) { pushHistory(k2, 'import', data); finish(k2, 'Replaced'); } }));
          list.appendChild(msRow('Import as a new preset', 'Keeps both', function () { close(); var k3 = writeSlot(null, data, ign + ' (file)'); if (k3) { setSelected(k3, true, true); toastOk('Imported ' + ign + ' as a new preset'); } }));
          body.appendChild(list);
          var cancel = el('button', CLS.ghost, 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', function () { close(); }); body.appendChild(cancel);
        } });
      });
    });
  }

  /* -- the picker (combobox + sync icon) ------------------------------------------------- */
  var SOFT_BASE = CLS.soft.replace(' text-text-gray-high', '');
  var picker = { el: null, input: null, dd: null, icon: null, live: null, open: false, filter: '', active: -1, items: [], mountPoll: null };
  var C_INPUT = 'placeholder:text-muted-gray-low outline-outline-gray-med bg-surface-gray-surface-0 flex h-8 min-w-0 rounded-[4px] px-3 py-1 text-sm outline transition-[color,box-shadow] md:text-sm focus:outline-outline-gray-high focus:shadow-[0px_0px_0px_3px_rgba(0,0,0,0.20)] w-[216px] pr-8';
  var C_DD = 'msfix-dd bg-surface-gray-surface-0 text-text-gray-high absolute right-0 z-[2147483647] mt-1 w-[340px] max-w-[92vw] max-h-[60vh] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md text-left';
  var C_SECTION = 'text-text-gray-low px-2 py-1 text-[11px] font-semibold tracking-wide';
  var C_OPT = 'msfix-opt relative flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-sm py-1.5 pr-2 pl-2 text-sm select-none text-left';
  var C_OPT_HOVER = ' hover:bg-surface-gray-surface-1', C_OPT_SELECTED = ' bg-surface-gray-surface-1 hover:bg-surface-gray-surface-2', C_OPT_ACTIVE = 'bg-surface-gray-surface-2';
  var C_BADGE = 'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ';
  var C_DIVIDER = 'border-outline-gray-med my-1 border-t';
  var C_FOOT_BTN = 'flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-xs hover:bg-surface-gray-surface-1 text-left';

  function buildPicker() {
    var wrap = el('div', 'msfix-charpicker flex items-center gap-2'); wrap.setAttribute('data-msfix-ui', '');
    var rel = el('div', 'relative');
    var input = el('input', C_INPUT);
    input.type = 'text'; input.placeholder = 'Choose a character...';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'msfix-charlist'); input.setAttribute('aria-haspopup', 'listbox'); input.setAttribute('aria-label', 'Character');
    input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false'); input.setAttribute('autocapitalize', 'off');
    var chev = el('span', 'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-gray-low'); chev.innerHTML = svgIcon('chevrons-up-down');
    var dd = el('div', C_DD); dd.id = 'msfix-charlist'; dd.setAttribute('role', 'listbox'); dd.hidden = true;
    rel.appendChild(input); rel.appendChild(chev); rel.appendChild(dd);
    var icon = el('button', SOFT_BASE + ' msfix-sync text-text-gray-low'); icon.type = 'button';
    attachTooltip(icon);
    var live = el('span', 'sr-only'); live.setAttribute('aria-live', 'polite');
    wrap.appendChild(rel); wrap.appendChild(icon); wrap.appendChild(live);

    input.addEventListener('focus', function () { openPicker(); });
    input.addEventListener('click', function () { if (!picker.open) openPicker(); });
    input.addEventListener('input', function () { picker.filter = input.value; picker.active = -1; if (!picker.open) openPicker(); else renderDropdown(); });
    input.addEventListener('keydown', onPickerKey);
    dd.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep focus in the input
    dd.addEventListener('click', function (e) {
      var act = e.target && e.target.closest ? e.target.closest('[data-msfix-act]') : null;
      if (act && dd.contains(act)) { e.preventDefault(); e.stopPropagation(); if (act.getAttribute('data-msfix-act') === 'menu') openRowMenu(act.getAttribute('data-msfix-key')); return; }
      var t = e.target && e.target.closest ? e.target.closest('[data-msfix-idx]') : null;
      if (!t || !dd.contains(t)) return;
      e.preventDefault(); e.stopPropagation();
      activateItem(+t.getAttribute('data-msfix-idx'));
    });
    icon.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onSyncClick(); });
    picker.el = wrap; picker.input = input; picker.dd = dd; picker.icon = icon; picker.live = live;
  }
  function renderTrigger() {
    if (!picker.input) return;
    var key = selectedKey(), map = presetMap();
    var name = key && map[key] ? slotName(key, map[key]) : '';
    picker.input.setAttribute('data-msfix-selected', key || '');
    if (picker.open) { picker.input.placeholder = name || 'Search or add a character...'; return; }
    picker.input.value = name; picker.input.placeholder = 'Choose a character...';
    picker.input.title = name;
  }
  function openPicker() {
    if (!picker.dd || picker.open) return;
    picker.open = true; picker.filter = ''; picker.active = -1;
    picker.input.value = ''; picker.input.setAttribute('aria-expanded', 'true');
    renderTrigger(); picker.dd.hidden = false; renderDropdown();
  }
  function closePicker() {
    if (!picker.dd || !picker.open) return;
    picker.open = false; picker.filter = ''; picker.active = -1;
    picker.dd.hidden = true; picker.input.setAttribute('aria-expanded', 'false'); picker.input.removeAttribute('aria-activedescendant');
    renderTrigger();
  }
  function onPickerKey(e) {
    var n = picker.items.length;
    if (e.key === 'Escape') { if (picker.open) { e.preventDefault(); e.stopPropagation(); closePicker(); picker.input.blur(); } return; }
    if (e.key === 'Tab') { closePicker(); return; }
    if (!picker.open) { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openPicker(); } return; }
    if (e.key === 'ArrowRight' && picker.active >= 0 && picker.items[picker.active] && picker.items[picker.active].type === 'local') { e.preventDefault(); openRowMenu(picker.items[picker.active].key); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(n ? (picker.active + 1) % n : -1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(n ? (picker.active - 1 + n) % n : -1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(n ? 0 : -1); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n ? n - 1 : -1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (picker.active >= 0) activateItem(picker.active);
      else if (n === 1) activateItem(0);
      else if (picker.filter.trim() && IGN_RE.test(picker.filter.trim())) openAddDialog(picker.filter.trim());
    }
  }
  function setActive(i) {
    picker.active = i;
    for (var k = 0; k < picker.items.length; k++) {
      var it = picker.items[k]; if (!it.el) continue;
      if (k === i) { it.el.classList.add('msfix-active'); it.el.classList.add(C_OPT_ACTIVE); picker.input.setAttribute('aria-activedescendant', it.el.id); if (it.el.scrollIntoView) try { it.el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
      else { it.el.classList.remove('msfix-active'); it.el.classList.remove(C_OPT_ACTIVE); }
    }
    if (i < 0) picker.input.removeAttribute('aria-activedescendant');
  }
  function activateItem(i) {
    var it = picker.items[i]; if (!it) return;
    if (it.type === 'local') { closePicker(); picker.input.blur(); setSelected(it.key, true); }
    else if (it.type === 'cloud-lookup') { picker.input.blur(); selectCloudOnly(it.ign); }
    else if (it.type === 'add') { picker.input.blur(); openAddDialog(IGN_RE.test(picker.filter.trim()) ? picker.filter.trim() : ''); }
    else if (it.type === 'import') { picker.input.blur(); importJsonFlow(); }
    else if (it.type === 'download') { closePicker(); picker.input.blur(); downloadSlotJson(it.key); }
  }
  function badge(kind) {
    return el('span', 'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ' + (kind === 'cloud' ? 'bg-green-600 text-white' : 'bg-surface-gray-surface-2 text-text-gray-low'), kind);
  }
  // A row: name + chips (+ a menu button for saved characters), then one or two wrapping lines.
  // The selected row is marked by the accent bar + background (CSS on aria-selected), nothing else.
  function optionEl(idx, main, sub1, sub2, badges, selected, menuKey) {
    var d = el('div', C_OPT + (selected ? ' msfix-selected' + C_OPT_SELECTED : C_OPT_HOVER)); d.setAttribute('role', 'option'); d.id = 'msfix-opt-' + idx; d.setAttribute('data-msfix-idx', String(idx));
    d.setAttribute('aria-selected', selected ? 'true' : 'false');
    var top = el('div', 'flex w-full items-center gap-2');
    var m = el('span', 'min-w-0 flex-1 truncate ' + (selected ? 'font-semibold' : 'font-medium'), main); m.title = main; top.appendChild(m);
    (badges || []).forEach(function (k) { top.appendChild(badge(k)); });
    if (menuKey) {
      var kb = el('button', 'msfix-row-menu shrink-0 rounded-sm p-0.5 text-text-gray-low hover:bg-surface-gray-surface-2 hover:text-text-gray-high'); kb.type = 'button';
      kb.setAttribute('data-msfix-act', 'menu'); kb.setAttribute('data-msfix-key', menuKey); kb.setAttribute('aria-label', 'Actions for ' + main); kb.title = 'More actions';
      kb.innerHTML = svgIcon('ellipsis'); top.appendChild(kb);
    }
    d.appendChild(top);
    if (sub1) d.appendChild(el('span', 'text-text-gray-low w-full text-xs whitespace-normal break-words', sub1));
    if (sub2) d.appendChild(el('span', 'text-text-gray-low w-full text-xs whitespace-normal break-words', sub2));
    return d;
  }
  function renderDropdown() {
    if (!picker.dd || !picker.open) return;
    var dd = picker.dd; dd.innerHTML = ''; picker.items = [];
    var q = picker.filter.trim(), ql = q.toLowerCase();
    var map = presetMap(), keys = slotKeys(map), sel = selectedKey();
    var match = function (parts) { if (!ql) return true; for (var i = 0; i < parts.length; i++) if (parts[i] && String(parts[i]).toLowerCase().indexOf(ql) !== -1) return true; return false; };
    var addItem = function (item, node) { item.el = node; picker.items.push(item); return node; };
    var divider = function () { dd.appendChild(el('div', C_DIVIDER)); };

    // One list: every saved character, with chips for where it lives. The cloud is never
    // listed wholesale — a character is fetched only when its IGN is typed.
    dd.appendChild(el('div', C_SECTION, 'Characters'));
    var rows = 0, typedIsLocal = false;
    keys.forEach(function (k) {
      var s = map[k]; if (!s || !presetDataOk(s.data)) return;
      var b = cloud.bindings[k], m = slotMeta(s.data), name = slotName(k, s);
      if (b && b.ign && ql && b.ign.toLowerCase() === ql) typedIsLocal = true;
      if (!match([name, s.label, b && b.ign, m.classEn, m.classKo])) return;
      var inCloud = !!(b && b.ign && b.cloudUpdatedAt);
      var when = 'saved ' + relTime(s.savedAt) + (inCloud ? ', cloud ' + relTime(b.remoteUpdatedAt || b.cloudUpdatedAt) : '');
      dd.appendChild(addItem({ type: 'local', key: k }, optionEl(picker.items.length, name, metaLine(m), when, inCloud ? ['local', 'cloud'] : ['local'], k === sel, k)));
      rows++;
    });
    if (!rows) dd.appendChild(el('div', 'text-text-gray-low px-2 py-1 text-xs', ql ? 'No saved character matches' : 'No saved characters yet'));
    divider();
    if (ql && IGN_RE.test(q) && !typedIsLocal) {
      dd.appendChild(addItem({ type: 'cloud-lookup', ign: q }, optionEl(picker.items.length, 'Load ' + q + ' from the cloud', 'Loads that character by IGN', '', ['cloud'], false)));
    }
    dd.appendChild(addItem({ type: 'add' }, optionEl(picker.items.length, '+ Add character', ql && IGN_RE.test(q) ? 'Start ' + q + ' from the current inputs' : 'Start a new character from the current inputs', '', [], false)));
    divider();
    var foot = el('div', 'flex flex-col gap-0.5 px-1 pb-1');
    var imp = el('button', C_FOOT_BTN); imp.type = 'button'; imp.id = 'msfix-opt-' + picker.items.length; imp.setAttribute('data-msfix-idx', String(picker.items.length));
    imp.appendChild(el('span', '', 'Import JSON...')); var ic = el('span', 'text-text-gray-low'); ic.innerHTML = svgIcon('file-up'); imp.appendChild(ic);
    foot.appendChild(addItem({ type: 'import' }, imp));
    if (sel && map[sel]) {
      var dl = el('button', C_FOOT_BTN); dl.type = 'button'; dl.id = 'msfix-opt-' + picker.items.length; dl.setAttribute('data-msfix-idx', String(picker.items.length));
      dl.appendChild(el('span', '', 'Download JSON...')); var dic = el('span', 'text-text-gray-low'); dic.innerHTML = svgIcon('download'); dl.appendChild(dic);
      foot.appendChild(addItem({ type: 'download', key: sel }, dl));
    }
    dd.appendChild(foot);
    setActive(picker.active >= 0 && picker.active < picker.items.length ? picker.active : -1);
  }

  function unmountPicker() {
    closePicker(); stopPolling();
    if (picker.el && picker.el.parentNode) picker.el.parentNode.removeChild(picker.el);
  }
  // Idempotent: mounts once the native row exists and both stores are known; re-run after
  // every panel remount (loadDraft & co.), from the housekeeping interval and on navigation.
  function ensureCharPicker() {
    applyRouteGate();
    if (!isInputRoute()) { if (picker.el && picker.el.parentNode) unmountPicker(); return false; }
    var row = nativePresetRow(); if (!row) return false;
    var header = row.parentElement; if (!header) return false;
    if (!ensureSubscriptions()) return false;
    if (picker.el && header.contains(picker.el)) return true;
    if (!picker.el) buildPicker();
    else if (picker.el.parentNode) picker.el.parentNode.removeChild(picker.el);
    header.appendChild(picker.el);
    reconcileBindings(); renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
    startPolling();
    return true;
  }
  function schedulePickerMount() {
    if (picker.mountPoll) clearInterval(picker.mountPoll);
    var tries = 0;
    picker.mountPoll = setInterval(function () {
      if (++tries > 200 || !isInputRoute() || ensureCharPicker()) { clearInterval(picker.mountPoll); picker.mountPoll = null; }
    }, 150);
  }

  /* -- export enrichment: the site's Save-as-JSON file gets "ign" for a linked slot -------- */
  // The site builds the file synchronously (Blob → object URL → detached <a>.click() → revoke).
  // Shadow click on <a> only, keep the Blob while its URL is alive, read it asynchronously,
  // add "ign" from the slot in the filename, and click the original with a fresh URL. The
  // site's importer ignores unknown top-level keys, so the file stays importable there too.
  function installExportEnricher() {
    if (window.__msfixExportHook) return; window.__msfixExportHook = true;
    var blobs = {}, order = [];
    var oCreate = URL.createObjectURL, oRevoke = URL.revokeObjectURL;
    if (typeof oCreate !== 'function' || typeof oRevoke !== 'function' || typeof HTMLAnchorElement === 'undefined') return;
    URL.createObjectURL = function (o) {
      var u = oCreate.apply(URL, arguments);
      try { if (o instanceof Blob) { blobs[u] = o; order.push(u); while (order.length > 20) delete blobs[order.shift()]; } } catch (e) {}
      return u;
    };
    URL.revokeObjectURL = function (u) { try { delete blobs[u]; } catch (e) {} return oRevoke.apply(URL, arguments); };
    var oClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      var a = this, args = arguments;
      var m = /^scouter-preset-(\d+)/.exec(a.getAttribute('download') || '');
      var blob = m ? blobs[a.href] : null;             // must be read now — revoked right after we return
      var ign = m ? ignForSlot(m[1]) : null;
      if (!blob || !ign) return oClick.apply(a, args);
      blob.text().then(function (txt) {
        var o = null; try { o = JSON.parse(txt); } catch (e) {}
        if (!o || o.type !== 'maplescouter-manual-preset') return oClick.apply(a, args);
        o.ign = ign;
        var nu = oCreate.call(URL, new Blob([JSON.stringify(o)], { type: 'application/json' }));
        a.href = nu; oClick.apply(a, args);
        setTimeout(function () { try { oRevoke.call(URL, nu); } catch (e) {} }, 60000);
      }, function () { oClick.apply(a, args); });
    };
  }

  function cloudOnReady() {
    injectCloudCss();
    applyRouteGate();
    schedulePickerMount();
    var onFocus = function () { if (!document.hidden) { cloud.pollDelay = POLL_MS; pollTick(true); } };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('storage', function (e) {
      if (!e || (e.key !== LS_CLOUD_SLOTS && e.key !== LS_CLOUD_SELECTED && e.key !== LS_CLOUD_ENABLED && e.key !== LS_CLOUD_AUTO)) return;
      loadBindings(); if (cloud.subscribed) reconcileBindings(); renderTrigger(); updateIcon(); if (picker.open) renderDropdown();
    });
    document.addEventListener('mousedown', function (e) {
      if (picker.open && picker.el && !picker.el.contains(e.target)) closePicker();
    }, true);
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
  loadBindings();            // cloud character bindings (needed by the export hook below)
  installExportEnricher();   // Save-as-JSON files of linked presets carry "ign"
  applyRouteGate();          // hide native Load/Save + IGN search on /input only

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
    applyRouteGate();
    schedulePickerMount();
    if (document.body && pathLocale() === 'en') {
      setTimeout(function () { processTree(document.body); }, 50);
    }
  }

  function onReady() {
    injectCss();
    installPresetImportBridge(); // let the site's native import accept our old export files
    cloudOnReady();              // character picker + cloud sync (Manual Input page)
    // The Save window mounts on click, so look for it right after one rather than waiting
    // for the housekeeping interval below.
    document.addEventListener('click', function () {
      setTimeout(ensureSaveImportIcons, 60);
      setTimeout(ensureSaveImportIcons, 260);
    }, true);
    // Delay the DOM layer slightly so React hydration finishes first.
    setTimeout(startDomLayer, 250);
    setTimeout(function () { translateTitle(); fixLogo(); killAdPopups(); hideKoreanChangelog(); hideFavoritesBar(); compactCheckboxRows(); }, 400);
    setInterval(function () { backupRegion(); translateTitle(); fixLogo(); killAdPopups(); hideKoreanChangelog(); hideFavoritesBar(); compactCheckboxRows(); ensureSaveImportIcons(); refreshFloatRects(); ensureCharPicker(); }, 2000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') onReady();
  else window.addEventListener('DOMContentLoaded', onReady);
})();
