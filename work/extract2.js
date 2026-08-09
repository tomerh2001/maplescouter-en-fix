#!/usr/bin/env node
/* AST-based Korean literal extraction (fixes the regex quote-parity bug). */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const W = __dirname;
const CH = path.join(W, 'chunks');
const hangulG = /[가-힣]/g;

const found = new Map(); // string -> Set(files)
let parseFails = [];
for (const f of fs.readdirSync(CH)) {
  if (['en-common.js', 'ko-common.js'].includes(f)) continue;
  const src = fs.readFileSync(path.join(CH, f), 'utf8');
  let strings = [];
  try {
    const comments = [];
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n.type === 'Literal' && typeof n.value === 'string') strings.push(n.value);
      else if (n.type === 'TemplateElement' && n.value && typeof n.value.cooked === 'string') strings.push(n.value.cooked);
      for (const k of Object.keys(n)) { if (k === 'loc' || k === 'range') continue; const v = n[k]; if (v && typeof v === 'object') walk(v); }
    })(ast);
  } catch (e) {
    parseFails.push(f + ': ' + e.message.slice(0, 60));
    continue;
  }
  for (const s of strings) {
    if (!/[가-힣]/.test(s) || s.length > 250) continue;
    const h = (s.match(hangulG) || []).length;
    if (h / s.length < 0.15) continue;
    if (!found.has(s)) found.set(s, new Set());
    found.get(s).add(f);
  }
}
console.log('AST-extracted Korean literals:', found.size, '| parse failures:', parseFails.length);
if (parseFails.length) console.log(parseFails.slice(0, 5));

// ---- what's already covered? ----
function flatten(d, p = '') { const o = {}; for (const [k, v] of Object.entries(d)) { const key = p ? p + '.' + k : k; if (v && typeof v === 'object') Object.assign(o, flatten(v, key)); else o[key] = v; } return o; }
const enKeys = new Set(Object.keys(flatten(JSON.parse(fs.readFileSync(path.join(W, 'en.json'), 'utf8')))));
const official = new Map(JSON.parse(fs.readFileSync(path.join(W, 'official_map.json'), 'utf8')));

const covered = new Set();
const OUT = path.join(W, 'out');
for (const f of fs.readdirSync(OUT)) {
  if (!/^(trans_|seedver_|pre_)/.test(f)) continue;
  try { for (const e of JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) if (e && e.ko) covered.add(e.ko); } catch (err) {}
}
console.log('already translated (workflow outputs):', covered.size);

const routeMap = JSON.parse(fs.readFileSync(path.join(W, 'route_map.json'), 'utf8'));
const CODE_JUNKISH = /^[,{}():;=\s'"\]\[]+$/;

const newOfficial = [];
const delta = [];
const allUntranslated = [];
for (const [s, files] of found) {
  if (enKeys.has(s)) continue;
  allUntranslated.push({ s, files: [...files].slice(0, 4) });
  let b = s.replace(/\s*[×x]\s*[\d,]+$/, '').trim();
  b = b.replace(/^[,{}():;=\s'"]+|[,{}():;=\s'"]+$/g, '');
  if (!/[가-힣]/.test(b)) continue;
  if (covered.has(b) || covered.has(s)) continue;
  if (official.has(b)) { newOfficial.push([b, official.get(b)]); continue; }
  const ctx = [...files].map(f2 => routeMap[f2] || null).filter(Boolean);
  delta.push({ s: b, ctx: [...new Set(ctx)].slice(0, 3) });
}
// dedupe delta by base
const seen = new Set();
const deltaU = delta.filter(d => !seen.has(d.s) && seen.add(d.s));
const seenOff = new Set();
const newOfficialU = newOfficial.filter(([k]) => !seenOff.has(k) && seenOff.add(k));

fs.writeFileSync(path.join(W, 'untranslated.json'), JSON.stringify(allUntranslated, null, 1));
// merge new official pairs into corpus_official
const prevOff = JSON.parse(fs.readFileSync(path.join(W, 'corpus_official.json'), 'utf8'));
const offMap = new Map([...prevOff, ...newOfficialU]);
fs.writeFileSync(path.join(W, 'corpus_official.json'), JSON.stringify([...offMap.entries()], null, 1));

console.log('total untranslated (AST):', allUntranslated.length);
console.log('newly official-matched:', newOfficialU.length, '| DELTA needing translation:', deltaU.length);

// ---- delta batches ----
const B = path.join(W, 'batches');
const buckets = { skill: [], item: [], sentence: [], ui: [] };
for (const it of deltaU) {
  const s = it.s;
  if (s.length > 45 || /(니다|세요|하세요|됩니다|입니다|주세요|바랍니다)[.!?]?$|[.?!]$/.test(s)) buckets.sentence.push(it);
  else if (/VI$|VI\/| VI |강화$|스킬|어택|서먼|매트릭스|참$|베기$|일섬/.test(s)) buckets.skill.push(it);
  else if (/(상자|조각|기운|흔적|반지|훈장|장신구|방어구|무기|모자|장갑|신발|망토|견장|벨트|목걸이|귀고리|얼굴장식|눈장식|펜던트|주문서|물약|비약|정수|결정|보석|해머|큐브|불꽃|응축물|영약|편린|고리|결의|의지|엠블렘|뱃지)/.test(s)) buckets.item.push(it);
  else buckets.ui.push(it);
}
let deltaBatches = [];
for (const [bucket, arr] of Object.entries(buckets)) {
  const size = bucket === 'ui' ? 90 : 65;
  for (let i = 0; i < arr.length; i += size) {
    const name = `delta_${bucket}_${i / size}.json`;
    fs.writeFileSync(path.join(B, name), JSON.stringify(arr.slice(i, i + size), null, 1));
    deltaBatches.push({ bucket, idx: i / size, count: Math.min(size, arr.length - i) });
  }
}
const man = JSON.parse(fs.readFileSync(path.join(W, 'manifest.json'), 'utf8'));
man.delta = deltaBatches;
fs.writeFileSync(path.join(W, 'manifest.json'), JSON.stringify(man, null, 1));
console.log('delta batches:', JSON.stringify(deltaBatches));
