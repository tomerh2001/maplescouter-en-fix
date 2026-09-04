// Store screenshots for 1.7.0: shot-1 (picker open, character looks visible) and shot-2 (row menu).
// Needs test/proxy.js on :8787 and the e2e stub backend on :8080 (the stub answers /v1/avatar for
// IGNs starting with e2e/htomer and serves /avatar.png).
//   node work/shots-170.js            writes into extension/store-assets/
//   OUT_DIR=/some/dir node work/shots-170.js
// The three demo rows need real-looking sprites, so the script seeds the extension's avatar cache
// (localStorage 'msfix:cloud:avatars') before the page loads: HTomer with the look Nexon's public
// ranking API reports for that IGN, the two other demo rows with the first Night Lord and Dark Knight
// sprites on page 1 of the public overall ranking (anonymous looks under the demo labels). When Nexon
// is unreachable the stub's silhouette (/avatar.png) is used instead, so the script still completes.
const puppeteer = require('puppeteer'); const path = require('path'); const fs = require('fs');
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'extension', 'store-assets');
const STUB = 'http://localhost:8080';
const NEXON = 'https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na?type=overall&id=weekly&reboot_index=0&page_index=1';
const UA = 'Mozilla/5.0 (compatible; maplescouter-en-fix shots/1.7; +https://github.com/tomerh2001/maplescouter-en-fix)';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Demo characters: label, the site's class key (Korean), level, main stat, ranking job name used to pick a sprite.
const DEMO = [
  { key: '1', label: 'HTomer', cls: '은월', job: 'Shade', level: 290, stat: 8010, ago: 5 * 60e3, byName: true },
  { key: '2', label: 'Len', cls: '나이트로드', job: 'Night Lord', level: 275, stat: 6900, ago: 3 * 3600e3 },
  { key: '3', label: 'Kalla', cls: '다크나이트', job: 'Dark Knight', level: 262, stat: 6100, ago: 2 * 86400e3 },
];

async function nexon(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal }); if (!r.ok) return null; return await r.json(); }
  catch (e) { return null; } finally { clearTimeout(t); }
}
// Builds the avatar cache seed { ignLower: { image, level, job, worldId, at } } for the demo rows.
async function looks() {
  const at = new Date().toISOString(); const seed = {};
  const page = await nexon(NEXON); const ranks = (page && page.ranks) || [];
  for (const d of DEMO) {
    let r = null;
    if (d.byName) { const j = await nexon(NEXON + '&character_name=' + encodeURIComponent(d.label)); r = j && j.ranks && j.ranks.find(x => String(x.characterName).toLowerCase() === d.label.toLowerCase()); }
    else r = ranks.find(x => x.jobName === d.job);
    seed[d.label.toLowerCase()] = r
      ? { image: r.characterImgURL, level: r.level, job: r.jobName, worldId: r.worldID, at }
      : { image: STUB + '/avatar.png', level: d.level, job: d.job, worldId: 1, at };
    console.log('look ' + d.label + ': ' + (r ? 'Nexon (' + r.jobName + ' Lv ' + r.level + ')' : 'stub fallback'));
  }
  return seed;
}

// Clears the demo IGNs from the stub so every character starts unlinked and not in the cloud.
async function clearStub() {
  for (const d of DEMO) { try { await fetch(STUB + '/v1/characters/' + encodeURIComponent(d.label), { method: 'DELETE', headers: { 'X-Confirm': d.label.toLowerCase() } }); } catch (e) {} }
}

