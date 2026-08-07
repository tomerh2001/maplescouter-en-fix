#!/usr/bin/env node
/*
 * Rebuilds the full translation corpus from the CURRENT live site.
 * Durable replacement for the /tmp pipeline that got wiped.
 * Outputs (all under work/):
 *   chunks/            downloaded JS chunks
 *   en.json ko.json    current locale tables
 *   official_map.json  KO→EN from game-data ID join (needs gamedata/ — see rebuild-gamedata.sh)
 *   corpus_official.json / corpus_left.json / llm_corpus.json
 *   batches/           translation + review batches (recovered strings excluded)
 *   seeds.json         recovered translations still valid for the current corpus
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = __dirname;
const CH = path.join(W, 'chunks');
fs.mkdirSync(CH, { recursive: true });

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28 });
const get = (url, out) => sh(`curl -sL --max-time 60 "${url}" -o "${out}"`);

// ---------- 1. homepage + webpack runtime ----------
console.log('== fetching homepage');
get('https://maplescouter.com', path.join(W, 'home.html'));
const home = fs.readFileSync(path.join(W, 'home.html'), 'utf8');
const chunkRefs = new Set([...home.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map(m => m[0]));
const webpackRef = [...chunkRefs].find(c => /webpack-/.test(c));
console.log('homepage chunks:', chunkRefs.size, 'runtime:', webpackRef);

// ---------- 2. routes ----------
// crawl using the previously discovered route list + rediscover from chunks later
const ROUTES = ['/', '/base', '/battle-ranking', '/boss-data', '/boss-income', '/challenge', '/challenge_2', '/challenge_3', '/coordination', '/cube-fire', '/destiny', '/destiny-ranking', '/dojo-data', '/donate', '/exp/daily-quest', '/exp/event', '/exp/item', '/exp/monster', '/exp/total', '/exp/treasure-hunter', '/exp/weekly-quest', '/game/bulls-and-cows', '/game/draw', '/game/ladder', '/game/roulette', '/game/stop-watch', '/genesis', '/guide', '/hall-of-fame', '/hexa', '/hexa-preview', '/hexpago', '/hunt/optimizer', '/huntresult', '/info', '/input', '/item', '/item-ranking', '/lucid', '/multi-result', '/mypage', '/octopus', '/optimizer', '/profile-motion', '/punchking-season3', '/quick-link', '/ranking', '/ranking-analysis', '/result', '/simulator/cube', '/simulator/cube-additional', '/simulator/fire', '/simulator/starforce', '/simulator/whetstone', '/sitemap', '/spec-order', '/starforce', '/tax', '/timeattack', '/total-ranking', '/union-champion', '/union-character', '/union-ranking'];

console.log('== crawling', ROUTES.length, 'routes');
const routeMap = {};
for (const r of ROUTES) {
  try {
    const html = sh(`curl -sL --max-time 20 "https://maplescouter.com/en${r === '/' ? '' : r}"`);
    for (const m of html.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)) chunkRefs.add(m[0]);
    const pages = [...html.matchAll(/chunks\/app\/[^"]*?(page-[a-f0-9]+\.js)/g)];
    if (pages.length) routeMap[pages[pages.length - 1][1]] = r;
  } catch (e) { console.log('  route fail', r); }
}
fs.writeFileSync(path.join(W, 'route_map.json'), JSON.stringify(routeMap, null, 1));

// ---------- 3. download chunks ----------
console.log('== downloading', chunkRefs.size, 'chunks');
for (const c of chunkRefs) {
  const base = decodeURIComponent(c.split('/').pop());
  const f = path.join(CH, base);
  if (!fs.existsSync(f)) { try { get('https://maplescouter.com' + c, f); } catch (e) {} }
}

// ---------- 4. locale tables (dynamic discovery) ----------
console.log('== locating locale chunks');
let ctxMap = null;
for (const f of fs.readdirSync(CH)) {
  const src = fs.readFileSync(path.join(CH, f), 'utf8');
  const m = src.match(/\{"\.\/ch\/common\.json":\[(\d+),(\d+)\],"\.\/en\/common\.json":\[(\d+),(\d+)\],"\.\/ja\/common\.json":\[(\d+),(\d+)\],"\.\/ko\/common\.json":\[(\d+),(\d+)\]\}/);
  if (m) { ctxMap = { en: { mod: +m[3], chunk: +m[4] }, ko: { mod: +m[7], chunk: +m[8] } }; break; }
}
if (!ctxMap) throw new Error('locale context module not found');
console.log('locale modules:', JSON.stringify(ctxMap));

const runtimeSrc = fs.readFileSync(path.join(CH, decodeURIComponent(webpackRef.split('/').pop())), 'utf8');
const uMatch = runtimeSrc.match(/"static\/chunks\/"\+e\+"\."\+\(?(\{[^}]+\})\)?\[e\]\+"\.js"/) || runtimeSrc.match(/static\/chunks\/"\+e\+"\."\+\((\{[^}]+\})\)\[e\]/);
if (!uMatch) throw new Error('webpack r.u map not found');
const hashMap = eval('(' + uMatch[1] + ')');
console.log('async chunk map:', JSON.stringify(hashMap));

for (const [loc, info] of Object.entries(ctxMap)) {
  const hash = hashMap[info.chunk];
  if (!hash) throw new Error('no hash for chunk ' + info.chunk);
  get(`https://maplescouter.com/_next/static/chunks/${info.chunk}.${hash}.js`, path.join(CH, loc + '-common.js'));
}

function extractTable(file) {
  const src = fs.readFileSync(path.join(CH, file), 'utf8');
  const m = src.match(/JSON\.parse\('([\s\S]*)'\)\}\}\]\)/);
  return eval("JSON.parse('" + m[1] + "')");
}
const en = extractTable('en-common.js');
const ko = extractTable('ko-common.js');
fs.writeFileSync(path.join(W, 'en.json'), JSON.stringify(en, null, 1));
fs.writeFileSync(path.join(W, 'ko.json'), JSON.stringify(ko, null, 1));

function flatten(d, p = '') { const o = {}; for (const [k, v] of Object.entries(d)) { const key = p ? p + '.' + k : k; if (v && typeof v === 'object') Object.assign(o, flatten(v, key)); else o[key] = v; } return o; }
const enKeys = new Set(Object.keys(flatten(en)));
const koKeys = new Set(Object.keys(flatten(ko)));
console.log('EN keys:', enKeys.size, 'KO keys:', koKeys.size);

// ---------- 5. Korean literal extraction ----------
console.log('== extracting Korean literals');
const hangulG = /[가-힣]/g;
const CODE_MARKERS = /=>|function\(|className|webpackChunk|void 0|!0\b|\(0,|px-|bg-|focus-visible|weaponConstant|dpm_|self\.__next|,o=\{|:\.\d|\\n\s*at |data-slot/;
const found = new Map();
for (const f of fs.readdirSync(CH)) {
  if (['en-common.js', 'ko-common.js'].includes(f)) continue;
  const src = fs.readFileSync(path.join(CH, f), 'utf8');
  const re = /"((?:[^"\\\n]|\\.){1,300}?)"|'((?:[^'\\\n]|\\.){1,300}?)'/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] ?? m[2];
    if (!/[가-힣]/.test(raw) || CODE_MARKERS.test(raw)) continue;
    let s;
    try { s = JSON.parse('"' + raw.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"') + '"'); } catch (e) { continue; }
    if (!/[가-힣]/.test(s) || s.length > 250) continue;
    const h = (s.match(hangulG) || []).length;
    if (h / s.length < 0.15) continue;
    if (!found.has(s)) found.set(s, new Set());
    found.get(s).add(f);
  }
}
console.log('clean literals:', found.size);

const untr = [...found.keys()].filter(s => !enKeys.has(s));
fs.writeFileSync(path.join(W, 'untranslated.json'), JSON.stringify(untr.map(s => ({ s, files: [...found.get(s)].slice(0, 4) })), null, 1));

// normalize + clean punctuation wrappers
const bases = new Map();
for (const s of untr) {
  let b = s.replace(/\s*[×x]\s*[\d,]+$/, '').trim();
  b = b.replace(/^[,{}():;=\s'"\]\[]+|[,{}():;=\s'"\]\[]+$/g, '');
  if (!/[가-힣]/.test(b)) continue;
  if (!bases.has(b)) bases.set(b, new Set());
  found.get(s).forEach(f => bases.get(b).add(f));
}
console.log('unique bases:', bases.size);

// ---------- 6. official join ----------
const G = path.join(W, 'gamedata');
const official = new Map();
function joinSet(kmsFile, gmsFile) {
  if (!fs.existsSync(path.join(G, kmsFile)) || !fs.existsSync(path.join(G, gmsFile))) return;
  const kms = JSON.parse(fs.readFileSync(path.join(G, kmsFile), 'utf8'));
  const gms = JSON.parse(fs.readFileSync(path.join(G, gmsFile), 'utf8'));
  const g = new Map(gms.map(x => [x.id, x]));
  for (const k of kms) {
    const gg = g.get(k.id);
    if (!gg) continue;
    if (k.name && gg.name && k.name !== gg.name && !official.has(k.name)) official.set(k.name, gg.name);
    if (k.streetName && gg.streetName && k.streetName !== gg.streetName && !official.has(k.streetName)) official.set(k.streetName, gg.streetName);
  }
}
joinSet('kms_mob.json', 'gms_mob.json');
joinSet('kms_map.json', 'gms_map.json');
const kmsItems = [], gmsItems = [];
for (const f of fs.readdirSync(G)) {
  if (/^kms_item/.test(f)) kmsItems.push(...JSON.parse(fs.readFileSync(path.join(G, f), 'utf8')));
  if (/^gms_item/.test(f)) gmsItems.push(...JSON.parse(fs.readFileSync(path.join(G, f), 'utf8')));
}
{
  const g = new Map(gmsItems.map(x => [x.id, x.name]));
  for (const k of kmsItems) { const en2 = g.get(k.id); if (en2 && k.name && en2 !== k.name && !official.has(k.name)) official.set(k.name, en2); }
}
console.log('official pairs:', official.size);
fs.writeFileSync(path.join(W, 'official_map.json'), JSON.stringify([...official.entries()]));

// ---------- 7. seeds from recovered run ----------
const seeds = new Map();
const REC = path.join(W, 'recovered');
if (fs.existsSync(REC)) {
  for (const f of fs.readdirSync(REC)) {
    try { for (const e of JSON.parse(fs.readFileSync(path.join(REC, f), 'utf8'))) if (e && e.ko && e.en) seeds.set(e.ko, e); } catch (err) {}
  }
}
console.log('recovered seeds:', seeds.size);

// ---------- 8. classification + batches ----------
const routeMapNow = routeMap;
const matched = [], leftItems = [], seeded = [];
for (const [b, files] of bases) {
  if (official.has(b)) { matched.push([b, official.get(b)]); continue; }
  if (seeds.has(b)) { seeded.push(seeds.get(b)); continue; }
  const ctx = [...files].map(f => routeMapNow[f] || null).filter(Boolean);
  leftItems.push({ s: b, ctx: [...new Set(ctx)].slice(0, 3) });
}
// KO-only i18n keys still missing from EN
const missingKeys = [...koKeys].filter(k => !enKeys.has(k));
for (const k of missingKeys) if (!seeds.has(k) && !official.has(k)) leftItems.push({ s: k, ctx: ['i18n-key'] });

console.log('official-matched:', matched.length, '| seeded (recovered):', seeded.length, '| need translation:', leftItems.length);
fs.writeFileSync(path.join(W, 'corpus_official.json'), JSON.stringify(matched, null, 1));
fs.writeFileSync(path.join(W, 'seeds.json'), JSON.stringify(seeded, null, 1));

const buckets = { skill: [], item: [], sentence: [], ui: [] };
for (const it of leftItems) {
  const s = it.s;
  if (s.length > 45 || /(니다|세요|하세요|됩니다|입니다|주세요|바랍니다)[.!?]?$|[.?!]$/.test(s)) buckets.sentence.push(it);
  else if (/VI$|VI\/| VI |강화$|스킬|어택|서먼|매트릭스|참$|베기$|일섬/.test(s)) buckets.skill.push(it);
  else if (/(상자|조각|기운|흔적|반지|훈장|장신구|방어구|무기|모자|장갑|신발|망토|견장|벨트|목걸이|귀고리|얼굴장식|눈장식|펜던트|주문서|물약|비약|정수|결정|보석|해머|큐브|불꽃|응축물|영약|편린|고리|결의|의지|엠블렘|뱃지)/.test(s)) buckets.item.push(it);
  else buckets.ui.push(it);
}
const B = path.join(W, 'batches');
fs.rmSync(B, { recursive: true, force: true });
fs.mkdirSync(B, { recursive: true });
const manifest = [];
function split(arr, size, bucket) {
  for (let i = 0; i < arr.length; i += size) {
    const b = arr.slice(i, i + size);
    fs.writeFileSync(path.join(B, `trans_${bucket}_${i / size}.json`), JSON.stringify(b, null, 1));
    manifest.push({ bucket, idx: i / size, count: b.length });
  }
}
split(buckets.skill, 40, 'skill');
split(buckets.item, 60, 'item');
split(buckets.sentence, 65, 'sentence');
split(buckets.ui, 90, 'ui');

// review batches (existing EN pairs)
const fe = flatten(en);
const pairs = Object.entries(fe).map(([k, v]) => ({ k, v }));
let rcount = 0;
for (let i = 0; i < pairs.length; i += 150) {
  fs.writeFileSync(path.join(B, `review_${i / 150}.json`), JSON.stringify(pairs.slice(i, i + 150), null, 1));
  rcount++;
}
// seed-verification batches (recovered translations must still be verified)
let scount = 0;
for (let i = 0; i < seeded.length; i += 120) {
  fs.writeFileSync(path.join(B, `seedver_${i / 120}.json`), JSON.stringify(seeded.slice(i, i + 120), null, 1));
  scount++;
}
fs.writeFileSync(path.join(W, 'manifest.json'), JSON.stringify({ trans: manifest, reviewCount: rcount, seedverCount: scount }, null, 1));
console.log('batches:', JSON.stringify({ skill: buckets.skill.length, item: buckets.item.length, sentence: buckets.sentence.length, ui: buckets.ui.length, reviewBatches: rcount, seedverBatches: scount }));
console.log('trans batches:', manifest.map(m => `${m.bucket}_${m.idx}(${m.count})`).join(' '));
