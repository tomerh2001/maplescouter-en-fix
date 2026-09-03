// End-to-end test of the character picker + cloud sync (v1.5.0) against the live site through the
// local proxy (node test/proxy.js → :8787) and a local backend on :8080 (maplescouter-cloud or the stub).
// Run from work/:  node e2e-cloud.js [download-dir]
const puppeteer = require('puppeteer'); const fs = require('fs'); const path = require('path'); const http = require('http');
const DL = process.argv[2] || path.join(__dirname, 'out', 'e2e-dl');
const CLOUD = 'http://localhost:8080';
const results = []; let page, browser, cdp;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await page.evaluate(fn); if (v) return v; await wait(120); }
  throw new Error('timeout: ' + (label || fn.toString().slice(0, 80)));
}
function cloudReq(method, p, body, headers) {
  return new Promise((res, rej) => {
    const u = new URL(CLOUD + p);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, r => {
      const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(ch).toString()); } catch (e) {} res({ status: r.statusCode, json: j, etag: r.headers.etag }); });
    });
    rq.on('error', rej); if (body) rq.write(JSON.stringify(body)); rq.end();
  });
}
async function scenario(name, fn) {
  try { const info = await fn(); results.push({ name, ok: true, info }); console.log('PASS', name, info ? JSON.stringify(info).slice(0, 300) : ''); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.message || e) }); console.log('FAIL', name, e && e.message); try { await page.screenshot({ path: path.join(DL, 'fail-' + name.replace(/\W+/g, '_') + '.png') }); } catch (e2) {} }
}
// in-page helpers (ES5, evaluated in the page)
const H = {
  stores: `(function(){ var d=window.__msfixDebug; var ps=d&&d.presetStore, ms=d&&d.manualStore; window.__e2e={ps:ps,ms:ms}; return !!(ps&&ms); })()`,
  slots: `(function(){ var m=window.__e2e.ps.getState().preset||{}; var o={}; for(var k in m) o[k]={label:m[k].label, level:m[k].data&&m[k].data.stat&&m[k].data.stat.level, cls:m[k].data&&m[k].data.stat&&m[k].data.stat.myClass, savedAt:m[k].savedAt}; return o; })()`,
  bindings: `(function(){ try { return { slots: JSON.parse(localStorage.getItem('msfix:cloud:slots')||'{}'), selected: JSON.parse(localStorage.getItem('msfix:cloud:selected')||'null') }; } catch(e){ return null; } })()`,
  icon: `(function(){ var b=document.querySelector('.msfix-charpicker .msfix-sync'); return b? b.getAttribute('data-msfix-sync') : null; })()`,
  trigger: `(function(){ var i=document.querySelector('.msfix-charpicker input[role=combobox]'); return i? {value:i.value, placeholder:i.placeholder, selected:i.getAttribute('data-msfix-selected')} : null; })()`,
  levelInput: `(function(v){ var ins=document.querySelectorAll('input'); for(var i=0;i<ins.length;i++) if(ins[i].value===String(v)) return true; return false; })`,
};
async function setDraft(patch) {
  return page.evaluate((patch) => { var ms = window.__e2e.ms; var d = JSON.parse(JSON.stringify(ms.getState().draftStat)); for (var k in patch) d.stat[k] = patch[k]; ms.getState().setDraftStat(d); return d.stat.level; }, patch);
}
async function openPicker() {
  await page.click('.msfix-charpicker input[role=combobox]');
  await waitFor(() => { var d = document.querySelector('.msfix-charpicker .msfix-dd'); return d && !d.hidden; }, 3000, 'dropdown open');
  await wait(300);
}
async function dropdownText() { return page.evaluate(() => (document.querySelector('.msfix-charpicker .msfix-dd').innerText || '').replace(/\s+/g, ' ')); }
async function clickOption(text) {
  const ok = await page.evaluate((text) => { var rows = document.querySelectorAll('.msfix-charpicker .msfix-dd [data-msfix-idx]'); for (var i = 0; i < rows.length; i++) if ((rows[i].textContent || '').indexOf(text) !== -1) { rows[i].click(); return rows[i].textContent; } return null; }, text);
  if (!ok) throw new Error('option not found: ' + text);
  return ok;
}
async function dialogText() { return page.evaluate(() => { var d = document.querySelectorAll('.msfix-dialog'); return d.length ? (d[d.length - 1].innerText || '').replace(/\s+/g, ' ') : null; }); }
async function clickDialogButton(text) {
  await waitFor(() => !!document.querySelector('.msfix-dialog'), 4000, 'dialog');
  const ok = await page.evaluate((text) => { var d = document.querySelectorAll('.msfix-dialog'); var dlg = d[d.length - 1]; var bs = dlg.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) if ((bs[i].textContent || '').trim().indexOf(text) === 0) { bs[i].click(); return true; } return false; }, text);
  if (!ok) throw new Error('dialog button not found: ' + text + ' in: ' + (await dialogText()));
}
async function typeInDialog(text) { await page.type('.msfix-dialog input', text); }
function makeDoc(ign, level, cls, base) { const d = JSON.parse(JSON.stringify(base)); d.stat.level = String(level); d.stat.myClass = cls; return { preset: { type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: ign, data: d }, label: ign }; }

