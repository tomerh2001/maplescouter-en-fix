#!/usr/bin/env node
/* Crawl the live build only. Historical chunks stay cached but never select its locales.
   Use argument-free curl calls, bounded concurrency and AST decoding, not eval. */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const acorn = require('../scripts/audit/node_modules/acorn');
const run = promisify(execFile), W = __dirname, CH = path.join(W, 'chunks');
const origin = 'https://maplescouter.com';
const refs = html => [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"\\\s<>]+?\.js/g)].map(m => m[0]))];
function walk(n, fn) { if (!n || typeof n !== 'object') return; if (n.type) fn(n); for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(x => walk(x, fn)); else if (v && typeof v === 'object') walk(v, fn); }
function literals(src, visit) { walk(acorn.parse(src, {ecmaVersion:'latest'}), visit); }
async function get(url) { return (await run('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '25', url], {maxBuffer: 32 << 20})).stdout; }
async function pool(list, fn, size = 4) { let i = 0; await Promise.all(Array.from({length:size}, async () => { while (i < list.length) await fn(list[i++]); })); }
async function main() {
  fs.mkdirSync(CH, {recursive:true});
  const previousFiles = fs.readdirSync(CH);
  const oldMap = fs.existsSync(path.join(W,'route_map.json')) ? JSON.parse(fs.readFileSync(path.join(W,'route_map.json'))) : {};
  const pages = {}, chunks = new Set(), routeMap = {}, failures = [];
  const home = await get(origin+'/en');
  fs.writeFileSync(path.join(W,'home.html'),home);
  const routes = new Set(['/', '/sitemap', '/input', '/result', '/hexa', '/starforce', '/boss-data', ...Object.values(oldMap)]);
  for (const m of home.matchAll(/href="\/en(\/[^"?#]*)?/g)) routes.add(m[1] || '/');
  async function page(route) {
    if (!/^\/[a-z0-9/-]*$/i.test(route)) return;
    try {
      const html = route==='/' ? home : await get(origin+'/en'+route);
      const current = refs(html); if (!current.length) throw new Error('No application chunks');
      pages[route] = current;
      current.forEach(c => chunks.add(c));
      for (const c of current) if (/\/page-/.test(c)) routeMap[c.split('/').pop()] = route;
      if (route==='/sitemap') for (const m of html.matchAll(/href="\/en(\/[^"?#]*)?/g)) routes.add(m[1] || '/');
    } catch(e) { failures.push({route,error:e.message.split('\n')[0]}); }
  }
  await page('/sitemap');
  console.log('Crawling', routes.size, 'current routes');
  await pool([...routes].filter(r=>r!=='/sitemap'), page);
  const active = [...chunks]; let fresh = 0;
  await pool(active, async ref => {
    const file=path.join(CH, decodeURIComponent(ref.split('/').pop()));
    if (!fs.existsSync(file)) { fs.writeFileSync(file,await get(origin+ref)); fresh++; }
  });
  const runtimeRef = active.find(c=>/webpack-/.test(c));
  if (!runtimeRef) throw new Error('No webpack runtime in live pages');
  let localeIds;
  for (const ref of active) {
    const src=fs.readFileSync(path.join(CH,decodeURIComponent(ref.split('/').pop())),'utf8');
    if (!src.includes('./en/common.json')) continue;
    literals(src,n=>{
      if(n.type!=='ObjectExpression') return;
      const pairs=n.properties.filter(p=>p.key?.value && p.value?.type==='ArrayExpression');
      const en=pairs.find(p=>p.key.value==='./en/common.json'), ko=pairs.find(p=>p.key.value==='./ko/common.json');
      if(en&&ko) localeIds={en:en.value.elements[1].value,ko:ko.value.elements[1].value};
    });
  }
  if(!localeIds) throw new Error('No locale context in active chunks');
  const hashes={};
  literals(fs.readFileSync(path.join(CH,runtimeRef.split('/').pop()),'utf8'),n=>{
    if(n.type==='Property' && Object.values(localeIds).includes(Number(n.key.value)) && typeof n.value?.value==='string' && /^[a-f0-9]{8,}$/.test(n.value.value)) hashes[n.key.value]=n.value.value;
  });
  for(const [loc,id] of Object.entries(localeIds)) {
    if(!hashes[id]) throw new Error('Missing locale hash: '+loc);
    const ref=`/_next/static/chunks/${id}.${hashes[id]}.js`, src=await get(origin+ref);
    fs.writeFileSync(path.join(CH,loc+'-common.js'),src);
    let table;
    literals(src,n=>{
      if(n.type==='CallExpression' && n.callee.object?.name==='JSON' && n.callee.property?.name==='parse' && typeof n.arguments[0]?.value==='string') {
        const value=JSON.parse(n.arguments[0].value); if(value && value['나이트로드']) table=value;
      }
    });
    if(!table) throw new Error('Missing decoded locale: '+loc);
    fs.writeFileSync(path.join(W,loc+'.json'),JSON.stringify(table,null,1));
  }
  fs.writeFileSync(path.join(W,'route_map.json'),JSON.stringify({...oldMap,...routeMap},null,1));
  const index={at:new Date().toISOString(),pages,activeFiles:active.map(c=>decodeURIComponent(c.split('/').pop())),previousFiles,routeMap,failures};
  fs.writeFileSync(path.join(W,'live-index.json'),JSON.stringify(index,null,2));
  console.log(JSON.stringify({routes:Object.keys(pages).length,activeChunks:active.length,fresh,failures,locales:Object.keys(localeIds)}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
