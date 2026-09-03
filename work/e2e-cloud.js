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
  stores: `(function(){ var wp=null; try{ self.webpackChunk_N_E.push([[Symbol('e2e')],{},function(r){wp=r;}]); }catch(e){} if(!wp) return null; var ps=null, ms=null;
    for (var id in wp.m){ var ex; try{ ex=wp(id);}catch(e){continue;} if(!ex||(typeof ex!=='object'&&typeof ex!=='function')) continue; var ns=Object.keys(ex); for(var i=0;i<ns.length;i++){ var v=ex[ns[i]]; if(!v||typeof v.getState!=='function') continue; try{ var st=v.getState(); if(st&&st.preset&&typeof st.setPreset==='function') ps=v; if(st&&('draftStat' in st)&&typeof st.loadDraft==='function') ms=v; }catch(e){} } if(ps&&ms) break; }
    window.__e2e={ps:ps,ms:ms}; return !!(ps&&ms); })()`,
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
  await page.evaluateOnNewDocument((cloud) => { try { localStorage.setItem('msfix:locale', 'en'); localStorage.setItem('region', JSON.stringify({ state: { region: 'gms' }, version: 0 })); localStorage.setItem('msfix:cloud:url', cloud); } catch (e) {} }, CLOUD);

  await page.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 90000 });
  await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker mounted');
  await page.evaluate(H.stores);
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
    await page.evaluate(H.stores);
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
    await clickDialogButton('Continue');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Save current inputs as HTomer/.test(d.innerText); }, 6000, '404 confirm dialog');
    const confirmText = await dialogText();
    await clickDialogButton('Save & upload');
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

  await scenario('E. selecting a cloud-only character imports it as a local slot and loads it', async () => {
    const put = await cloudReq('PUT', '/v1/characters/CloudGuy', makeDoc('CloudGuy', 260, '나이트로드', base));
    if (put.status !== 201 && put.status !== 200) throw new Error('seed PUT ' + put.status);
    await page.evaluate(() => { window.__e2eList = 1; });
    await openPicker();
    await waitFor(() => /CloudGuy/.test(document.querySelector('.msfix-charpicker .msfix-dd').innerText), 10000, 'cloud row listed');
    const txt = await dropdownText();
    await clickOption('CloudGuy');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '260') && /Night Lord/.test(document.body.innerText), 10000, 'form shows CloudGuy');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const slots = await page.evaluate(H.slots); const b = await page.evaluate(H.bindings);
    const key = Object.keys(slots).find(k => slots[k].label === 'CloudGuy'); if (!key || !b.slots[key] || b.slots[key].ign !== 'CloudGuy') throw new Error('import binding ' + JSON.stringify({ slots, b }));
    return { key, cloudSection: txt.slice(txt.indexOf('CLOUD'), txt.indexOf('CLOUD') + 120) };
  });

  await scenario('F. comparison dialog when adding an IGN that exists in the cloud; "Replace local" loads the cloud version', async () => {
    await cloudReq('PUT', '/v1/characters/Existing', makeDoc('Existing', 230, '아란', base));
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('Existing');
    await clickDialogButton('Continue');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /exists in the cloud/.test(d.innerText); }, 8000, 'comparison dialog');
    const txt = await dialogText();
    await page.screenshot({ path: path.join(DL, 'shot-compare.png') });
    for (const need of ['Local —', 'Cloud — Existing', 'Overwrite cloud with current inputs', 'Replace local with cloud version', 'differ']) if (txt.indexOf(need) === -1) throw new Error('missing "' + need + '" in: ' + txt);
    await clickDialogButton('Replace local with cloud version');
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
    await openPicker(); await clickOption('Save window');
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

  await scenario('H. cloud changed elsewhere → focus poll flags cloud-ahead → compare → overwrite cloud (If-Match) → synced', async () => {
    const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    await page.click('.msfix-charpicker .msfix-sync');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /local and cloud differ/.test(d.innerText); }, 8000, 'compare dialog');
    const txt = await dialogText();
    await clickDialogButton('Overwrite cloud with current inputs');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '276') throw new Error('cloud level after overwrite ' + doc.json.preset.data.stat.level);
    return { dialog: txt.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('I. auto-upload toggle: edit → uploaded within ~4 s without clicking', async () => {
    await openPicker(); await clickOption('Auto-upload changes');
    await page.keyboard.press('Escape');
    const on = await page.evaluate(() => localStorage.getItem('msfix:cloud:auto')); if (on !== 'true') throw new Error('toggle ' + on);
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '276'));
    const elh = h.asElement(); if (!elh) throw new Error('no level input 276');
    await elh.click({ clickCount: 3 }); await page.keyboard.type('277');
    const t0 = Date.now();
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 7000, 'auto-uploaded');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '277') throw new Error('cloud level ' + doc.json.preset.data.stat.level);
    await openPicker(); await clickOption('Auto-upload changes'); await page.keyboard.press('Escape');
    return { ms: Date.now() - t0, cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('J. cloud toggle off: icon "off", no cloud rows, zero network calls', async () => {
    await openPicker(); await clickOption('Cloud sync');
    await wait(300);
    const n0 = cloudRequests.length;
    await page.keyboard.press('Escape'); await wait(200);
    await openPicker(); const txt = await dropdownText(); await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await wait(1500);
    const icon = await page.evaluate(H.icon);
    if (txt.indexOf('CLOUD') !== -1 || icon !== 'off' || cloudRequests.length !== n0) throw new Error(JSON.stringify({ icon, reqs: cloudRequests.slice(n0), txt: txt.slice(0, 150) }));
    await openPicker(); await clickOption('Cloud sync'); await page.keyboard.press('Escape');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') !== 'off', 5000, 'back on');
    return { icon, footer: txt.slice(txt.indexOf('Cloud sync'), txt.indexOf('Cloud sync') + 60) };
  });

  await scenario('K. reload keeps selection + bindings; native Reset deselects instead of overwriting the slot', async () => {
    await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
    await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker after reload');
    await page.evaluate(H.stores);
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