(async () => {
  fs.mkdirSync(DL, { recursive: true });
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message.slice(0, 120)));
  const cloudRequests = []; page.on('request', r => { if (r.url().indexOf(CLOUD) === 0) cloudRequests.push(r.method() + ' ' + r.url().slice(CLOUD.length)); });
  cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  const dlEvents = []; cdp.on('Browser.downloadWillBegin', e => dlEvents.push(e.suggestedFilename)); cdp.on('Browser.downloadProgress', e => { if (e.state !== 'inProgress') dlEvents.push(e.state); });
  await page.evaluateOnNewDocument((cloud) => { try { localStorage.setItem('msfix:locale', 'en'); localStorage.setItem('msfix:debug', '1'); localStorage.setItem('region', JSON.stringify({ state: { region: 'gms' }, version: 0 })); localStorage.setItem('msfix:cloud:url', cloud); } catch (e) {} }, CLOUD);

  await page.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 90000 });
  await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker mounted');
  await waitFor(H.stores, 10000, 'stores');
  let base = await page.evaluate(() => window.__e2e.ms.getState().draftStat);

  await scenario('A. picker renders; native Load/Save row + IGN search hidden on /en/input', async () => {
    return page.evaluate(() => {
      var row = document.querySelector('button[data-slot=dialog-trigger] > svg.lucide-file-down').parentElement.parentElement;
      var ignBlocks = Array.prototype.map.call(document.querySelectorAll('input[data-slot=input] + button[data-slot=popover-trigger]'), function (b) { return getComputedStyle(b.parentElement.parentElement).display; });
      var w = document.querySelector('.msfix-charpicker');
      var r = { rowDisplay: getComputedStyle(row).display, ignBlocks: ignBlocks, pickerInHeader: !!w && w.parentElement === row.parentElement, icon: document.querySelector('.msfix-sync').getAttribute('data-msfix-sync'), hardReset: !!Array.prototype.find.call(document.querySelectorAll('button[data-slot=dialog-trigger]'), function (b) { return /Hard Reset/.test(b.textContent) && b.offsetParent; }), route: document.documentElement.getAttribute('data-msfix-route'), rect: w.getBoundingClientRect().toJSON() };
      r.routeStyleEnabled = !document.getElementById('msfix-cloud-route').disabled;
      if (r.rowDisplay !== 'none' || r.ignBlocks.length !== 2 || r.ignBlocks.some(function (d) { return d !== 'none'; }) || !r.pickerInHeader || r.icon !== 'none' || !r.hardReset || !r.routeStyleEnabled) throw new Error('bad state ' + JSON.stringify(r));
      return r;
    });
  });

  await scenario('A2. SPA-navigate away: IGN search visible again, picker unmounted; back: mounted again', async () => {
    const hrefs = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href'); }).filter(function (h) { return /^\/en(\/|$)/.test(h); }));
    await page.evaluate(() => { var a = Array.prototype.find.call(document.querySelectorAll('a[href]'), function (x) { var h = x.getAttribute('href') || ''; return /^\/en\/[a-z]/.test(h) && h.indexOf('input') === -1 && x.offsetParent; }); if (!a) throw new Error('no nav link'); a.click(); });
    await waitFor(() => location.pathname.indexOf('/en/input') !== 0 && !document.querySelector('.msfix-charpicker'), 20000, 'left /input');
    await wait(500);
    const away = await page.evaluate(() => ({ route: document.documentElement.getAttribute('data-msfix-route'), ignBlocks: Array.prototype.map.call(document.querySelectorAll('input[data-slot=input] + button[data-slot=popover-trigger]'), function (b) { return getComputedStyle(b.parentElement.parentElement).display; }), picker: !!document.querySelector('.msfix-charpicker') }));
    away.routeStyleDisabled = await page.evaluate(() => document.getElementById('msfix-cloud-route').disabled); away.path = await page.evaluate(() => location.pathname);
    if (away.picker || !away.ignBlocks.length || !away.routeStyleDisabled) throw new Error('away state ' + JSON.stringify(away) + ' hrefs ' + JSON.stringify(hrefs));
    const anyVisible = away.ignBlocks.some(d => d !== 'none'); if (!anyVisible) throw new Error('IGN search still hidden off /input ' + JSON.stringify(away));
    await page.evaluate(() => { var a = Array.prototype.find.call(document.querySelectorAll('a[href]'), function (x) { return /^\/en\/input\/?$/.test(x.getAttribute('href') || '') && x.offsetParent; }); if (!a) throw new Error('no input link'); a.click(); });
    await waitFor(() => location.pathname.indexOf('/en/input') === 0 && !!document.querySelector('.msfix-charpicker'), 20000, 'back on /input with picker');
    await waitFor(H.stores, 10000, 'stores');
    return { away, back: true };
  });

  await scenario('B. add character (404 path) creates a slot labelled by IGN and uploads', async () => {
    await setDraft({ level: '275', myClass: '은월' });
    await wait(700);
    await openPicker();
    const before = await dropdownText();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('HTomer');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add HTomer\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    const confirmText = await dialogText();
    await clickDialogButton('Add');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'icon not-uploaded (local first)');
    if ((await cloudReq('GET', '/v1/characters/htomer')).status !== 404) throw new Error('added character was uploaded automatically');
    await page.click('.msfix-charpicker .msfix-sync');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload to the cloud\?/.test(d.innerText); }, 4000, 'upload prompt');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'icon synced');
    const slots = await page.evaluate(H.slots); const b = await page.evaluate(H.bindings); const trig = await page.evaluate(H.trigger);
    const key = Object.keys(slots).find(k => slots[k].label === 'HTomer'); if (!key) throw new Error('no HTomer slot ' + JSON.stringify(slots));
    if (!b.slots[key] || b.slots[key].ign !== 'HTomer' || !b.slots[key].cloudUpdatedAt || !b.selected || b.selected.key !== key) throw new Error('binding ' + JSON.stringify(b));
    const doc = await cloudReq('GET', '/v1/characters/htomer'); if (doc.status !== 200 || doc.json.preset.data.stat.level !== '275') throw new Error('cloud doc ' + doc.status);
    if (trig.value !== 'HTomer') throw new Error('trigger ' + JSON.stringify(trig));
    return { key, slots, confirmText: confirmText.slice(0, 120), cloudLevel: doc.json.preset.data.stat.level, dropdownBefore: before.slice(0, 100) };
  });

  await scenario('C. editing a field auto-saves into the slot within 1 s and flips the icon to out-of-sync', async () => {
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '275'));
    const elh = h.asElement(); if (!elh) throw new Error('no level input with 275');
    await elh.click({ clickCount: 3 }); await page.keyboard.type('276');
    const t0 = Date.now();
    await waitFor(() => { var m = window.__e2e.ps.getState().preset; for (var k in m) if (m[k].label === 'HTomer' && m[k].data.stat.level === '276') return true; return false; }, 1000, 'slot updated <1s');
    const ms = Date.now() - t0;
    const icon = await page.evaluate(H.icon); if (icon !== 'local-ahead') throw new Error('icon ' + icon);
    return { savedAfterMs: ms, icon };
  });

  await scenario('C2. icon click → upload confirm → synced; cloud has 276', async () => {
    await page.click('.msfix-charpicker .msfix-sync');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after upload');
    const doc = await cloudReq('GET', '/v1/characters/htomer'); if (doc.json.preset.data.stat.level !== '276') throw new Error('cloud level ' + doc.json.preset.data.stat.level);
    return { cloudLevel: doc.json.preset.data.stat.level, ifMatchSeen: cloudRequests.filter(r => /^PUT/.test(r)).length };
  });

  await scenario('D. switching to another local character updates visible inputs without reload (and "Len" is not translated to "Ren")', async () => {
    await page.evaluate((base) => { var ps = window.__e2e.ps; var cur = ps.getState().preset || {}; var map = {}; for (var k in cur) map[k] = cur[k]; var d = JSON.parse(JSON.stringify(base)); d.stat.level = '250'; d.stat.myClass = '비숍'; var keys = Object.keys(map).map(Number); var nk = String(Math.max.apply(null, keys.concat([0])) + 1); map[nk] = { data: d, label: 'Len', savedAt: new Date().toISOString() }; ps.getState().setPreset(map); window.__noReload = 1; }, base);
    await wait(400);
    await openPicker();
    const txt = await dropdownText();
    if (txt.indexOf('Len') === -1 || txt.indexOf('Ren') !== -1) throw new Error('dropdown text: ' + txt);
    await page.screenshot({ path: path.join(DL, 'shot-dropdown.png'), clip: { x: 200, y: 60, width: 1000, height: 520 } });
    await clickOption('Len');
    await waitFor(() => window.__noReload === 1 && Array.from(document.querySelectorAll('input')).some(i => i.value === '250') && /Bishop/.test(document.body.innerText) && !!document.querySelector('.msfix-charpicker'), 8000, 'form shows Len');
    const trig = await page.evaluate(H.trigger); const icon = await page.evaluate(H.icon);
    if (trig.value !== 'Len') throw new Error('trigger ' + JSON.stringify(trig));
    if (icon !== 'unlinked') throw new Error('icon ' + icon);
    return { trigger: trig.value, icon, dropdown: txt.slice(0, 200) };
  });

  await scenario('E. typing an IGN offers "Load <IGN> from the cloud"; selecting it imports and loads it (no directory listing)', async () => {
    const put = await cloudReq('PUT', '/v1/characters/CloudGuy', makeDoc('CloudGuy', 260, '나이트로드', base));
    if (put.status !== 201 && put.status !== 200) throw new Error('seed PUT ' + put.status);
    const listReqsBefore = cloudRequests.filter(r => r === 'GET /v1/characters').length;
    await openPicker();
    const txt0 = await dropdownText();
    if (/CloudGuy/.test(txt0) || /LOCAL|CLOUD\b/.test(txt0)) throw new Error('unexpected listing/sections: ' + txt0.slice(0, 160));
    await page.type('.msfix-charpicker input[role=combobox]', 'CloudGuy');
    await waitFor(() => /Load CloudGuy from the cloud/.test(document.querySelector('.msfix-charpicker .msfix-dd').innerText), 4000, 'lookup row');
    await clickOption('Load CloudGuy from the cloud');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '260') && /Night Lord/.test(document.body.innerText), 10000, 'form shows CloudGuy');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const slots = await page.evaluate(H.slots); const b = await page.evaluate(H.bindings);
    const key = Object.keys(slots).find(k => slots[k].label === 'CloudGuy'); if (!key || !b.slots[key] || b.slots[key].ign !== 'CloudGuy') throw new Error('import binding ' + JSON.stringify({ slots, b }));
    const listReqsAfter = cloudRequests.filter(r => r === 'GET /v1/characters').length;
    if (listReqsAfter !== listReqsBefore) throw new Error('directory listing requested');
    return { key, listRequests: listReqsAfter };
  });

  await scenario('F. comparison dialog when adding an IGN that exists in the cloud; "Replace local" loads the cloud version', async () => {
    await cloudReq('PUT', '/v1/characters/Existing', makeDoc('Existing', 230, '아란', base));
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('Existing');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /already exists in the cloud/.test(d.innerText); }, 8000, 'comparison dialog');
    const txt = await dialogText();
    await page.screenshot({ path: path.join(DL, 'shot-compare.png') });
    for (const need of ['Your inputs', 'Cloud copy', 'Upload my inputs', 'Use cloud copy', 'differ']) if (txt.indexOf(need) === -1) throw new Error('missing "' + need + '" in: ' + txt);
    await clickDialogButton('Use cloud copy');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '230') && /Aran/.test(document.body.innerText), 10000, 'form shows Existing');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'Existing');
    if (!key) throw new Error('no Existing slot ' + JSON.stringify(slots));
    return { key, dialog: txt.slice(0, 260) };
  });

  await scenario('G. export download of a bound slot contains "ign"', async () => {
    await openPicker(); await clickOption('HTomer');
    await waitFor(() => document.querySelector('.msfix-charpicker input[role=combobox]').value === 'HTomer', 8000, 'HTomer selected');
    await wait(600);
    await page.evaluate(() => { var b = Array.from(document.querySelectorAll('button[data-slot=dialog-trigger]')).find(x => x.querySelector('svg.lucide-download')); if (!b) throw new Error('no native Save trigger'); b.click(); });
    await waitFor(() => !!document.querySelector('[data-slot=dialog-content] div.group.relative'), 6000, 'save window');
    await wait(400);
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    const clicked = await page.evaluate((idx) => { var rows = document.querySelectorAll('[data-slot=dialog-content] div.group.relative'); var row = rows[idx]; if (!row) return 'no row ' + idx + '/' + rows.length; var btn = Array.prototype.find.call(row.querySelectorAll('div.absolute button'), function (b) { return !/msfix/.test(b.className) && /JSON|Export|내보내기/.test(b.title || ''); }); if (!btn) return 'no export btn: ' + Array.prototype.map.call(row.querySelectorAll('div.absolute button'), function (b) { return b.title; }).join('|'); btn.click(); return 'clicked'; }, +key - 1);
    if (clicked !== 'clicked') throw new Error(clicked);
    await wait(2500);
    const files = fs.readdirSync(DL).filter(f => /^scouter-preset-/.test(f));
    if (!files.length) throw new Error('no download; events ' + JSON.stringify(dlEvents));
    const f = files[files.length - 1]; const o = JSON.parse(fs.readFileSync(path.join(DL, f), 'utf8'));
    if (o.ign !== 'HTomer' || o.type !== 'maplescouter-manual-preset') throw new Error('file ' + f + ' keys ' + Object.keys(o) + ' ign=' + o.ign);
    await page.evaluate(() => { var c = document.querySelector('[data-slot=dialog-close]'); if (c) c.click(); });
    await wait(400);
    return { file: f, keys: Object.keys(o), ign: o.ign, label: o.label };
  });

  await scenario('G2. footer "Download JSON" saves the selected character as a preset file carrying "ign"', async () => {
    for (const f of fs.readdirSync(DL)) if (/^scouter-character-/.test(f)) fs.unlinkSync(path.join(DL, f));   // a same-named leftover makes Chrome drop the download
    const before = 0;
    await openPicker(); await clickOption('Download JSON...');
    let files = []; const t0 = Date.now();
    while (Date.now() - t0 < 8000) { files = fs.readdirSync(DL).filter(f => /^scouter-character-/.test(f) && !/crdownload$/.test(f)); if (files.length > before) break; await wait(200); }
    if (files.length <= before) throw new Error('no download after 8s; files ' + JSON.stringify(fs.readdirSync(DL).filter(f => !/^fail-/.test(f))));
    const f = files[files.length - 1]; const o = JSON.parse(fs.readFileSync(path.join(DL, f), 'utf8'));
    if (o.ign !== 'HTomer' || o.type !== 'maplescouter-manual-preset' || !o.data || !o.data.stat) throw new Error('file ' + f + ' keys ' + Object.keys(o));
    return { file: f, ign: o.ign, level: o.data.stat.level };
  });

  await scenario('H. cloud changed elsewhere → focus poll flags cloud-ahead → compare → overwrite cloud (If-Match) → synced', async () => {
    const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    await page.click('.msfix-charpicker .msfix-sync');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /differs from the cloud/.test(d.innerText); }, 8000, 'compare dialog');
    const txt = await dialogText();
    await clickDialogButton('Upload my inputs');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '276') throw new Error('cloud level after overwrite ' + doc.json.preset.data.stat.level);
    return { dialog: txt.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('I. auto-upload is off: an edit is saved locally but never uploaded until the icon is clicked', async () => {
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '276'));
    const elh = h.asElement(); if (!elh) throw new Error('no level input 276');
    const puts0 = cloudRequests.filter(r => /^PUT/.test(r)).length;
    await elh.click({ clickCount: 3 }); await page.keyboard.type('277');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead');
    await wait(4500);
    if (cloudRequests.filter(r => /^PUT/.test(r)).length !== puts0) throw new Error('an upload happened without a click');
    await page.click('.msfix-charpicker .msfix-sync');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after explicit upload');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '277') throw new Error('cloud level ' + doc.json.preset.data.stat.level);
    return { cloudLevel: doc.json.preset.data.stat.level, autoFlag: await page.evaluate(() => localStorage.getItem('msfix:cloud:auto')) };
  });

  await scenario('I2. out-of-sync icon offers "Discard my changes": the cloud copy is restored into the form', async () => {
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '277'));
    const elh = h.asElement(); if (!elh) throw new Error('no level input 277');
    await elh.click({ clickCount: 3 }); await page.keyboard.type('278');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead');
    await page.click('.msfix-charpicker .msfix-sync');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); if (!d || !/Upload changes to the cloud\?/.test(d.innerText)) return false; var names = Array.from(d.querySelectorAll('button')).map(b => b.textContent.trim()); return names.indexOf('Cancel') !== -1 && names.indexOf('Discard') !== -1 && names.indexOf('Upload') !== -1; }, 4000, 'Cancel/Discard/Upload dialog');
    await clickDialogButton('Discard');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '277'), 8000, 'form restored to 277');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after discard');
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (slots[key].level !== '277') throw new Error('slot not restored: ' + JSON.stringify(slots[key]));
    return { level: slots[key].level };
  });

  await scenario('J. picker: single "Characters" list, chips, highlighted selection, footer is only Import JSON…', async () => {
    await openPicker();
    const info = await page.evaluate(() => {
      const dd = document.querySelector('.msfix-charpicker .msfix-dd');
      const heads = Array.from(dd.querySelectorAll('div')).filter(e => /font-semibold tracking-wide/.test(e.className)).map(e => e.textContent.trim());
      const rows = Array.from(dd.querySelectorAll('[role=option]')).map(r => ({ text: r.textContent.replace(/\s+/g, ' ').trim(), selected: r.getAttribute('aria-selected'), check: !!r.querySelector('svg path[d^="M20 6"]'), chips: Array.from(r.querySelectorAll('span.rounded-full')).map(c => c.textContent), menu: !!r.querySelector('[data-msfix-act=menu]') }));
      const footer = Array.from(dd.querySelectorAll('button[data-msfix-idx]')).map(b => b.textContent.trim());
      const clipped = Array.from(dd.querySelectorAll('span')).filter(e => /truncate/.test(e.className) && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 30));
      return { heads, rows, footer, clipped, width: dd.getBoundingClientRect().width };
    });
    await page.keyboard.press('Escape');
    if (info.heads.join('|') !== 'Characters') throw new Error('headers: ' + JSON.stringify(info.heads));
    if (info.footer.length !== 2 || info.footer[0] !== 'Import JSON...' || info.footer[1] !== 'Download JSON...') throw new Error('footer: ' + JSON.stringify(info.footer));
    const sel = info.rows.filter(r => r.selected === 'true'); if (sel.length !== 1 || sel[0].check || !/HTomer/.test(sel[0].text)) throw new Error('selection highlight (accent only, no check icon): ' + JSON.stringify(info.rows));
    const ht = sel[0]; if (ht.chips.join(',') !== 'local,cloud' || !ht.menu) throw new Error('chips/menu: ' + JSON.stringify(ht));
    if (info.clipped.length) throw new Error('clipped subtitles: ' + JSON.stringify(info.clipped));
    if (/Cloud is public|Load window|Save window|Cloud sync|Auto-upload|[—…·–]/.test(JSON.stringify(info))) throw new Error('old footer text or typographic characters present');
    return { rows: info.rows.map(r => r.text.slice(0, 60)), width: info.width };
  });

  await scenario('K. reload keeps selection + bindings; native Reset deselects instead of overwriting the slot', async () => {
    await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
    await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker after reload');
    await waitFor(H.stores, 10000, 'stores');
    const trig = await page.evaluate(H.trigger); if (trig.value !== 'HTomer') throw new Error('selection lost: ' + JSON.stringify(trig));
    await waitFor(() => ['synced', 'local-ahead', 'cloud-ahead', 'conflict'].indexOf(document.querySelector('.msfix-sync').getAttribute('data-msfix-sync')) !== -1, 8000, 'icon state after reload');
    const iconBefore = await page.evaluate(H.icon);
    await page.evaluate(() => window.__e2e.ms.getState().resetDraft());
    await waitFor(() => !!document.querySelector('.msfix-charpicker') && document.querySelector('.msfix-charpicker input[role=combobox]').value === '', 8000, 'deselected after reset');
    await wait(900);
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (slots[key].level !== '277') throw new Error('slot overwritten by reset: ' + JSON.stringify(slots[key]));
    return { iconBefore, iconAfter: await page.evaluate(H.icon), htomerLevel: slots[key].level };
  });

  await scenario('M. Result computes the HEXA-converted stat and the row shows it (thousands-formatted)', async () => {
    await openPicker(); await clickOption('HTomer');   // K left the form reset; compute for HTomer's inputs
    await waitFor(() => document.querySelector('.msfix-charpicker input[role=combobox]').value === 'HTomer', 8000, 'HTomer selected');
    await wait(700);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === 'Result'); if (!b) throw new Error('no Result button'); b.click(); });
    await waitFor(() => { var r = window.__e2e.ms.getState().result; return !!(r && r.calculatedData && r.calculatedData.boss300_hexaStat); }, 15000, 'result computed');
    const hexa = await page.evaluate(() => Math.round(window.__e2e.ms.getState().result.calculatedData.boss300_hexaStat));
    if (!/\/input/.test(await page.evaluate(() => location.pathname))) { await page.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 90000 }); await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker'); await waitFor(H.stores, 10000, 'stores'); }
    await openPicker();
    const fmt = (hexa >= 10000 ? Math.round(hexa / 1000) + 'k' : hexa >= 1000 ? (hexa / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(hexa)) + ' HEXA';
    let shown = false; const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !shown) { shown = await page.evaluate((f) => { var r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); return !!r && r.textContent.indexOf(f) !== -1; }, fmt); if (!shown) await wait(150); }
    if (!shown) throw new Error('HEXA on row: ' + fmt + ' :: ' + (await dropdownText()).slice(0, 200));
    await page.keyboard.press('Escape');
    return { hexa, fmt };
  });

  await scenario('R. History: the row menu lists the last saves; picking an older one loads it locally (icon local-ahead)', async () => {
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('History');
    await waitFor(() => { var d = document.querySelectorAll('.msfix-dialog'); var last = d[d.length - 1]; return last && /History/.test(last.innerText) && last.querySelectorAll('button').length >= 3; }, 4000, 'history dialog with entries');
    const rows = await page.evaluate(() => { var d = document.querySelectorAll('.msfix-dialog'); var last = d[d.length - 1]; return Array.from(last.querySelectorAll('button')).map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(x => x !== 'Cancel'); });
    if (rows.length < 2) throw new Error('expected at least 2 history entries: ' + JSON.stringify(rows));
    const pick = rows.find((r, i) => i > 0 && !/same as now/.test(r)); if (!pick) throw new Error('no older differing entry: ' + JSON.stringify(rows));
    const lv = (/Lv (\d+)/.exec(pick) || [])[1]; if (!lv) throw new Error('no level in entry: ' + pick);
    await page.evaluate((text) => { var d = document.querySelectorAll('.msfix-dialog'); var last = d[d.length - 1]; var b = Array.from(last.querySelectorAll('button')).find(x => x.textContent.replace(/\s+/g, ' ').trim() === text); b.click(); }, pick);
    await waitFor((lv) => Array.from(document.querySelectorAll('input')).some(i => i.value === lv), 8000, 'form shows restored level').catch(async () => { const ok = await page.evaluate((lv) => Array.from(document.querySelectorAll('input')).some(i => i.value === lv), lv); if (!ok) throw new Error('restored level not in form'); });
    await waitFor(() => ['local-ahead', 'synced'].indexOf(document.querySelector('.msfix-sync').getAttribute('data-msfix-sync')) !== -1, 6000, 'icon after restore');
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (slots[key].level !== lv) throw new Error('slot level ' + slots[key].level + ' != ' + lv);
    const hist = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}')));
    return { entries: rows.length, picked: pick.slice(0, 50), level: lv, historyKeys: hist, icon: await page.evaluate(H.icon) };
  });

  await scenario('N. row menu: overwrite HTomer with the current (Len) inputs → uploads; selection moves to HTomer', async () => {
    await openPicker(); await clickOption('Len');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '250'), 8000, 'Len loaded');
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '250'));
    await h.asElement().click({ clickCount: 3 }); await page.keyboard.type('251'); await wait(900);
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Overwrite/.test(d.innerText) && /Rename/.test(d.innerText); }, 4000, 'row menu');
    await clickDialogButton('Overwrite');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Overwrite this character\?/.test(d.innerText); }, 4000, 'confirm');
    await clickDialogButton('Overwrite');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 10000, 'uploaded after overwrite');
    const slots = await page.evaluate(H.slots); const trig = await page.evaluate(H.trigger);
    const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (slots[key].level !== '251' || slots[key].cls !== '비숍') throw new Error('overwrite did not land: ' + JSON.stringify(slots[key]));
    const doc = await cloudReq('GET', '/v1/characters/htomer'); if (doc.json.preset.data.stat.level !== '251') throw new Error('cloud not updated: ' + doc.json.preset.data.stat.level);
    if (trig.value !== 'HTomer') throw new Error('selection ' + JSON.stringify(trig));
    return { slot: slots[key], cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('O. row menu: rename HTomer → HTomerX (icon not-uploaded), delete from cloud, delete local', async () => {
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Rename');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'rename dialog');
    await page.evaluate(() => { var i = document.querySelector('.msfix-dialog input'); var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'HTomerX'); i.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickDialogButton('Rename');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HTomerX'; }, 8000, 'renamed trigger');
    const icon1 = await page.evaluate(H.icon); if (icon1 !== 'not-uploaded') throw new Error('icon after rename ' + icon1);
    await page.click('.msfix-charpicker .msfix-sync'); await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 10000, 'uploaded under new name');
    if ((await cloudReq('GET', '/v1/characters/htomerx')).status !== 200) throw new Error('HTomerX not in cloud');
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomerX/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete from cloud');
    await clickDialogButton('Delete from cloud');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'not-uploaded after cloud delete');
    if ((await cloudReq('GET', '/v1/characters/htomerx')).status !== 404) throw new Error('cloud copy still there');
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomerX/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText); }, 4000, 'confirm delete');
    await clickDialogButton('Delete');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    const slots = await page.evaluate(H.slots);
    if (Object.values(slots).some(s => s.label === 'HTomerX')) throw new Error('slot still present ' + JSON.stringify(slots));
    return { remaining: Object.values(slots).map(s => s.label), icon: await page.evaluate(H.icon) };
  });

  await scenario('P. Import JSON…: a native file with "ign" imports as a linked character; a file whose IGN exists offers Replace', async () => {
    const file1 = path.join(DL, 'imp1.json'); fs.writeFileSync(file1, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: 'Imported', ign: 'Imported', data: makeDoc('Imported', 240, '아크', base).preset.data }));
    await openPicker();
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser.accept([file1]);
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Imported'; }, 10000, 'imported + selected');
    const b = await page.evaluate(H.bindings); const k1 = b.selected && b.selected.key; if (!k1 || !b.slots[k1] || b.slots[k1].ign !== 'Imported') throw new Error('binding ' + JSON.stringify(b));
    const file2 = path.join(DL, 'imp2.json'); fs.writeFileSync(file2, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: 'Imported', ign: 'Imported', data: makeDoc('Imported', 241, '아크', base).preset.data }));
    await openPicker();
    const [chooser2] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser2.accept([file2]);
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Imported already exists/.test(d.innerText); }, 6000, 'exists dialog');
    await clickDialogButton('Replace it');
    await waitFor(() => { var s = window.__e2e.ps.getState().preset; return Object.values(s).some(x => x.label === 'Imported' && x.data.stat.level === '241'); }, 6000, 'replaced');
    const slots = await page.evaluate(H.slots);
    if (Object.values(slots).filter(s => s.label === 'Imported').length !== 1) throw new Error('duplicate Imported: ' + JSON.stringify(slots));
    return { slots };
  });

  await scenario('Q. sync icon shows a styled tooltip on hover; unknown IGN lookup fails softly', async () => {
    await page.hover('.msfix-charpicker .msfix-sync'); await wait(300);
    const tip = await page.evaluate(() => { const t = document.querySelector('.msfix-tip'); return t ? { text: t.textContent, w: t.getBoundingClientRect().width, role: t.getAttribute('role') } : null; });
    if (!tip || tip.w < 20 || !tip.text) throw new Error('no tooltip: ' + JSON.stringify(tip));
    await page.mouse.move(5, 5); await wait(200);
    if (await page.evaluate(() => !!document.querySelector('.msfix-tip'))) throw new Error('tooltip did not hide');
    await openPicker(); await page.type('.msfix-charpicker input[role=combobox]', 'NoSuchGuy');
    await clickOption('Load NoSuchGuy from the cloud');
    await waitFor(() => /Could not load NoSuchGuy/.test(document.body.innerText), 6000, 'soft failure toast');
    const errs = pageErrors.filter(e => !/418/.test(e)); if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
    return { tooltip: tip.text.slice(0, 80) };
  });

  await scenario('L. /en (direct load): no picker, IGN search visible', async () => {
    await page.goto('http://localhost:8787/en', { waitUntil: 'networkidle2', timeout: 90000 });
    await wait(3000);
    const r = await page.evaluate(() => ({ picker: !!document.querySelector('.msfix-charpicker'), route: document.documentElement.getAttribute('data-msfix-route'), ignVisible: Array.prototype.some.call(document.querySelectorAll('input[data-slot=input] + button[data-slot=popover-trigger]'), function (b) { return getComputedStyle(b.parentElement.parentElement).display !== 'none'; }) }));
    r.routeStyleDisabled = await page.evaluate(() => { var st = document.getElementById('msfix-cloud-route'); return st ? st.disabled : 'missing'; });
    if (r.picker || !r.ignVisible || r.routeStyleDisabled !== true) throw new Error(JSON.stringify(r));
    return r;
  });

  console.log('PAGE ERRORS:', JSON.stringify(pageErrors));
  console.log('CLOUD REQUESTS:', cloudRequests.length, JSON.stringify(cloudRequests.slice(0, 40)));
  console.log('RESULTS:', JSON.stringify(results.map(r => ({ name: r.name, ok: r.ok, error: r.error }))));
  await browser.close();
  process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(async e => { console.error('FATAL', e); try { await page.screenshot({ path: path.join(DL, 'fatal.png') }); } catch (e2) {} if (browser) await browser.close(); process.exit(2); });
