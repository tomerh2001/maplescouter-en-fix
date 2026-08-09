#!/usr/bin/env node
/* Merges round-2 workflow outputs + official game-data joins into ../data/ files. */
const fs = require('fs');
const path = require('path');

const W = __dirname;
const DATA = path.join(W, '..', 'data');

const CODE_JUNK = /[{}=;]|:\s*null|^\s*[,.]/;
const hangul = /[가-힣]/;

// ---- collect translations: finals > pre > seedver ----
const trans = new Map(); // ko -> {en, conf}
const problems = [];
function loadArr(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function addAll(arr, label) {
  if (!Array.isArray(arr)) { problems.push(label + ' unreadable'); return; }
  for (const e of arr) {
    if (!e || typeof e.ko !== 'string' || typeof e.en !== 'string' || !e.en.trim()) continue;
    if (!trans.has(e.ko)) trans.set(e.ko, { en: e.en, conf: e.conf || 'medium' });
  }
}
const OUT = path.join(W, 'out');
const B = path.join(W, 'batches');
// verified finals first (higher priority), then pre fallbacks, then seed-verified
for (const f of fs.readdirSync(B)) {
  const m = f.match(/^(trans|delta)_(\w+)_(\d+)\.json$/);
  if (!m) continue;
  const finName = m[1] === 'trans' ? `trans_${m[2]}_${m[3]}.json` : `delta_${m[2]}_${m[3]}.json`;
  const preName = m[1] === 'trans' ? `pre_${m[2]}_${m[3]}.json` : `dpre_${m[2]}_${m[3]}.json`;
  const finA = fs.existsSync(path.join(OUT, finName)) ? loadArr(path.join(OUT, finName)) : null;
  if (finA && finA.length) addAll(finA, f);
  else {
    const preA = fs.existsSync(path.join(OUT, preName)) ? loadArr(path.join(OUT, preName)) : null;
    if (preA && preA.length) { addAll(preA, f); problems.push(f + ' using unverified pre'); }
    else problems.push(f + ' NO OUTPUT');
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(W, 'manifest.json'), 'utf8'));
for (let i = 0; i < manifest.seedverCount; i++) {
  const fin = loadArr(path.join(OUT, `seedver_${i}.json`));
  if (fin && fin.length) addAll(fin, 'seedver_' + i);
  else { addAll(loadArr(path.join(B, `seedver_${i}.json`)), 'seedver_' + i); problems.push('seedver_' + i + ' using unverified seeds'); }
}

// ---- review fixes ----
const fixes = new Map();
const fixList = [];
for (let i = 0; i < manifest.reviewCount; i++) {
  const fin = loadArr(path.join(OUT, `review_${i}.json`));
  const pre = loadArr(path.join(OUT, `prefix_${i}.json`));
  const arr = (fin && fin.length) ? fin : (pre && pre.length ? pre : null);
  if (!arr) { problems.push('review_' + i + ' empty/none'); continue; }
  if (!(fin && fin.length)) problems.push('review_' + i + ' using unvalidated prefix');
  for (const e of arr) {
    if (e && typeof e.ko === 'string' && typeof e.proposed === 'string' && e.proposed.trim()) {
      fixes.set(e.ko, e.proposed);
      fixList.push(e);
    }
  }
}

// ---- official + existing tables ----
const official = new Map(JSON.parse(fs.readFileSync(path.join(W, 'official_map.json'), 'utf8')));
const corpusOfficial = JSON.parse(fs.readFileSync(path.join(W, 'corpus_official.json'), 'utf8'));
function flatten(d, p = '') { const o = {}; for (const [k, v] of Object.entries(d)) { const key = p ? p + '.' + k : k; if (v && typeof v === 'object') Object.assign(o, flatten(v, key)); else o[key] = v; } return o; }
const enTable = flatten(JSON.parse(fs.readFileSync(path.join(W, 'en.json'), 'utf8')));
const untr = JSON.parse(fs.readFileSync(path.join(W, 'untranslated.json'), 'utf8')).map(e => e.s);

function lookup(ko) {
  if (trans.has(ko)) return trans.get(ko).en;
  if (official.has(ko)) return official.get(ko);
  return null;
}

// ================= i18n patch =================
const i18nPatch = {};
for (const [ko, en] of corpusOfficial) if (!CODE_JUNK.test(ko)) i18nPatch[ko] = en;
for (const [ko, { en }] of trans) if (!CODE_JUNK.test(ko)) i18nPatch[ko] = en;
for (const s of untr) {
  const m = s.match(/^(.+?)\s*([×x]\s*[\d,]+)$/);
  if (!m) continue;
  const base = lookup(m[1].trim());
  if (base != null && !CODE_JUNK.test(s)) i18nPatch[s] = base + ' ' + m[2].replace(/\s+/g, '');
}
for (const [ko, en] of fixes) i18nPatch[ko] = en;
for (const k of Object.keys(i18nPatch)) {
  if (!i18nPatch[k] || i18nPatch[k] === k || i18nPatch[k] === enTable[k]) delete i18nPatch[k];
}

// ================= DOM dictionary =================
const dict = {};
// Lowest priority: the site's own en.json table — catches strings that exist as
// i18n keys but are ALSO hardcoded in JSX elsewhere (Reset/Save buttons etc.).
for (const [ko, en] of Object.entries(enTable)) {
  if (ko.length < 2 || CODE_JUNK.test(ko) || !en || typeof en !== 'string' || en === ko || !hangul.test(ko)) continue;
  dict[ko] = en;
}
for (const [ko, en] of official) {
  if (ko.length < 2 || CODE_JUNK.test(ko) || !en || en === ko) continue;
  dict[ko] = en;
}
for (const [ko, en] of corpusOfficial) if (ko.length >= 2 && !CODE_JUNK.test(ko) && en && en !== ko) dict[ko] = en;
for (const [ko, { en }] of trans) if (ko.length >= 2 && !CODE_JUNK.test(ko) && en && en !== ko) dict[ko] = en;
for (const e of fixList) {
  const cur = e.current, prop = e.proposed;
  if (cur && prop && cur !== prop && cur.length <= 40 && !/[{}]/.test(cur) && !hangul.test(cur)) dict[cur] = prop;
}
// review fixes also override the folded en.json entries (KO key → fixed EN)
for (const [ko, en] of fixes) if (hangul.test(ko) && ko.length >= 2 && !CODE_JUNK.test(ko)) dict[ko] = en;

// manual gap entries found in live QA
const MANUAL = {
  '로그인': 'Log In',
  '개인정보처리방침': 'Privacy Policy',
  '이용약관': 'Terms of Service',
  '문의하기': 'Contact Us',
  '메이플 보스 클리어 랭킹': 'MapleStory Boss Clear Ranking',
  '1소재 경험치 :': 'EXP per run :',
  '윌': 'Will', '스우': 'Lotus', '데미안': 'Damien', '루시드': 'Lucid', '더스크': 'Gloom',
  '진힐라': 'Verus Hilla', '듄켈': 'Darknell', '세렌': 'Chosen Seren', '칼로스': 'Kalos',
  '카링': 'Kaling', '림보': 'Limbo', '발드릭스': 'Baldrix', '검마': 'Black Mage',
  '슬라임': 'Guardian Angel Slime', '힐라': 'Hilla', '아델': 'Adele',
  '저장하기': 'Save', '초기화': 'Reset', '불러오기': 'Load', '적용하기': 'Apply', '닫기': 'Close',
  '파괴방지 (선택 단계에서 파괴 방지)': 'Safeguard (prevents destruction at the selected stars)',
  '파괴복구 (선택 단계에서 파괴 시 자동 복구)': 'Boom Recovery (auto-restore when destroyed at the selected stars)',
  '공격 시 20% 확률로 2레벨 슬로우효과 적용': '20% chance to apply Level 2 Slow effect when attacking',
  '내 장비 또는 보관함에서 장비를 클릭하면 해당 장비의 옵션이 초기값으로 적용됩니다.': 'Click an item in My Equipment or the Locker to load its options as the starting values.',
};
for (const [k, v] of Object.entries(MANUAL)) if (!dict[k]) dict[k] = v;

// ================= rules =================
const rules = [
  ['^([\\d,]+)\\s*자 이하로 입력해주세요\\.?$', '', 'Max $1 characters.'],
  ['^([\\d,]+)\\s*자 이상 입력해주세요\\.?$', '', 'Enter at least $1 characters.'],
  ['^(.+?)\\s*외\\s*([\\d,]+)\\s*개$', '', '$1 and $2 more'],
  ['^([\\d,]+)\\s*년$', '', '$1y'],
  ['^([\\d,]+)\\s*일$', '', '$1d'],
  ['^([\\d,]+)\\s*시간$', '', '$1h'],
  ['^([\\d,]+)\\s*분$', '', '$1m'],
  ['^([\\d,]+)\\s*초$', '', '$1s'],
  ['^([\\d,]+)\\s*번째$', '', '#$1'],
  ['^레벨\\s*([\\d,]+)$', '', 'Lv. $1'],
  ['^([\\d,]+)\\s*레벨$', '', 'Lv. $1'],
  ['^([\\d,]+)\\s*층$', '', 'Floor $1'],
];

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'i18n-patch.json'), JSON.stringify(i18nPatch, null, 1));
fs.writeFileSync(path.join(DATA, 'dictionary.json'), JSON.stringify(dict));
fs.writeFileSync(path.join(DATA, 'rules.json'), JSON.stringify(rules, null, 1));
if (!fs.existsSync(path.join(DATA, 'ui-fixes.css'))) fs.writeFileSync(path.join(DATA, 'ui-fixes.css'), '');

console.log('i18nPatch keys:', Object.keys(i18nPatch).length);
console.log('dict entries:', Object.keys(dict).length);
console.log('LLM/seed translations:', trans.size, '| review fixes:', fixes.size);
if (problems.length) console.log('PROBLEMS:', problems);
