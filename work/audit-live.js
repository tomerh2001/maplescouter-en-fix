#!/usr/bin/env node
// Read only: compare current public bundles with shipped translations and the last scan.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),acorn=require('../scripts/audit/node_modules/acorn');
const W=__dirname, root=path.dirname(W), index=JSON.parse(fs.readFileSync(path.join(W,'live-index.json')));
const dict=JSON.parse(fs.readFileSync(path.join(root,'data/dictionary.json'))),patch=JSON.parse(fs.readFileSync(path.join(root,'data/i18n-patch.json'))),en=JSON.parse(fs.readFileSync(path.join(W,'en.json'))),rules=JSON.parse(fs.readFileSync(path.join(root,'data/rules.json')));
const source=fs.readFileSync(path.join(root,'src/maplescouter-en-fix.user.js'),'utf8');
require('../scripts/translation-overrides.cjs').applyTranslationOverrides(patch, dict);
const ctx=vm.createContext({data:()=>({dict,rules}),HANGUL:/[가-힣]/});
vm.runInContext(source.slice(source.indexOf('  var KO_NUM_UNITS'),source.indexOf('  function translateTitle(')),ctx);
function strings(src){const out=[]; const ast=acorn.parse(src,{ecmaVersion:'latest'});(function walk(n){if(!n||typeof n!=='object')return;if(n.type==='Literal'&&typeof n.value==='string')out.push(n.value);if(n.type==='TemplateElement'&&n.value.cooked)out.push(n.value.cooked);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);})(ast);return out.filter(s=>/[가-힣]/.test(s));}
const baseline=new Set(),seen=new Map(),parseFailures=[],hashes={};
for(const file of index.previousFiles.filter(f=>!/-common\.js$/.test(f))){try{strings(fs.readFileSync(path.join(W,'chunks',file),'utf8')).forEach(s=>baseline.add(s));}catch{}}
for(const file of index.activeFiles){try{const src=fs.readFileSync(path.join(W,'chunks',file),'utf8');hashes[file]=crypto.createHash('sha256').update(src).digest('hex');for(const text of strings(src)){if(!seen.has(text))seen.set(text,[]);seen.get(text).push(file);}}catch(e){parseFailures.push({file,error:e.message});}}
const missing=[];for(const [s,files] of seen){if(s.length>1000||s.includes('<svg')||s.startsWith('data:'))continue;const translated=patch[s]||ctx.translateString(en[s]||s)||en[s];if(translated&&!/[가-힣]/.test(translated))continue;missing.push({ko:s,new:!baseline.has(s),routes:Object.entries(index.pages).filter(([,refs])=>refs.some(ref=>files.includes(path.basename(ref)))).map(([route])=>route),files,partial:translated||null});}
missing.sort((a,b)=>Number(b.new)-Number(a.new)||a.ko.localeCompare(b.ko));
const retained=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/retained-korean.json')));
const reviewedExceptions=missing.filter(s=>retained[s.ko]).map(s=>({...s,reason:retained[s.ko]}));
const unresolved=missing.filter(s=>!retained[s.ko]);
const report={at:index.at,routes:Object.keys(index.pages),hashes,parseFailures,crawlFailures:index.failures,missing:unresolved,reviewedExceptions,newMissing:unresolved.filter(s=>s.new).length};
const priorPath=path.join(root,'docs/audits/live-baseline.json');
const prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath)):null;
report.changedChunks=Object.keys(hashes).filter(f=>!prior||prior.hashes[f]!==hashes[f]);
report.removedChunks=prior?Object.keys(prior.hashes).filter(f=>!hashes[f]):[];
fs.writeFileSync(path.join(W,'audit-live.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({routes:report.routes.length,chunks:index.activeFiles.length,literals:seen.size,missing:unresolved.length,reviewedExceptions:reviewedExceptions.length,newMissing:report.newMissing,changedChunks:report.changedChunks.length,parseFailures,crawlFailures:index.failures}));
if(process.argv.includes('--details')) for(const row of unresolved) console.log(JSON.stringify({ko:row.ko,routes:row.routes}));
if(parseFailures.length||index.failures.length) process.exitCode=1;
