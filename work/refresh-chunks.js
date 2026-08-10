#!/usr/bin/env node
/* Refreshes work/chunks + locale tables from the CURRENT live site (crawl only —
   no batch splitting; run extract2.js <generation> afterwards for the delta). */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = __dirname;
const CH = path.join(W, 'chunks');
fs.mkdirSync(CH, { recursive: true });
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28 });
const get = (url, out) => sh(`curl -sL --max-time 60 "${url}" -o "${out}"`);

console.log('== homepage');
get('https://maplescouter.com', path.join(W, 'home.html'));
const home = fs.readFileSync(path.join(W, 'home.html'), 'utf8');
const chunkRefs = new Set([...home.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map(m => m[0]));
const webpackRef = [...chunkRefs].find(c => /webpack-/.test(c));

const ROUTES = JSON.parse(fs.readFileSync(path.join(W, 'route_map.json'), 'utf8'));
const routeList = [...new Set(Object.values(ROUTES))];
routeList.push('/', '/input', '/result', '/boss-data', '/hexa', '/starforce');
console.log('== crawling', routeList.length, 'routes');
const routeMap = { ...ROUTES };
for (const r of [...new Set(routeList)]) {
  try {
    const html = sh(`curl -sL --max-time 20 "https://maplescouter.com/en${r === '/' ? '' : r}"`);
    for (const m of html.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)) chunkRefs.add(m[0]);
    const pages = [...html.matchAll(/chunks\/app\/[^"]*?(page-[a-f0-9]+\.js)/g)];
    if (pages.length) routeMap[pages[pages.length - 1][1]] = r;
  } catch (e) { console.log('  fail', r); }
}
fs.writeFileSync(path.join(W, 'route_map.json'), JSON.stringify(routeMap, null, 1));

console.log('== downloading chunks');
let fresh = 0;
for (const c of chunkRefs) {
  const base = decodeURIComponent(c.split('/').pop());
  const f = path.join(CH, base);
  if (!fs.existsSync(f)) { try { get('https://maplescouter.com' + c, f); fresh++; } catch (e) {} }
}
console.log('new chunk files:', fresh, '| total:', fs.readdirSync(CH).length);

// locale tables (dynamic discovery — hashes change every deploy)
let ctxMap = null;
for (const f of fs.readdirSync(CH)) {
  const src = fs.readFileSync(path.join(CH, f), 'utf8');
  const m = src.match(/\{"\.\/ch\/common\.json":\[(\d+),(\d+)\],"\.\/en\/common\.json":\[(\d+),(\d+)\],"\.\/ja\/common\.json":\[(\d+),(\d+)\],"\.\/ko\/common\.json":\[(\d+),(\d+)\]\}/);
  if (m) { ctxMap = { en: { chunk: +m[4] }, ko: { chunk: +m[8] } }; break; }
}
if (!ctxMap) throw new Error('locale context module not found');
const runtimeSrc = fs.readFileSync(path.join(CH, decodeURIComponent(webpackRef.split('/').pop())), 'utf8');
const uMatch = runtimeSrc.match(/"static\/chunks\/"\+e\+"\."\+\(?(\{[^}]+\})\)?\[e\]\+"\.js"/) || runtimeSrc.match(/static\/chunks\/"\+e\+"\."\+\((\{[^}]+\})\)\[e\]/);
const hashMap = eval('(' + uMatch[1] + ')');
for (const [loc, info] of Object.entries(ctxMap)) {
  get(`https://maplescouter.com/_next/static/chunks/${info.chunk}.${hashMap[info.chunk]}.js`, path.join(CH, loc + '-common.js'));
}
function extractTable(file) {
  const src = fs.readFileSync(path.join(CH, file), 'utf8');
  const m = src.match(/JSON\.parse\('([\s\S]*)'\)\}\}\]\)/);
  return eval("JSON.parse('" + m[1] + "')");
}
fs.writeFileSync(path.join(W, 'en.json'), JSON.stringify(extractTable('en-common.js'), null, 1));
fs.writeFileSync(path.join(W, 'ko.json'), JSON.stringify(extractTable('ko-common.js'), null, 1));
console.log('locale tables refreshed');
