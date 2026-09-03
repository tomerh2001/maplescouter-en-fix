const puppeteer = require('puppeteer'); const path = require('path'); const fs = require('fs');
const OUT = path.join(__dirname, '..', 'extension', 'store-assets', 'new');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('msfix:locale','en'); localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0})); localStorage.setItem('msfix:debug','1'); localStorage.setItem('msfix:cloud:url','http://localhost:8080'); } catch(e){} });
  await p.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 60000 }); await wait(3500);
  const closeModal = async () => { await p.evaluate(() => { const c = document.querySelector('[data-slot=dialog-close]'); if (c) c.click(); }); await p.keyboard.press('Escape'); await wait(400); };
  await p.evaluate(() => {
    const d = window.__msfixDebug; const base = JSON.parse(JSON.stringify(d.manualStore.getState().draftStat));
    const mk = (cls, lv, s) => { const x = JSON.parse(JSON.stringify(base)); Object.assign(x.stat, { myClass: cls, level: String(lv), mainStatBase: String(s), mainStatPer: '780', mainStatAbs: '30000', subStatBase: '4400', subStatPer: '210', atkBase: '4800', atkPercent: '165', dmg: '130', bossDmg: '650', ignoreDef: '97.5', critical: '100', criticalDmg: '145', arcaneForce: '1350', authenticForce: '660', buffDuration: '90' }); Object.assign(x.hexa, { skillCore1: '30', skillCore2: '30', masteryCore1: '30', masteryCore2: '30', reinCore1: '30', reinCore2: '30', hexaStat: 2 }); return x; };
    const now = Date.now();
    d.presetStore.getState().setPreset({
      '1': { data: mk('은월', 290, 8010), label: 'HTomer', savedAt: new Date(now - 5 * 60e3).toISOString() },
      '2': { data: mk('비숍', 275, 6900), label: 'Len', savedAt: new Date(now - 3 * 3600e3).toISOString() },
      '3': { data: mk('아델', 262, 6100), label: 'Kalla', savedAt: new Date(now - 2 * 86400e3).toISOString() } });
  });
  await wait(600);
  const pick = async (name) => { await p.click('.msfix-charpicker input[role=combobox]'); await wait(500); await p.evaluate((n) => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => x.textContent.indexOf(n) === 0 || new RegExp('^' + n).test(x.textContent)); r.click(); }, name); await wait(900); };
  const upload = async () => { await p.click('.msfix-charpicker .msfix-sync'); await wait(500); await p.evaluate(() => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length-1]; const bt = [...last.querySelectorAll('button')].find(x => x.textContent.trim() === 'Upload'); if (bt) bt.click(); }); await wait(1500); };
  const result = async () => { await p.evaluate(() => { const bt = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === 'Result'); if (bt) bt.click(); }); await wait(5000); await closeModal(); };
  // link + upload + compute HEXA for each demo character so rows carry real numbers
  for (const n of ['Kalla', 'Len', 'HTomer']) {
    await pick(n);
    // link to an IGN via the menu "Set IGN" (unlinked slots) then upload
    await p.click('.msfix-charpicker input[role=combobox]'); await wait(400);
    await p.evaluate((n) => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => new RegExp('^' + n).test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); }, n); await wait(400);
    const needsIgn = await p.evaluate(() => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length-1]; const bt = [...last.querySelectorAll('button')].find(x => /Set IGN/.test(x.textContent)); if (bt) { bt.click(); return true; } return false; });
    await wait(400);
    if (needsIgn) { await p.evaluate((n) => { const i = document.querySelector('.msfix-dialog input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, n); i.dispatchEvent(new Event('input', { bubbles: true })); }, n); await p.evaluate(() => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length-1]; [...last.querySelectorAll('button')].find(x => x.textContent.trim() === 'Add').click(); }); await wait(600); await p.evaluate(() => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length-1]; if (last) { const bt = [...last.querySelectorAll('button')].find(x => x.textContent.trim() === 'Add'); if (bt) bt.click(); } }); await wait(600); }
    else await p.keyboard.press('Escape');
    await upload(); await result();
  }
  // HTomer: an edit so history has entries and the icon shows a state
  await pick('HTomer');
  const h = await p.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '290')); const el = h.asElement();
  if (el) { await el.click({ clickCount: 3 }); await p.keyboard.type('291'); await wait(1200); }
  await upload(); await result(); await wait(500);
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300);
  // 1. picker open
  await p.click('.msfix-charpicker input[role=combobox]'); await wait(700);
  await p.screenshot({ path: path.join(OUT, 'shot-1-characters.jpg'), type: 'jpeg', quality: 90 });
  // 2. row menu
  await p.evaluate(() => { const r = [...document.querySelectorAll('.msfix-dd [role=option]')].find(x => /^HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); }); await wait(600);
  await p.screenshot({ path: path.join(OUT, 'shot-2-menu.jpg'), type: 'jpeg', quality: 90 });
  // 3. history
  await p.evaluate(() => { const d = document.querySelectorAll('.msfix-dialog'); const last = d[d.length-1]; [...last.querySelectorAll('button')].find(b => /History/.test(b.textContent)).click(); }); await wait(600);
  await p.screenshot({ path: path.join(OUT, 'shot-3-history.jpg'), type: 'jpeg', quality: 90 });
  await p.keyboard.press('Escape'); await wait(300);
  // 4. sync prompt (local-ahead): make an edit first
  const h2 = await p.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '291')); const el2 = h2.asElement();
  if (el2) { await el2.click({ clickCount: 3 }); await p.keyboard.type('292'); await wait(1200); }
  await p.click('.msfix-charpicker .msfix-sync'); await wait(600);
  await p.screenshot({ path: path.join(OUT, 'shot-4-sync.jpg'), type: 'jpeg', quality: 90 });
  await p.keyboard.press('Escape');
  const rows = await p.evaluate(async () => { document.querySelector('.msfix-charpicker input[role=combobox]').click(); await new Promise(r => setTimeout(r, 500)); return [...document.querySelectorAll('.msfix-dd [role=option]')].map(x => x.textContent.replace(/\s+/g,' ').trim().slice(0, 80)); });
  console.log(JSON.stringify({ rows }, null, 1));
  await b.close();
})().catch(e => { console.log('SHOT ERROR ' + e.message.slice(0, 300)); process.exit(1); });
