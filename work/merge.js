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
  const m = f.match(/^(trans|delta[0-9]*)_([a-z]+)_(\d+)\.json$/);
  if (!m) continue;
  const finName = f;
  const preName = m[1] === 'trans' ? `pre_${m[2]}_${m[3]}.json` : `${m[1].replace('delta', 'dpre')}_${m[2]}_${m[3]}.json`;
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
// user-rejected review fixes: the site's "HEXA" label for 스펙 is intentional
// (the column shows the HEXA-equivalent stat) — keep it.
const DROP_FIXES = new Set(['스펙']);
const fixes = new Map();
const fixList = [];
for (let i = 0; i < manifest.reviewCount; i++) {
  const fin = loadArr(path.join(OUT, `review_${i}.json`));
  const pre = loadArr(path.join(OUT, `prefix_${i}.json`));
  const arr = (fin && fin.length) ? fin : (pre && pre.length ? pre : null);
  if (!arr) { problems.push('review_' + i + ' empty/none'); continue; }
  if (!(fin && fin.length)) problems.push('review_' + i + ' using unvalidated prefix');
  for (const e of arr) {
    if (e && typeof e.ko === 'string' && typeof e.proposed === 'string' && e.proposed.trim() && !DROP_FIXES.has(e.ko)) {
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
// player/author nicknames that leaked into the corpus as code literals — never translate
const NICKNAMES = ['고마오', '으낭다', '예띰', '비숍링크부들'];
for (const n of NICKNAMES) { delete i18nPatch[n]; }

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
// EN→EN fallback entries (only used if the bundle patch fails). Skip generic terms
// that legitimately appear as other labels — rewriting them would mislabel those.
const EN_FIX_BLACKLIST = new Set(['Boss Damage', 'HEXA', 'Damage', 'Critical Rate', 'Critical Damage', 'Final Damage', 'ATT', 'M.ATT']);
for (const e of fixList) {
  const cur = e.current, prop = e.proposed;
  if (cur && prop && cur !== prop && cur.length <= 40 && !/[{}]/.test(cur) && !hangul.test(cur) && !EN_FIX_BLACKLIST.has(cur)) dict[cur] = prop;
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
  // page-title variants (server-rendered metadata uses spaced forms)
  '아이템 메이커': 'Item Maker',
  '내실 메이커': 'Foundation Maker',
  // badge-legend variants that render WITH the closing paren (extraction captured them without)
  '20분 실측 배율(마우스 호버 시 갱신 내용 확인)': 'Measured 20-min multiplier (hover to view update details)',
  '보스 배율 변경(마우스 호버 시 갱신 내용 확인)': 'Boss multiplier changed (hover to view update details)',
  // hexa page (site strings newer than the corpus snapshot)
  '다른 기준으로 보기': 'Change Criteria',
  // HEXA node icon alt text (API-driven skill names; icons sometimes fail to load)
  '프리드의 가호': "Freud's Wisdom",
  // boss burst-window popup
  '페이즈별 극딜 횟수(20분 기준)': 'Burst windows per phase (20-min basis)',
  '극딜': 'Full Burst',
  '준극딜': 'Semi Burst',
  '어센': 'Ascent',
  '추천 템환산': 'Recommended Item Equiv.',
  // hexa tooltip fragments (split across styled spans, matched trimmed)
  '기운': 'Energy',
  '개, 조각': ', Fragments',
  '개 필요': ' needed',
  '강화 시 헥환 :': 'HEXA stat gain :',
  '헥환': 'HEXA stat',
  '현재 강화 대비(누적)': 'vs. current enhancement (cumulative)',
  '100억 당 최종뎀': 'FD per 10B mesos',
  '효율': 'Efficiency',
};
for (const [k, v] of Object.entries(MANUAL)) if (!dict[k]) dict[k] = v;

// hard overrides (user-requested wording) — applied to BOTH layers, win over everything
const OVERRIDES = {
  // input-page weapon state toggles: 해방 = Genesis weapon liberated, 최초의 유산 = Destiny weapon liberated
  '해방': 'Genesis Liberated',
  '최초의 유산': 'Destiny Liberated',
  // top-nav labels: English was too wide and collided with the header search box
  '분석&최적화': 'Analysis',
  '랭킹&챌린지': 'Rankings',
  '정보센터': 'Info Center',
  // stat-form labels: full official names, no abbreviations or extra qualifiers
  '공격력': 'Attack Power',
  '마력': 'Magic Attack',
  '전투시 크확': 'Critical Rate',
  '크확 수치': 'Critical Rate',
  '보총뎀': 'Boss Damage + Damage',
  '보공': 'Boss Damage',
  '보뎀': 'Boss Damage',
  '방무': 'IED',
  '방무%': 'IED %',
  '방무(300)': 'IED (300)',
  '방무(380)': 'IED (380)',
  '직접 입력': 'Manual Input',
  // boss viability badges: compact single-line forms (full meaning goes into a
  // hover tooltip added by the userscript)
  '6인 최소컷': '6 Players',
  '4인 최소컷': '4 Players',
  '3인 최소컷': '3 Players',
  '2인 최소컷': '2 Players',
  '격수 3인 최소컷': '3 DPS',
  '숍+격수2인 최소컷': '2 Players + B',
  '솔플 최소컷': 'Soloable-',
  '파티 최소컷': 'Partyable-',
  '솔플 가능': 'Soloable',
  '파티격 가능': 'Partyable',
  '솔플 여유컷': 'Soloable+',
  '입장 불가능': 'N/A',
  // compact party-percentage label on boss cards (bracketed form wrapped badly)
  '[파티]': 'Party',
};
for (const [k, v] of Object.entries(OVERRIDES)) { dict[k] = v; i18nPatch[k] = v; }
for (const n of NICKNAMES) { delete dict[n]; }
// the site's DEMO characters appear in prose ("User Info: ... / 으낭다") — romanize
// those two names for English readers; real player IGNs stay untouched.
dict['고마오'] = 'Gomao';
dict['으낭다'] = 'Eunangda';
// also fix any English strings already rendered by the site's own table
dict['Liberation'] = 'Genesis Liberated';
dict['First Legacy'] = 'Destiny Liberated';
dict['Analysis / Optimization'] = 'Analysis';
dict['Analysis&Optimization'] = 'Analysis';
dict['Ranking&Challenge'] = 'Rankings';
dict['Information Center'] = 'Info Center';
dict['M.Attack'] = 'Magic Attack';
dict['M.ATT'] = 'Magic Attack';
dict['Crit Rate (In Combat)'] = 'Critical Rate';
dict['Boss Dmg + Dmg%'] = 'Boss Damage + Damage';
dict['Ignore guard'] = 'IED';
dict['Ignore Dff(300)'] = 'IED (300)';
dict['Ignore Dff(380)'] = 'IED (380)';
// compact seconds unit for the inline cooldown field (en.json fold says 'Second')
dict['초'] = 's';
i18nPatch['초'] = 's';
dict['Manual Input (Character Stats)'] = 'Manual Input';
dict['Enter Directly (Character Stats Changes)'] = 'Manual Input';
for (const [oldV, newV] of [
  ['6-Player Min Spec', '6 Players'], ['6P Min', '6 Players'],
  ['4-Player Min Spec', '4 Players'], ['4P Min', '4 Players'],
  ['3-Player Min Spec', '3 Players'], ['3P Min', '3 Players'],
  ['2-Player Min Spec', '2 Players'], ['2P Min', '2 Players'],
  ['3-DPS Min Spec', '3 DPS'], ['3-DPS Min', '3 DPS'],
  ['Bishop + 2 DPS Min Spec', '2 Players + B'], ['Bish+2 Min', '2 Players + B'],
  ['Solo Min Spec', 'Soloable-'], ['Solo Min', 'Soloable-'],
  ['Party Min Spec', 'Partyable-'], ['Party Min', 'Partyable-'],
  ['Solo Viable', 'Soloable'], ['Solo OK', 'Soloable'],
  ['Party Viable', 'Partyable'], ['Party OK', 'Partyable'],
  ['Solo Comfort Spec', 'Soloable+'], ['Comfy Solo', 'Soloable+'],
  ["Can't Enter", 'N/A'],
]) dict[oldV] = newV;

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

// Final forced overrides (win over everything; applied after cleanup). User-chosen wording.
const FORCE = {
  // v1.5.1: the page is a character workspace now (picker + cloud), not a bare form.
  '직접 입력': 'Character',
  '직접입력': 'Character',
  '수기 입력 결과': 'Character Result',
  '수기 입력 결과가 없습니다': 'No character result yet',

  // 내실 → "Core Skills" (user preference over "Foundation"), kept consistent everywhere
  '내실': 'Core Skills',
  '내실메이커': 'Core Skills Maker',
  '내실 메이커': 'Core Skills Maker',
  '내실 메이커 종류': 'Core Skills Maker Type',
  '캐릭터 내실 보기': 'View Character Core Skills',
  '내실 변경': 'Change Core Skills (6th Job/Oz Rings)',
  '보스 스펙 시뮬레이터에서 사용 가능한 내실 커스텀 제작 제공': 'Create custom Core Skills setups usable in the boss spec simulator',
  // shortened cooldown field label
  '기타 쿨감(%)(하이퍼 등)': 'Other CD Reduction sources',
  // potential/flame option lines: current-option marker "Cur" → "Curr"
  '보유옵션': 'Curr',
  // drop the "main, " qualifier from the re-measurement note
  '보스컷 갱신 시점 : 여름/겨울 업데이트 시작시점(메인, 재측정 수준), 그 외 스펙인플레(인플레만큼 기존컷 보정) 등':
    'Boss Clear Spec update timing: at the start of the summer/winter updates (effectively a full re-measurement), plus spec inflation and similar (existing specs adjusted by the inflation amount)',
  // "the Boss Clear Spec" → "an adjusted Boss Clear Spec"
  '버튼을 눌러 보스컷을 확인하시기 바랍니다.': 'button. Press it to view an adjusted Boss Clear Spec.',
};
for (const [k, v] of Object.entries(FORCE)) { dict[k] = v; i18nPatch[k] = v; }
// also override the site's own en.json values (rendered via i18next) if the keys differ there
i18nPatch['내실메이커'] = 'Core Skills Maker';
i18nPatch['내실'] = 'Core Skills';

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'i18n-patch.json'), JSON.stringify(i18nPatch, null, 1));
fs.writeFileSync(path.join(DATA, 'dictionary.json'), JSON.stringify(dict));
fs.writeFileSync(path.join(DATA, 'rules.json'), JSON.stringify(rules, null, 1));
if (!fs.existsSync(path.join(DATA, 'ui-fixes.css'))) fs.writeFileSync(path.join(DATA, 'ui-fixes.css'), '');

console.log('i18nPatch keys:', Object.keys(i18nPatch).length);
console.log('dict entries:', Object.keys(dict).length);
console.log('LLM/seed translations:', trans.size, '| review fixes:', fixes.size);
if (problems.length) console.log('PROBLEMS:', problems);