(async () => {
  await clearStub();
  const seed = await looks();
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument((seed) => { try { localStorage.setItem('msfix:locale','en'); localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0})); localStorage.setItem('msfix:debug','1'); localStorage.setItem('msfix:cloud:url','http://localhost:8080'); localStorage.setItem('msfix:cloud:avatars', JSON.stringify(seed)); } catch(e){} }, seed);
  await p.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 60000 }); await wait(3500);
  const closeModal = async () => { await p.evaluate(() => { const c = document.querySelector('[data-slot=dialog-close]'); if (c) c.click(); }); await p.keyboard.press('Escape'); await wait(400); };
  await p.evaluate((DEMO) => {
    const d = window.__msfixDebug; const base = JSON.parse(JSON.stringify(d.manualStore.getState().draftStat));
    const mk = (cls, lv, s) => { const x = JSON.parse(JSON.stringify(base)); Object.assign(x.stat, { myClass: cls, level: String(lv), mainStatBase: String(s), mainStatPer: '780', mainStatAbs: '30000', subStatBase: '4400', subStatPer: '210', atkBase: '4800', atkPercent: '165', dmg: '130', bossDmg: '650', ignoreDef: '97.5', critical: '100', criticalDmg: '145', arcaneForce: '1350', authenticForce: '660', buffDuration: '90' }); Object.assign(x.hexa, { skillCore1: '30', skillCore2: '30', masteryCore1: '30', masteryCore2: '30', reinCore1: '30', reinCore2: '30', hexaStat: 2 }); return x; };
    const now = Date.now(); const presets = {};
    DEMO.forEach((c) => { presets[c.key] = { data: mk(c.cls, c.level, c.stat), label: c.label, savedAt: new Date(now - c.ago).toISOString() }; });
    d.presetStore.getState().setPreset(presets);
  }, DEMO);
  await wait(600);
  const lastDialogButton = (re) => p.evaluate((src) => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length - 1]; if (!last) return false; const bt = [...last.querySelectorAll('button')].find(x => new RegExp(src).test(x.textContent.trim())); if (bt) { bt.click(); return true; } return false; }, re.source);
  const pick = async (name) => { await p.click('.msfix-charpicker input[role=combobox]'); await wait(500); await p.evaluate((n) => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => new RegExp('^' + n).test(x.textContent)); r.click(); }, name); await wait(900); };
  const upload = async () => { await p.click('.msfix-charpicker .msfix-sync'); await wait(500); await lastDialogButton(/^Upload$/); await wait(1500); };
  const result = async () => { await p.evaluate(() => { const bt = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === 'Result'); if (bt) bt.click(); }); await wait(5000); await closeModal(); };
  // link + upload + compute HEXA for each demo character so rows carry real numbers and cloud chips
  for (const n of ['Kalla', 'Len', 'HTomer']) {
    await pick(n);
    await p.click('.msfix-charpicker input[role=combobox]'); await wait(400);
    await p.evaluate((n) => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => new RegExp('^' + n).test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); }, n); await wait(400);
    const needsIgn = await lastDialogButton(/Set IGN/); await wait(400);
    if (needsIgn) {
      await p.evaluate((n) => { const i = document.querySelector('.msfix-dialog input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, n); i.dispatchEvent(new Event('input', { bubbles: true })); }, n);
      await wait(900); // the add dialog looks the IGN up after 600 ms of no typing
      await lastDialogButton(/^Add$/); await wait(600);
      await lastDialogButton(/^Add$/); await wait(600); // "Add this character?" confirm (IGN not in the cloud yet)
    } else await p.keyboard.press('Escape');
    await upload(); await result();
  }
  // HTomer: an edit so history has entries and the icon shows a state
  await pick('HTomer');
  const h = await p.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '290')); const el = h.asElement();
  if (el) { await el.click({ clickCount: 3 }); await p.keyboard.type('291'); await wait(1200); }
  await upload(); await result(); await wait(500);
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300);
  // 1. picker open, with every row's look loaded
  await p.click('.msfix-charpicker input[role=combobox]'); await wait(700);
  for (let i = 0; i < 20; i++) {
    const ready = await p.evaluate(() => { const imgs = [...document.querySelectorAll('.msfix-dd .msfix-avatar img')]; return imgs.length >= 3 && imgs.every(im => im.complete && im.naturalWidth > 0); });
    if (ready) break; await wait(250);
  }
  await wait(300);
  await p.screenshot({ path: path.join(OUT, 'shot-1-characters.jpg'), type: 'jpeg', quality: 90 });
  // 2. row menu
  await p.evaluate(() => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => /^HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); }); await wait(600);
  await p.screenshot({ path: path.join(OUT, 'shot-2-menu.jpg'), type: 'jpeg', quality: 90 });
  await p.keyboard.press('Escape');
  const info = await p.evaluate(async () => {
    document.querySelector('.msfix-charpicker input[role=combobox]').click(); await new Promise(r => setTimeout(r, 500));
    return {
      rows: [...document.querySelectorAll('.msfix-dd [role=option]')].map(x => x.textContent.replace(/\s+/g,' ').trim().slice(0, 80)),
      avatars: [...document.querySelectorAll('.msfix-dd .msfix-avatar')].map(x => x.getAttribute('data-msfix-avatar') + ':' + x.getAttribute('data-msfix-avatar-state')),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})().catch(e => { console.log('SHOT ERROR ' + e.message.slice(0, 300)); process.exit(1); });
