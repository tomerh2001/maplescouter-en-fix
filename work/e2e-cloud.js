// End-to-end test of the character picker + cloud sync (v1.7.0) against the live site through the
// local proxy (node test/proxy.js → :8787) and a local backend on :8080 (the stub: it serves
// /v1/avatar/:ign for IGNs starting with e2e/htomer and counts those lookups at /__avatar-count).
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
// Real mouse click on the sync icon. Site toasts stack over the header for a few seconds and would take the
// click instead, and they stay for as long as the mouse rests on them, so park the mouse away from the header,
// wait until the point under the icon's centre is the icon itself, click, and park the mouse again.
async function clickSync() {
  await page.mouse.move(5, 5);
  await waitFor(() => { var b = document.querySelector('.msfix-charpicker .msfix-sync'); if (!b) return false; var r = b.getBoundingClientRect(); var e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === b || b.contains(e)); }, 8000, 'sync icon uncovered');
  await page.click('.msfix-charpicker .msfix-sync');
  await page.mouse.move(5, 5);
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
// The delete dialog offers [Cancel] [Delete local] [Delete cloud] [Delete both] for a character with a cloud copy and [Cancel] [Delete] otherwise.
async function clickDeleteLocal() {
  await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText); }, 4000, 'delete dialog');
  const ok = await page.evaluate(() => { var d = document.querySelectorAll('.msfix-dialog'); var bs = Array.from(d[d.length - 1].querySelectorAll('button')); var b = bs.find(x => x.textContent.trim() === 'Delete local') || bs.find(x => x.textContent.trim() === 'Delete'); if (!b) return null; b.click(); return b.textContent.trim(); });
  if (!ok) throw new Error('no local delete button in: ' + (await dialogText()));
  return ok;
}
// Avatar lookups seen by the stub, per lowercase IGN (the traffic budget assertions).
async function avatarCounts() { const r = await cloudReq('GET', '/__avatar-count'); if (r.status !== 200 || !r.json) throw new Error('/__avatar-count ' + r.status); return r.json.counts || {}; }
async function resetAvatarCounts() { const r = await cloudReq('GET', '/__reset-avatar-count'); if (r.status !== 200) throw new Error('/__reset-avatar-count ' + r.status); }
// Labelled buttons of the front-most dialog, in on-screen order. The icon-only corner X (no text) is skipped.
function delBtns() { return page.evaluate(() => { var d = document.querySelectorAll('.msfix-dialog'); return Array.from(d[d.length - 1].querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t !== ''); }); }
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
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    const confirmText = await dialogText();
    await clickDialogButton('Add');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'icon not-uploaded (local first)');
    if ((await cloudReq('GET', '/v1/characters/htomer')).status !== 404) throw new Error('added character was uploaded automatically');
    await clickSync();
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
    await clickSync();
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

  await scenario('D2. an unlabelled preset (label "", no savedAt) stays selected across several autosaves', async () => {
    // The site itself can hold a slot with an empty label and no savedAt. Selecting it stores label "" + savedAt null;
    // the first autosave used to replace the savedAt before the selection was stamped, and the reconciler dropped it.
    await page.evaluate((base) => { var ps = window.__e2e.ps; var cur = ps.getState().preset || {}; var map = {}; for (var k in cur) map[k] = cur[k]; var d = JSON.parse(JSON.stringify(base)); d.stat.level = '245'; d.stat.myClass = '비숍'; var keys = Object.keys(map).map(Number); var nk = String(Math.max.apply(null, keys.concat([0])) + 1); map[nk] = { data: d, label: '' }; ps.getState().setPreset(map); }, base);
    await wait(400);
    await openPicker(); await clickOption('Lv 245 Bishop');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '245'), 8000, 'unlabelled slot loaded');
    const levels = [];
    for (const lv of ['246', '247', '248']) {
      await setDraft({ level: lv }); await wait(900);
      const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === '' && slots[k].cls === '비숍');
      const trig = await page.evaluate(H.trigger); const b = await page.evaluate(H.bindings);
      if (!key || slots[key].level !== lv) throw new Error('autosave ' + lv + ' did not land: ' + JSON.stringify(slots));
      if (!b.selected || b.selected.key !== key || trig.selected !== key) throw new Error('selection dropped after saving ' + lv + ': ' + JSON.stringify({ selected: b.selected, trig }));
      levels.push(slots[key].level);
    }
    // put things back: select Len again and drop the unlabelled slot
    await openPicker(); await clickOption('Len');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '250'), 8000, 'Len loaded again');
    await page.evaluate(() => { var ps = window.__e2e.ps; var cur = ps.getState().preset || {}; var map = {}; for (var k in cur) if (!(cur[k].label === '' && cur[k].data && cur[k].data.stat && cur[k].data.stat.myClass === '비숍')) map[k] = cur[k]; ps.getState().setPreset(map); });
    await wait(400);
    const trig = await page.evaluate(H.trigger); if (trig.value !== 'Len') throw new Error('Len not selected after cleanup: ' + JSON.stringify(trig));
    return { levels };
  });

  await scenario('D3. switching character right after an edit (before the 500 ms autosave) still saves the edit into the old slot', async () => {
    await openPicker();
    await setDraft({ level: '252' });   // arms the autosave timer for Len
    await clickOption('HTomer');        // switch within 500 ms
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '276'), 8000, 'HTomer loaded');
    await wait(900);
    let slots = await page.evaluate(H.slots);
    const len = Object.keys(slots).find(k => slots[k].label === 'Len');
    if (!len || slots[len].level !== '252') throw new Error('Len lost the edit: ' + JSON.stringify(slots[len]));
    const ht = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (!ht || slots[ht].level !== '276') throw new Error('HTomer changed: ' + JSON.stringify(slots[ht]));
    // put Len back to 250 for the later scenarios
    await openPicker(); await clickOption('Len');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '252'), 8000, 'Len loaded again');
    await setDraft({ level: '250' }); await wait(900);
    slots = await page.evaluate(H.slots);
    if (slots[len].level !== '250') throw new Error('Len not restored: ' + JSON.stringify(slots[len]));
    return { lenAfterSwitch: '252', htomer: slots[ht].level };
  });

  await scenario('AV. avatars: opening the dropdown looks up a linked row once (cached after), the row and the closed trigger show the picture, an unlinked row shows the silhouette', async () => {
    // D3 left Len selected; the closed trigger shows the look of the selected character, so pick HTomer
    await openPicker(); await clickOption('HTomer');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HTomer'; }, 8000, 'HTomer selected');
    await wait(300);
    // start from an empty look cache so the dropdown open is the one thing that triggers the lookup
    await page.evaluate(() => localStorage.removeItem('msfix:cloud:avatars'));
    await resetAvatarCounts();
    await openPicker();
    await waitFor(() => { var b = document.querySelector('.msfix-charpicker .msfix-dd .msfix-avatar[data-msfix-avatar="htomer"]'); var i = b && b.querySelector('img'); return !!(i && b.getAttribute('data-msfix-avatar-state') === 'ok' && /\/avatar\.png/.test(i.getAttribute('src') || '')); }, 6000, 'HTomer row painted in place');
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.msfix-charpicker .msfix-dd [role=option]')).map(r => { var b = r.querySelector('.msfix-avatar'); var i = b && b.querySelector('img'); return { text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), box: !!b, first: !!b && b === r.firstElementChild, w: b ? b.getBoundingClientRect().width : 0, state: b && b.getAttribute('data-msfix-avatar-state'), svg: !!(b && b.querySelector('svg')), img: i ? { src: i.getAttribute('src'), alt: i.getAttribute('alt'), lazy: i.getAttribute('loading'), ref: i.getAttribute('referrerpolicy'), drag: i.getAttribute('draggable') } : null }; }));
    const ht = rows.find(r => /HTomer/.test(r.text)), len = rows.find(r => /Len/.test(r.text));
    if (!ht || !ht.box || !ht.first || ht.state !== 'ok' || !ht.img) throw new Error('HTomer row avatar: ' + JSON.stringify(ht));
    if (ht.img.alt !== '' || ht.img.lazy !== 'lazy' || ht.img.ref !== 'no-referrer' || ht.img.drag !== 'false') throw new Error('img attributes: ' + JSON.stringify(ht.img));
    if (Math.round(ht.w) !== 28) throw new Error('avatar box width ' + ht.w);
    if (!len || !len.box || len.state !== 'none' || !len.svg || len.img) throw new Error('unlinked row should show the silhouette: ' + JSON.stringify(len));
    let counts = await avatarCounts();
    if (counts.htomer !== 1) throw new Error('one lookup expected for htomer on open: ' + JSON.stringify(counts));
    if (Object.keys(counts).length !== 1) throw new Error('lookups for unlinked rows: ' + JSON.stringify(counts));
    await page.keyboard.press('Escape');
    await waitFor(() => { var a = document.querySelector('.msfix-charpicker .msfix-avatar-trigger'); var i = a && a.querySelector('img'); return !!(a && !a.hidden && i && /\/avatar\.png/.test(i.getAttribute('src') || '')); }, 4000, 'trigger shows the selected look');
    const trig = await page.evaluate(() => { var a = document.querySelector('.msfix-charpicker .msfix-avatar-trigger'); var i = document.querySelector('.msfix-charpicker input[role=combobox]'); var ar = a.getBoundingClientRect(), ir = i.getBoundingClientRect(); return { w: ar.width, left: ar.left - ir.left, hasClass: i.classList.contains('msfix-has-avatar'), ign: a.getAttribute('data-msfix-avatar') }; });
    if (Math.round(trig.w) !== 20 || trig.left < 0 || trig.left > 20 || !trig.hasClass || trig.ign !== 'htomer') throw new Error('trigger avatar: ' + JSON.stringify(trig));
    // a second open reuses the cache: no new lookup, the row is painted from the start
    await openPicker();
    const state2 = await page.evaluate(() => { var b = document.querySelector('.msfix-charpicker .msfix-dd .msfix-avatar[data-msfix-avatar="htomer"]'); return b && b.getAttribute('data-msfix-avatar-state'); });
    await page.keyboard.press('Escape'); await wait(300);
    counts = await avatarCounts();
    if (counts.htomer !== 1 || state2 !== 'ok') throw new Error('second open: ' + JSON.stringify({ counts, state2 }));
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('msfix:cloud:avatars') || '{}'));
    if (!cached.htomer || !cached.htomer.image || cached.htomer.level !== 291 || cached.htomer.job !== 'Shade' || !cached.htomer.at) throw new Error('cache entry: ' + JSON.stringify(cached));
    return { rows: rows.map(r => r.text + ':' + r.state), counts, trigger: trig, cached: cached.htomer };
  });

  await scenario('AV2. traffic budget: polling, focus, autosave and a re-render never look up a character look', async () => {
    await page.evaluate(() => localStorage.removeItem('msfix:cloud:avatars'));   // nothing cached, so any lookup would go to the stub
    await resetAvatarCounts();
    const reqs0 = cloudRequests.filter(r => /\/v1\/avatar\//.test(r)).length;
    await page.evaluate(() => window.__msfixDebug.pollNow());
    await wait(800);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await wait(800);
    await setDraft({ level: '276' });   // same value: the autosave path runs, the icon stays as it is
    await wait(1200);
    const counts = await avatarCounts();
    const reqs1 = cloudRequests.filter(r => /\/v1\/avatar\//.test(r)).length;
    if (Object.keys(counts).length || reqs1 !== reqs0) throw new Error('avatar lookups outside the dropdown/add flows: ' + JSON.stringify({ counts, reqs: reqs1 - reqs0 }));
    const trig = await page.evaluate(() => { var a = document.querySelector('.msfix-charpicker .msfix-avatar-trigger'); return a ? a.hidden : null; });
    // the closed trigger only shows a cached look and never fetches one
    if (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('msfix:cloud:avatars') || '{}')).length)) throw new Error('cache repopulated without a dropdown open');
    return { counts, triggerHidden: trig, icon: await page.evaluate(H.icon) };
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

  await scenario('F. adding an IGN that is already in the cloud asks one question; "Load from cloud" loads the cloud copy (synced)', async () => {
    const seed = await cloudReq('PUT', '/v1/characters/Existing', makeDoc('Existing', 230, '아란', base));
    if (seed.status !== 201 && seed.status !== 200) throw new Error('seed PUT ' + seed.status);
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/existing$/i.test(r)).length;
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('Existing');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Already in the cloud/.test(d.innerText); }, 8000, 'cloud question dialog');
    const txt = await dialogText();
    await page.screenshot({ path: path.join(DL, 'shot-compare.png') });
    for (const need of ['Already in the cloud', 'Lv 230', 'Aran', 'updated', 'Load the cloud copy, or keep the inputs on the page?']) if (txt.indexOf(need) === -1) throw new Error('missing "' + need + '" in: ' + txt);
    for (const gone of ['Your inputs', 'Cloud copy', 'Upload my inputs', 'Use cloud copy', 'Keep both', 'differ']) if (txt.indexOf(gone) !== -1) throw new Error('old wording "' + gone + '" in: ' + txt);
    const btns = await delBtns();
    if (btns.join('|') !== 'Cancel|Keep my inputs|Load from cloud') throw new Error('buttons: ' + JSON.stringify(btns));
    await clickDialogButton('Load from cloud');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '230') && /Aran/.test(document.body.innerText), 10000, 'form shows Existing');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    await waitFor(() => /Loaded from the cloud/.test(document.body.innerText), 4000, 'toast');
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'Existing');
    if (!key || slots[key].level !== '230') throw new Error('no Existing slot at 230 ' + JSON.stringify(slots));
    const b = await page.evaluate(H.bindings);
    if (!b.slots[key] || b.slots[key].ign !== 'Existing' || b.slots[key].cloudUpdatedAt !== seed.json.updatedAt || !b.selected || b.selected.key !== key) throw new Error('binding ' + JSON.stringify(b));
    if (cloudRequests.filter(r => /^PUT \/v1\/characters\/existing$/i.test(r)).length !== putsBefore) throw new Error('Load from cloud uploaded');
    return { key, dialog: txt.slice(0, 260), buttons: btns };
  });

  await scenario('F2. "Keep my inputs": the character is saved and linked from the page inputs, not uploaded (local-ahead), the cloud copy is untouched', async () => {
    // the form shows Existing (230 Aran); the cloud copy of Existing2 differs by level
    const seed = await cloudReq('PUT', '/v1/characters/Existing2', makeDoc('Existing2', 231, '아란', base));
    if (seed.status !== 201 && seed.status !== 200) throw new Error('seed PUT ' + seed.status);
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/existing2$/i.test(r)).length;
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('Existing2');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Already in the cloud/.test(d.innerText); }, 8000, 'cloud question dialog');
    const txt = await dialogText();
    if (txt.indexOf('Lv 231') === -1) throw new Error('subtitle lacks the cloud meta: ' + txt);
    await clickDialogButton('Keep my inputs');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Existing2'; }, 8000, 'Existing2 selected');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 8000, 'icon local-ahead');
    await waitFor(() => /Saved here\. Click the sync icon to upload\./.test(document.body.innerText), 4000, 'toast');
    await wait(1200);
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'Existing2');
    if (!key || slots[key].level !== '230') throw new Error('slot not from the page inputs: ' + JSON.stringify(slots[key]));
    if (Array.from(Object.values(slots)).filter(s => s.label === 'Existing2').length !== 1) throw new Error('duplicate Existing2 slots');
    const b = await page.evaluate(H.bindings);
    if (!b.slots[key] || b.slots[key].ign !== 'Existing2' || b.slots[key].cloudUpdatedAt !== seed.json.updatedAt || b.slots[key].syncedHash) throw new Error('binding ' + JSON.stringify(b.slots[key]));
    if (cloudRequests.filter(r => /^PUT \/v1\/characters\/existing2$/i.test(r)).length !== putsBefore) throw new Error('Keep my inputs uploaded');
    const doc = await cloudReq('GET', '/v1/characters/existing2');
    if (doc.status !== 200 || doc.json.preset.data.stat.level !== '231' || doc.json.updatedAt !== seed.json.updatedAt) throw new Error('cloud copy changed: ' + JSON.stringify({ status: doc.status, level: doc.json && doc.json.preset.data.stat.level, updatedAt: doc.json && doc.json.updatedAt }));
    // the icon's tooltip says what to do next
    await page.hover('.msfix-charpicker .msfix-sync'); await wait(300);
    const tip = await page.evaluate(() => { const t = document.querySelector('.msfix-tip'); return t ? t.textContent : ''; });
    await page.mouse.move(5, 5); await wait(200);
    if (!/Edited since the last upload\. Click to upload\./.test(tip)) throw new Error('tooltip: ' + tip);
    // the sync icon now offers the plain upload dialog
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload changes to the cloud\?/.test(d.innerText); }, 4000, 'upload dialog');
    await clickDialogButton('Cancel');
    await wait(200);
    // cleanup: drop the local slot and the seeded cloud copy; go back to Existing
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /Existing2/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText); }, 4000, 'delete dialog');
    const dbtns = await delBtns();
    if (dbtns.join('|') !== 'Cancel|Delete local|Delete cloud|Delete both') throw new Error('delete buttons for a linked character with a cloud copy: ' + JSON.stringify(dbtns));
    await clickDialogButton('Delete local');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    const del = await cloudReq('DELETE', '/v1/characters/existing2', null, { 'X-Confirm': 'existing2' });
    if (del.status !== 204) throw new Error('cleanup DELETE ' + del.status);
    await openPicker(); await clickOption('Existing');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Existing'; }, 8000, 'Existing selected again');
    return { key, level: slots[key].level, cloudLevel: doc.json.preset.data.stat.level, tip: tip.slice(0, 80), deleteButtons: dbtns };
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

  await scenario('H. cloud changed elsewhere → poll flags cloud-ahead → "The cloud copy is newer" → Upload mine (If-Match) → synced', async () => {
    const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    // focus polls run at most once a minute and AV2 used one; pollNow runs the same pollTick(true) the focus handler calls
    await page.evaluate(() => window.__msfixDebug.pollNow());
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    await page.hover('.msfix-charpicker .msfix-sync'); await wait(300);
    const tip = await page.evaluate(() => { const t = document.querySelector('.msfix-tip'); return t ? t.textContent : ''; });
    await page.mouse.move(5, 5); await wait(200);
    if (!/The cloud copy is newer\. Click to choose\./.test(tip)) throw new Error('cloud-ahead tooltip: ' + tip);
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /The cloud copy is newer/.test(d.innerText); }, 8000, 'choice dialog');
    const txt = await dialogText();
    for (const need of ['Lv 299', 'updated', 'Yours:', 'edited', 'Show differences', 'Load the cloud copy, or upload yours?']) if (txt.indexOf(need) === -1) throw new Error('missing "' + need + '" in: ' + txt);
    for (const gone of ['Your inputs', 'Cloud copy', 'Upload my inputs', 'Use cloud copy', 'Keep both', 'differs from the cloud']) if (txt.indexOf(gone) !== -1) throw new Error('old wording "' + gone + '" in: ' + txt);
    const btns = await delBtns();
    if (btns.join('|') !== 'Cancel|Load cloud copy|Upload mine') throw new Error('buttons: ' + JSON.stringify(btns));
    // the field list is hidden until asked for
    const diffHidden = await page.evaluate(() => !/Level: yours 276, cloud 299/.test(document.querySelector('.msfix-dialog').innerText));
    if (!diffHidden) throw new Error('diff list shown by default: ' + txt);
    await clickDialogButton('Upload mine');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '276') throw new Error('cloud level after overwrite ' + doc.json.preset.data.stat.level);
    return { dialog: txt.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level, buttons: btns };
  });

  await scenario('H2. cloud re-uploaded with the same inputs: poll flags cloud-ahead, icon click marks synced with no compare dialog and no upload', async () => {
    const cur = await cloudReq('GET', '/v1/characters/htomer');
    if (cur.status !== 200) throw new Error('GET ' + cur.status);
    await wait(5);   // the stub stamps updatedAt from the clock
    const put = await cloudReq('PUT', '/v1/characters/HTomer', { preset: cur.json.preset, label: cur.json.label });
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    if (put.json.updatedAt === cur.json.updatedAt) throw new Error('updatedAt did not change');
    await page.evaluate(() => window.__msfixDebug.pollNow());   // focus polls are throttled and H just used one
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length;
    await clickSync();
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced without a dialog');
    await wait(300);
    if (await page.evaluate(() => !!document.querySelector('.msfix-dialog'))) throw new Error('compare dialog opened for identical inputs: ' + (await dialogText()));
    const putsAfter = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length;
    if (putsAfter !== putsBefore) throw new Error('icon click uploaded identical inputs');
    const b = await page.evaluate(H.bindings); const k = b.selected && b.selected.key;
    if (!k || !b.slots[k] || b.slots[k].cloudUpdatedAt !== put.json.updatedAt) throw new Error('binding did not adopt the cloud stamp: ' + JSON.stringify(b.slots[k]));
    return { cloudUpdatedAt: put.json.updatedAt };
  });

  await scenario('H3. choice dialog from the sync icon: "Show differences" reveals the field list, "Load cloud copy" loads it (synced), no "Keep both" and no new slot', async () => {
    await wait(5);
    const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    await page.evaluate(() => window.__msfixDebug.pollNow());
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length;
    const slotsBefore = await page.evaluate(H.slots);
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /The cloud copy is newer/.test(d.innerText); }, 8000, 'choice dialog');
    const before = await dialogText();
    if (/Keep both/.test(before)) throw new Error('"Keep both" is still offered: ' + before);
    if (/Level: yours/.test(before)) throw new Error('diff list visible before the toggle: ' + before);
    const toggled = await page.evaluate(() => { var d = document.querySelector('.msfix-dialog'); var l = Array.from(d.querySelectorAll('[role=button], span')).find(x => x.textContent.trim() === 'Show differences'); if (!l) return null; l.click(); return l.textContent.trim(); });
    if (toggled === null) throw new Error('no "Show differences" link in: ' + before);
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Hide differences/.test(d.innerText) && /Level: yours 276, cloud 299/.test(d.innerText) && /(field is|fields are) different/.test(d.innerText); }, 3000, 'diff list shown');
    const shown = await dialogText();
    await page.evaluate(() => { var d = document.querySelector('.msfix-dialog'); Array.from(d.querySelectorAll('[role=button], span')).find(x => x.textContent.trim() === 'Hide differences').click(); });
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Show differences/.test(d.innerText) && !/Level: yours 276/.test(d.innerText); }, 3000, 'diff list hidden again');
    await clickDialogButton('Load cloud copy');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '299'), 8000, 'form shows the cloud copy');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after Load cloud copy');
    await waitFor(() => /Loaded the cloud copy/.test(document.body.innerText), 4000, 'toast');
    await wait(300);
    if (await page.evaluate(() => !!document.querySelector('.msfix-dialog'))) throw new Error('a dialog is still open: ' + (await dialogText()));
    const slots = await page.evaluate(H.slots);
    if (Object.keys(slots).length !== Object.keys(slotsBefore).length) throw new Error('slot count changed: ' + JSON.stringify(slots));
    const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (!key || slots[key].level !== '299') throw new Error('slot not replaced by the cloud copy: ' + JSON.stringify(slots[key]));
    const b = await page.evaluate(H.bindings); const k = b.selected && b.selected.key;
    if (k !== key || !b.slots[k] || b.slots[k].cloudUpdatedAt !== put.json.updatedAt) throw new Error('binding did not adopt the cloud version: ' + JSON.stringify(b.slots[k]));
    if (cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length !== putsBefore) throw new Error('Load cloud copy uploaded');
    // put the level back to 276 for the later scenarios (an edit, then an explicit upload)
    await setDraft({ level: '276' });
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead after the edit');
    await wait(900);
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload changes to the cloud\?/.test(d.innerText); }, 4000, 'upload dialog');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after upload');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '276') throw new Error('cloud level after upload ' + doc.json.preset.data.stat.level);
    return { diff: shown.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level, icon: await page.evaluate(H.icon) };
  });

  await scenario('I. auto-upload is off: an edit is saved locally but never uploaded until the icon is clicked', async () => {
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('input')).find(i => i.value === '276'));
    const elh = h.asElement(); if (!elh) throw new Error('no level input 276');
    const puts0 = cloudRequests.filter(r => /^PUT/.test(r)).length;
    await elh.click({ clickCount: 3 }); await page.keyboard.type('277');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead');
    await wait(4500);
    if (cloudRequests.filter(r => /^PUT/.test(r)).length !== puts0) throw new Error('an upload happened without a click');
    await clickSync();
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
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); if (!d || !/Upload changes to the cloud\?/.test(d.innerText)) return false; var names = Array.from(d.querySelectorAll('button')).map(b => b.textContent.trim()); return names.indexOf('Cancel') !== -1 && names.indexOf('Discard my changes') !== -1 && names.indexOf('Upload') !== -1 && /stay in History/.test(d.innerText); }, 4000, 'Cancel/Discard my changes/Upload dialog');
    await clickDialogButton('Discard my changes');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '277'), 8000, 'form restored to 277');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after discard');
    const slots = await page.evaluate(H.slots); const key = Object.keys(slots).find(k => slots[k].label === 'HTomer');
    if (slots[key].level !== '277') throw new Error('slot not restored: ' + JSON.stringify(slots[key]));
    return { level: slots[key].level };
  });

  await scenario('I4. upload hits a 409: "The cloud copy changed" asks one question; Replace uploads without If-Match, Load cloud copy loads it', async () => {
    const conflictOnce = async (level) => {
      await setDraft({ level });
      await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead');
      await wait(900);
      await wait(5);   // the stub stamps updatedAt from the clock
      const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));   // moved elsewhere, no poll yet
      if (put.status !== 200) throw new Error('external PUT ' + put.status);
      await clickSync();
      await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload changes to the cloud\?/.test(d.innerText); }, 4000, 'upload dialog');
      await clickDialogButton('Upload');
      await waitFor(() => { var d = document.querySelectorAll('.msfix-dialog'); var t = d.length ? d[d.length - 1].innerText : ''; return /The cloud copy changed/.test(t); }, 8000, 'conflict dialog');
      const txt = await dialogText();
      for (const need of ['Lv 299', 'updated', 'Replace it with your inputs?']) if (txt.indexOf(need) === -1) throw new Error('missing "' + need + '" in: ' + txt);
      if (/Keep both|Your inputs|Cloud copy\b/.test(txt.replace(/Load cloud copy/g, ''))) throw new Error('old wording in: ' + txt);
      const btns = await delBtns();
      if (btns.join('|') !== 'Cancel|Load cloud copy|Replace') throw new Error('buttons: ' + JSON.stringify(btns));
      return { put, txt, btns };
    };
    // Replace: the local inputs win, sent without If-Match
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length;
    const a = await conflictOnce('278');
    await clickDialogButton('Replace');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after Replace');
    let doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '278') throw new Error('cloud level after Replace ' + doc.json.preset.data.stat.level);
    const puts = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length - putsBefore;
    if (puts !== 2) throw new Error('expected the 409 attempt and the forced upload, saw ' + puts + ' PUTs');
    // Load cloud copy: the cloud inputs replace the form, nothing more is uploaded
    const b = await conflictOnce('279');
    const putsMid = cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length;
    await clickDialogButton('Load cloud copy');
    await waitFor(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '299'), 8000, 'form shows the cloud copy');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after Load cloud copy');
    if (cloudRequests.filter(r => /^PUT \/v1\/characters\/htomer$/i.test(r)).length !== putsMid) throw new Error('Load cloud copy uploaded');
    doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '299' || doc.json.updatedAt !== b.put.json.updatedAt) throw new Error('cloud copy changed by Load cloud copy: ' + JSON.stringify({ level: doc.json.preset.data.stat.level }));
    const bind = await page.evaluate(H.bindings); const k = bind.selected && bind.selected.key;
    if (!k || !bind.slots[k] || bind.slots[k].cloudUpdatedAt !== b.put.json.updatedAt) throw new Error('binding did not adopt the cloud version: ' + JSON.stringify(bind.slots[k]));
    // back to 277 for the later scenarios
    await setDraft({ level: '277' });
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead after restore');
    await wait(900);
    await clickSync();
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after restore');
    doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.level !== '277') throw new Error('cloud level after restore ' + doc.json.preset.data.stat.level);
    return { dialog: a.txt.slice(0, 200), buttons: a.btns, cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('I3. an impossible Main Stat % (4831) flags the row with "check inputs" and the upload asks "Upload anyway"; fixing it uploads normally', async () => {
    const puts0 = cloudRequests.filter(r => /^PUT/.test(r)).length;
    await setDraft({ mainStatPer: '4831' });
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead');
    await openPicker();
    // the chip reads the saved slot, which the autosave writes 500 ms after the edit
    await waitFor(() => /HTomer[^]*check inputs/.test((document.querySelector('.msfix-charpicker .msfix-dd').innerText || '').replace(/\s+/g, ' ')), 3000, 'row flagged with check inputs').catch(async () => { throw new Error('row not flagged: ' + (await dropdownText()).slice(0, 200)); });
    const rowText = await dropdownText();
    await page.keyboard.press('Escape'); await wait(200);
    await clickSync();
    await clickDialogButton('Upload');
    await waitFor(() => { var d = document.querySelectorAll('.msfix-dialog'); var t = d.length ? d[d.length - 1].innerText : ''; return /Check the inputs for HTomer/.test(t) && /Main Stat % is 4831/.test(t); }, 4000, 'warning dialog');
    const warnText = await dialogText();
    await clickDialogButton('Cancel');
    await wait(500);
    if (cloudRequests.filter(r => /^PUT/.test(r)).length !== puts0) throw new Error('uploaded despite Cancel');
    // a valid value that still differs from the cloud copy (restoring the exact synced value would leave nothing to upload)
    const fixed = String((Number(base.stat.mainStatPer) || 800) + 1);
    await setDraft({ mainStatPer: fixed });
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 5000, 'local-ahead after fix');
    await wait(900);
    await clickSync();
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after fix');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (doc.json.preset.data.stat.mainStatPer !== fixed) throw new Error('cloud mainStatPer ' + doc.json.preset.data.stat.mainStatPer);
    return { warnText: warnText.slice(0, 120), cloudMainStatPer: doc.json.preset.data.stat.mainStatPer };
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

  await scenario('M2. a rejected setup (site answers boss300_hexaStat = -5) shows the reason on the row instead of "HEXA: press Result"; a good result replaces it', async () => {
    // The site returns 201 with a negative code in every result field when it refuses the inputs.
    // Replay the last real result with the -5 code so the cache path is exercised without editing the slot.
    const shownErr = await page.evaluate(async () => {
      var ms = window.__e2e.ms; if (typeof ms.setState !== 'function') throw new Error('store has no setState');
      var r = ms.getState().result; window.__e2eGoodResult = r;
      var cd = {}; for (var k in r.calculatedData) cd[k] = r.calculatedData[k]; cd.boss300_hexaStat = -5; cd.boss300_stat = -5; cd.mr_hexaStat = -5; cd.exchangePowerHexa = -5;
      var bad = {}; for (var k2 in r) bad[k2] = r[k2]; bad.calculatedData = cd;
      ms.setState({ result: bad });
      return JSON.parse(localStorage.getItem('msfix:cloud:hexa') || '{}');
    });
    const errEntry = Object.values(shownErr).find(e => e.err === -5);
    if (!errEntry || errEntry.v !== 0) throw new Error('no -5 entry cached: ' + JSON.stringify(shownErr).slice(0, 200));
    await openPicker();
    let ok = false; const t0 = Date.now();
    while (Date.now() - t0 < 4000 && !ok) { ok = await page.evaluate(() => { var r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); return !!r && r.textContent.indexOf('HEXA: impossible setup, check Main Stat %') !== -1; }); if (!ok) await wait(150); }
    if (!ok) throw new Error('error text on row :: ' + (await dropdownText()).slice(0, 200));
    if (/HEXA: press Result/.test(await page.evaluate(() => Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)).textContent))) throw new Error('row still says HEXA: press Result');
    // a later good result for the same inputs replaces the error
    await page.evaluate(() => { var ms = window.__e2e.ms; var r = window.__e2eGoodResult; var cd = {}; for (var k in r.calculatedData) cd[k] = r.calculatedData[k]; var good = {}; for (var k2 in r) good[k2] = r[k2]; good.calculatedData = cd; ms.setState({ result: good }); });
    ok = false; const t1 = Date.now();
    while (Date.now() - t1 < 4000 && !ok) { ok = await page.evaluate(() => { var r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); return !!r && / HEXA/.test(r.textContent) && r.textContent.indexOf('HEXA:') === -1; }); if (!ok) await wait(150); }
    if (!ok) throw new Error('good HEXA back on row :: ' + (await dropdownText()).slice(0, 200));
    await page.keyboard.press('Escape');
    return { errEntry };
  });

  await scenario('M3. no HEXA analysis on file (boss300_hexaStat = -3, boss300_stat normal): the row shows the plain stat, not "HEXA: press Result", and the upload sends hexaConverted null', async () => {
    const stat = await page.evaluate(async () => {
      var ms = window.__e2e.ms; var r = window.__e2eGoodResult || ms.getState().result;
      var cd = {}; for (var k in r.calculatedData) cd[k] = r.calculatedData[k]; cd.boss300_hexaStat = -3; cd.mr_hexaStat = -3; cd.exchangePowerHexa = -3;
      var doc = {}; for (var k2 in r) doc[k2] = r[k2]; doc.calculatedData = cd;
      ms.setState({ result: doc });
      return Math.round(Number(cd.boss300_stat));
    });
    if (!(stat > 0)) return { skipped: 'no positive boss300_stat in the last result' };
    const entry = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('msfix:cloud:hexa') || '{}')).find(e => e.plain));
    if (!entry || entry.v !== stat) throw new Error('no plain entry cached: ' + JSON.stringify(entry));
    const fmt = (stat >= 10000 ? Math.round(stat / 1000) + 'k' : stat >= 1000 ? (stat / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(stat)) + ' stat (no HEXA analysis)';
    await openPicker();
    let ok = false; const t0 = Date.now();
    while (Date.now() - t0 < 4000 && !ok) { ok = await page.evaluate((f) => { var r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); return !!r && r.textContent.indexOf(f) !== -1 && r.textContent.indexOf('HEXA: press Result') === -1; }, fmt); if (!ok) await wait(150); }
    if (!ok) throw new Error('plain stat on row: ' + fmt + ' :: ' + (await dropdownText()).slice(0, 200));
    await page.keyboard.press('Escape');
    // the plain figure stays local: overwriting the cloud copy (same flow as H) must send hexaConverted null
    const put = await cloudReq('PUT', '/v1/characters/HTomer', makeDoc('HTomer', 299, '은월', base));
    if (put.status !== 200) throw new Error('external PUT ' + put.status);
    await page.evaluate(() => window.__msfixDebug.pollNow());
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead');
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /The cloud copy is newer/.test(d.innerText); }, 8000, 'choice dialog');
    await clickDialogButton('Upload mine');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    const doc = await cloudReq('GET', '/v1/characters/htomer');
    if (!doc.json.meta || doc.json.meta.hexaConverted !== null) throw new Error('cloud meta.hexaConverted: ' + JSON.stringify(doc.json.meta));
    // restore the good result so later scenarios see a HEXA figure again
    await page.evaluate(() => { var ms = window.__e2e.ms; var r = window.__e2eGoodResult; if (!r) return; var cd = {}; for (var k in r.calculatedData) cd[k] = r.calculatedData[k]; var good = {}; for (var k2 in r) good[k2] = r[k2]; good.calculatedData = cd; ms.setState({ result: good }); });
    return { stat, fmt, cloudHexaConverted: doc.json.meta.hexaConverted };
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

  await scenario('O5. row menu: a case-only rename (HTomer → htomer) shows the new spelling and keeps the cloud state (icon synced); renaming back restores it', async () => {
    const rename = async (from, to) => {
      await openPicker();
      await page.evaluate((from) => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => x.textContent.indexOf(from) !== -1); r.querySelector('[data-msfix-act=menu]').click(); }, from);
      await clickDialogButton('Rename');
      await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'rename dialog');
      await page.evaluate((to) => { var i = document.querySelector('.msfix-dialog input'); var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, to); i.dispatchEvent(new Event('input', { bubbles: true })); }, to);
      await clickDialogButton('Rename');
      await waitFor(`(function(){ var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ${JSON.stringify(to)}; })()`, 8000, 'renamed trigger ' + to);
    };
    await rename('HTomer', 'htomer');
    let b = await page.evaluate(H.bindings); let k = b.selected && b.selected.key;
    if (!k || !b.slots[k] || b.slots[k].ign !== 'htomer' || b.selected.ign !== 'htomer') throw new Error('binding kept the old case: ' + JSON.stringify(b));
    if (!b.slots[k].cloudUpdatedAt || !b.slots[k].syncedHash) throw new Error('case-only rename dropped the cloud state: ' + JSON.stringify(b.slots[k]));
    const icon1 = await page.evaluate(H.icon); if (icon1 !== 'synced') throw new Error('icon after case-only rename ' + icon1);
    await rename('htomer', 'HTomer');
    b = await page.evaluate(H.bindings); k = b.selected && b.selected.key;
    if (!k || !b.slots[k] || b.slots[k].ign !== 'HTomer') throw new Error('rename back failed: ' + JSON.stringify(b));
    const icon2 = await page.evaluate(H.icon); if (icon2 !== 'synced') throw new Error('icon after renaming back ' + icon2);
    return { ign: b.slots[k].ign, icon: icon2 };
  });
  await scenario('O. row menu: rename HTomer → HTomerX (icon not-uploaded), one Delete entry: Delete cloud, then Delete (local only)', async () => {
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomer/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Rename');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'rename dialog');
    await page.evaluate(() => { var i = document.querySelector('.msfix-dialog input'); var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'HTomerX'); i.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickDialogButton('Rename');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HTomerX'; }, 8000, 'renamed trigger');
    const icon1 = await page.evaluate(H.icon); if (icon1 !== 'not-uploaded') throw new Error('icon after rename ' + icon1);
    // Overwrite while not yet uploaded: the dialog does not mention the cloud, and nothing is uploaded (the icon stays not-uploaded).
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomerX/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Overwrite');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Overwrite this character\?/.test(d.innerText); }, 4000, 'confirm (not uploaded)');
    const sub = await page.evaluate(() => document.querySelector('.msfix-dialog').innerText);
    if (/cloud copy/.test(sub)) throw new Error('confirm mentions the cloud for a never-uploaded character: ' + sub);
    await clickDialogButton('Overwrite'); await wait(1500);
    const icon2 = await page.evaluate(H.icon); if (icon2 !== 'not-uploaded') throw new Error('icon after local overwrite ' + icon2);
    if ((await cloudReq('GET', '/v1/characters/htomerx')).status !== 404) throw new Error('overwrite uploaded a never-uploaded character');
    await clickSync(); await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 10000, 'uploaded under new name');
    if ((await cloudReq('GET', '/v1/characters/htomerx')).status !== 200) throw new Error('HTomerX not in cloud');
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomerX/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    // the row menu has exactly one Delete entry
    const menu = await delBtns();
    if (menu.filter(t => /^Delete/.test(t)).length !== 1 || menu.some(t => /Delete from cloud/.test(t))) throw new Error('row menu delete entries: ' + JSON.stringify(menu));
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText) && /Delete cloud/.test(d.innerText); }, 4000, 'delete dialog');
    const four = await delBtns();
    if (four.join('|') !== 'Cancel|Delete local|Delete cloud|Delete both') throw new Error('delete buttons: ' + JSON.stringify(four));
    const red = await page.evaluate(() => Array.from(document.querySelector('.msfix-dialog').querySelectorAll('button')).filter(b => /text-red-500/.test(b.className)).map(b => b.textContent.trim()));
    if (red.join('|') !== 'Delete local|Delete cloud|Delete both') throw new Error('red buttons: ' + JSON.stringify(red));
    await clickDialogButton('Delete cloud');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'not-uploaded after cloud delete');
    await waitFor(() => /Deleted from the cloud/.test(document.body.innerText), 4000, 'cloud delete toast');
    if ((await cloudReq('GET', '/v1/characters/htomerx')).status !== 404) throw new Error('cloud copy still there');
    const slotsMid = await page.evaluate(H.slots);
    if (!Object.values(slotsMid).some(s => s.label === 'HTomerX')) throw new Error('Delete cloud removed the local copy ' + JSON.stringify(slotsMid));
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HTomerX/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText) && !/Delete cloud/.test(d.innerText); }, 4000, 'delete dialog (local only)');
    const two = await delBtns();
    if (two.join('|') !== 'Cancel|Delete') throw new Error('delete buttons without a cloud copy: ' + JSON.stringify(two));
    await clickDialogButton('Delete');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    const slots = await page.evaluate(H.slots);
    if (Object.values(slots).some(s => s.label === 'HTomerX')) throw new Error('slot still present ' + JSON.stringify(slots));
    return { remaining: Object.values(slots).map(s => s.label), icon: await page.evaluate(H.icon), buttons: four };
  });

  await scenario('O6. Delete both: the cloud copy goes first, then the local character; a failed cloud delete keeps the local copy', async () => {
    await setDraft({ level: '250', myClass: '은월' });
    await wait(700);
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('HBoth');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    await clickDialogButton('Add');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HBoth'; }, 8000, 'HBoth selected');
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload to the cloud\?/.test(d.innerText); }, 4000, 'upload prompt');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced');
    if ((await cloudReq('GET', '/v1/characters/hboth')).status !== 200) throw new Error('HBoth not in the cloud');
    // a cloud delete that fails keeps everything: answer the DELETE with a 500 from the browser side (the stub never sees it)
    const delsBefore = cloudRequests.filter(r => /^DELETE \/v1\/characters\/hboth$/i.test(r)).length;
    const block = r => { if (r.method() === 'DELETE' && /\/v1\/characters\/hboth$/i.test(r.url())) r.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'boom' }) }); else r.continue(); };
    await page.setRequestInterception(true); page.on('request', block);
    try {
      await openPicker();
      await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HBoth/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
      await clickDialogButton('Delete');
      await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText) && /Delete both/.test(d.innerText); }, 4000, 'delete dialog');
      await clickDialogButton('Delete both');
      await waitFor(() => /Could not delete HBoth from the cloud/.test(document.body.innerText), 6000, 'failure toast');
      await wait(300);
    } finally {
      page.off('request', block); await page.setRequestInterception(false);
    }
    const kept = await page.evaluate(H.slots); const keptTrig = await page.evaluate(H.trigger);
    if (!Object.values(kept).some(s => s.label === 'HBoth') || keptTrig.value !== 'HBoth') throw new Error('local copy lost after a failed cloud delete: ' + JSON.stringify({ kept, keptTrig }));
    if ((await cloudReq('GET', '/v1/characters/hboth')).status !== 200) throw new Error('cloud copy gone although the delete failed');
    // now for real
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HBoth/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText) && /Delete both/.test(d.innerText); }, 4000, 'delete dialog');
    await clickDialogButton('Delete both');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after Delete both');
    await waitFor(() => /Deleted here and from the cloud/.test(document.body.innerText), 4000, 'toast');
    const slots = await page.evaluate(H.slots);
    if (Object.values(slots).some(s => s.label === 'HBoth')) throw new Error('slot still present ' + JSON.stringify(slots));
    const doc = await cloudReq('GET', '/v1/characters/hboth');
    if (doc.status !== 404) throw new Error('cloud copy still there: ' + doc.status);
    const b = await page.evaluate(H.bindings);
    if (Object.values(b.slots).some(x => x && x.ign === 'HBoth')) throw new Error('binding left behind: ' + JSON.stringify(b.slots));
    const hist = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}')));
    if (hist.indexOf('hboth') !== -1) throw new Error('history left behind: ' + JSON.stringify(hist));
    return { remaining: Object.values(slots).map(s => s.label), cloud: doc.status, deletes: cloudRequests.filter(r => /^DELETE \/v1\/characters\/hboth$/i.test(r)).length - delsBefore };
  });

  await scenario('O4. Delete local when the site store throws: the binding, selection and history are put back and a toast says so', async () => {
    await setDraft({ level: '250', myClass: '은월' });
    await wait(700);
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('HOrphan');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    await clickDialogButton('Add');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HOrphan'; }, 8000, 'HOrphan selected');
    await setDraft({ level: '251' }); await wait(1500);   // one autosave = one history entry
    const before = await page.evaluate(() => { var b = JSON.parse(localStorage.getItem('msfix:cloud:slots') || '{}'), sel = JSON.parse(localStorage.getItem('msfix:cloud:selected') || 'null'), h = JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}'); return { binding: JSON.stringify(Object.values(b).find(x => x && x.ign === 'HOrphan') || null), selected: sel && sel.label, history: JSON.stringify(h.horphan || null) }; });
    if (before.binding === 'null' || before.selected !== 'HOrphan' || before.history === 'null') throw new Error('setup: ' + JSON.stringify(before));
    // make the site's deletePreset throw once
    await page.evaluate(() => { var ps = window.__e2e.ps; window.__e2eDel = ps.getState().deletePreset; ps.setState({ deletePreset: function () { throw new Error('e2e: store refused'); } }); });
    try {
      await openPicker();
      await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HOrphan/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
      await clickDialogButton('Delete');
      await clickDeleteLocal();
      await waitFor(() => /Could not delete the character/.test(document.body.innerText), 6000, 'failure toast');
      await wait(300);
    } finally {
      await page.evaluate(() => { window.__e2e.ps.setState({ deletePreset: window.__e2eDel }); delete window.__e2eDel; });
    }
    const after = await page.evaluate(() => { var b = JSON.parse(localStorage.getItem('msfix:cloud:slots') || '{}'), sel = JSON.parse(localStorage.getItem('msfix:cloud:selected') || 'null'), h = JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}'); return { binding: JSON.stringify(Object.values(b).find(x => x && x.ign === 'HOrphan') || null), selected: sel && sel.label, history: JSON.stringify(h.horphan || null) }; });
    const slots = await page.evaluate(H.slots);
    if (!Object.values(slots).some(s => s.label === 'HOrphan')) throw new Error('slot gone although the store threw ' + JSON.stringify(slots));
    if (after.binding !== before.binding || after.selected !== before.selected || after.history !== before.history) throw new Error('not restored: ' + JSON.stringify({ before, after }));
    const trig = await page.evaluate(H.trigger); if (trig.value !== 'HOrphan') throw new Error('trigger after failed delete ' + JSON.stringify(trig));
    // clean up: a normal delete now succeeds
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HOrphan/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await clickDeleteLocal();
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after cleanup delete');
    const slots2 = await page.evaluate(H.slots);
    if (Object.values(slots2).some(s => s.label === 'HOrphan')) throw new Error('cleanup delete failed ' + JSON.stringify(slots2));
    return { restored: after, remaining: Object.values(slots2).map(s => s.label) };
  });

  await scenario('O2. local-only IGN created elsewhere: poll flags cloud-ahead, icon click asks instead of overwriting', async () => {
    await setDraft({ level: '250', myClass: '은월' });
    await wait(700);
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('HGhost');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    await clickDialogButton('Add');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'icon not-uploaded');
    // another browser uploads the same IGN
    const put = await cloudReq('PUT', '/v1/characters/HGhost', makeDoc('HGhost', 299, '은월', base));
    if (put.status !== 201 && put.status !== 200) throw new Error('external PUT ' + put.status);
    await page.evaluate(() => window.__msfixDebug.pollNow());
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'cloud-ahead', 8000, 'cloud-ahead after poll');
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/hghost$/i.test(r)).length;
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /The cloud copy is newer/.test(d.innerText); }, 8000, 'choice dialog');
    const txt = await dialogText();
    const btns = await delBtns();
    if (btns.join('|') !== 'Cancel|Load cloud copy|Upload mine') throw new Error('buttons: ' + JSON.stringify(btns));
    await clickDialogButton('Cancel');
    await wait(300);
    const putsAfter = cloudRequests.filter(r => /^PUT \/v1\/characters\/hghost$/i.test(r)).length;
    if (putsAfter !== putsBefore) throw new Error('icon click uploaded without asking');
    const doc = await cloudReq('GET', '/v1/characters/hghost');
    if (doc.status !== 200 || doc.json.preset.data.stat.level !== '299') throw new Error('cloud copy replaced: ' + doc.status + ' ' + JSON.stringify(doc.json && doc.json.preset && doc.json.preset.data.stat.level));
    const b = await page.evaluate(H.bindings); const k = b.selected && b.selected.key;
    if (!k || !b.slots[k] || b.slots[k].cloudUpdatedAt) throw new Error('binding should still be not-uploaded: ' + JSON.stringify(b.slots[k]));
    // cleanup: drop the local slot and the external cloud copy so later scenarios start clean
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HGhost/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await clickDeleteLocal();
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    const del = await cloudReq('DELETE', '/v1/characters/hghost', null, { 'X-Confirm': 'hghost' });
    if (del.status !== 204) throw new Error('cleanup DELETE ' + del.status);
    return { dialog: txt.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level, buttons: btns };
  });

  await scenario('O3. not-uploaded icon click looks first: an IGN created elsewhere (no poll yet) asks instead of overwriting', async () => {
    await setDraft({ level: '250', myClass: '은월' });
    await wait(700);
    await openPicker();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog('HGhost');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    await clickDialogButton('Add');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'icon not-uploaded');
    // another browser uploads the same IGN; this tab has not polled, so the icon still says not-uploaded
    const put = await cloudReq('PUT', '/v1/characters/HGhost', makeDoc('HGhost', 299, '은월', base));
    if (put.status !== 201 && put.status !== 200) throw new Error('external PUT ' + put.status);
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/hghost$/i.test(r)).length;
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /The cloud copy is newer/.test(d.innerText); }, 8000, 'choice dialog');
    const txt = await dialogText();
    if (/Upload to the cloud\?/.test(txt)) throw new Error('blind upload confirm shown instead of the question');
    await clickDialogButton('Cancel');
    await wait(300);
    const putsAfter = cloudRequests.filter(r => /^PUT \/v1\/characters\/hghost$/i.test(r)).length;
    if (putsAfter !== putsBefore) throw new Error('icon click uploaded without asking');
    const doc = await cloudReq('GET', '/v1/characters/hghost');
    if (doc.status !== 200 || doc.json.preset.data.stat.level !== '299') throw new Error('cloud copy replaced: ' + doc.status + ' ' + JSON.stringify(doc.json && doc.json.preset && doc.json.preset.data.stat.level));
    // cleanup: drop the local slot and the external cloud copy so later scenarios start clean
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HGhost/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await clickDeleteLocal();
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    const del = await cloudReq('DELETE', '/v1/characters/hghost', null, { 'X-Confirm': 'hghost' });
    if (del.status !== 204) throw new Error('cleanup DELETE ' + del.status);
    return { dialog: txt.slice(0, 200), cloudLevel: doc.json.preset.data.stat.level };
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

  await scenario('P2. Import JSON…: a file without "ign" whose label looks like an IGN ("Main") imports unbound (no cloud key)', async () => {
    const file3 = path.join(DL, 'imp3.json'); fs.writeFileSync(file3, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: 'Main', data: makeDoc('Main', 242, '아크', base).preset.data }));
    await openPicker();
    const [chooser3] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser3.accept([file3]);
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Main'; }, 10000, 'imported + selected');
    const b = await page.evaluate(H.bindings); const k = b.selected && b.selected.key; if (!k) throw new Error('no selection ' + JSON.stringify(b));
    if (b.slots[k] && b.slots[k].ign) throw new Error('label bound as IGN: ' + JSON.stringify(b.slots[k]));
    const r = await fetch(CLOUD + '/v1/characters/main').catch(() => null); if (r && r.status === 200) throw new Error('"main" reached the cloud');
    return { key: k, binding: b.slots[k] || null };
  });

  await scenario('P3. Set IGN on the unbound "Main" preset moves its history from "slot:Main" to "main" (History still lists the edit)', async () => {
    await setDraft({ level: '243' });
    await waitFor(() => { var h = JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}'); return !!(h['slot:Main'] && h['slot:Main'].length); }, 4000, 'edit history under slot:Main');
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /Main/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Set IGN');
    await waitFor(() => { var i = document.querySelector('.msfix-dialog input'); return !!i && i.value === 'Main'; }, 4000, 'add dialog prefilled with Main');
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    await clickDialogButton('Add');
    await waitFor(() => { var b = JSON.parse(localStorage.getItem('msfix:cloud:slots') || '{}'); return Object.keys(b).some(k => b[k].ign === 'Main'); }, 6000, 'Main bound');
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('msfix:cloud:history') || '{}'));
    if (hist['slot:Main']) throw new Error('history left under slot:Main');
    if (!hist.main || !hist.main.length) throw new Error('no history under main: ' + JSON.stringify(Object.keys(hist)));
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /Main/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('History');
    await waitFor(() => { var d = document.querySelectorAll('.msfix-dialog'); var last = d[d.length - 1]; return last && /History/.test(last.innerText) && last.querySelectorAll('button').length >= 2; }, 4000, 'history dialog lists the edit');
    const text = await dialogText(); if (/No saves yet/.test(text)) throw new Error('History shows "No saves yet" after linking');
    await clickDialogButton('Cancel');
    return { historyKeys: Object.keys(hist), entries: hist.main.length, dialog: text.slice(0, 120) };
  });

  await scenario('P4. Import JSON…: a number stored as text and a short array are read as they are; one unreadable field is reset and a toast says so', async () => {
    const d = makeDoc('Mixed', 244, '아크', base).preset.data;
    if (!(d.hexa && typeof d.hexa.hexaStat === 'number' && d.doping && Array.isArray(d.doping.nobless) && typeof d.hexa.skillCore1 === 'string')) return { skipped: 'fixture shape changed' };
    // Missing or unreadable fields are filled from the site's default userStat, not from another slot.
    const dflt = await page.evaluate(() => { var d = window.__msfixDebug && window.__msfixDebug.defaultUserStat; return d ? { skillCore1: d.hexa.skillCore1, noblessLast: d.doping.nobless[d.doping.nobless.length - 1] } : null; });
    const want = { hexaStat: d.hexa.hexaStat, noblessLen: d.doping.nobless.length, noblessLast: dflt ? dflt.noblessLast : d.doping.nobless[d.doping.nobless.length - 1], skillCore1: dflt ? dflt.skillCore1 : base.hexa.skillCore1 };
    d.hexa.hexaStat = String(d.hexa.hexaStat);          // number stored as text: kept, read as a number
    d.doping.nobless = d.doping.nobless.slice(0, -1);    // one entry short: kept, the last one filled in
    d.hexa.skillCore1 = { bad: true };                   // unreadable: reset, reported
    const file4 = path.join(DL, 'imp4.json'); fs.writeFileSync(file4, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: 'Mixed', ign: 'Mixed', data: d }));
    await openPicker();
    const [chooser4] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser4.accept([file4]);
    await waitFor(() => /1 field in this file could not be read and was reset/.test(document.body.innerText), 8000, 'reset toast');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Mixed'; }, 10000, 'imported + selected');
    const got = await page.evaluate(() => { var m = window.__e2e.ps.getState().preset; var s = Object.values(m).find(x => x.label === 'Mixed'); return s && { hexaStat: s.data.hexa.hexaStat, noblessLen: s.data.doping.nobless.length, noblessLast: s.data.doping.nobless[s.data.doping.nobless.length - 1], skillCore1: s.data.hexa.skillCore1 }; });
    if (!got) throw new Error('Mixed slot missing');
    if (got.hexaStat !== want.hexaStat) throw new Error('hexaStat not read as a number: ' + JSON.stringify(got));
    if (got.noblessLen !== want.noblessLen || got.noblessLast !== want.noblessLast) throw new Error('nobless not padded: ' + JSON.stringify(got));
    if (got.skillCore1 !== want.skillCore1) throw new Error('skillCore1 not reset: ' + JSON.stringify(got));
    return got;
  });

  await scenario('P5. Import JSON…: a file carrying meta.hexaConverted shows its HEXA figure on the row before Result is pressed; Download JSON writes the same block', async () => {
    const d = makeDoc('HexaFile', 245, '아크', base).preset.data;
    const file5 = path.join(DL, 'imp5.json'); fs.writeFileSync(file5, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: 'HexaFile', ign: 'HexaFile', data: d, meta: { hexaConverted: 123456 } }));
    await openPicker();
    const [chooser5] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser5.accept([file5]);
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'HexaFile'; }, 10000, 'imported + selected');
    const cached = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('msfix:cloud:hexa') || '{}')).some(e => e.v === 123456));
    if (!cached) throw new Error('msfix:cloud:hexa not seeded from meta.hexaConverted');
    await openPicker();
    const row = await page.evaluate(() => { var r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /HexaFile/.test(x.textContent)); return r ? r.textContent.replace(/\s+/g, ' ') : null; });
    if (!row || row.indexOf('123k HEXA') === -1) throw new Error('row lacks 123k HEXA: ' + row);
    // the round trip: Download JSON on the selected character carries the figure back out
    for (const f of fs.readdirSync(DL)) if (/^scouter-character-HexaFile/.test(f)) fs.unlinkSync(path.join(DL, f));
    await clickOption('Download JSON...');
    let files = []; const t0 = Date.now();
    while (Date.now() - t0 < 8000) { files = fs.readdirSync(DL).filter(f => /^scouter-character-HexaFile/.test(f) && !/crdownload$/.test(f)); if (files.length) break; await wait(200); }
    if (!files.length) throw new Error('no download after 8s');
    const o = JSON.parse(fs.readFileSync(path.join(DL, files[0]), 'utf8'));
    if (!o.meta || o.meta.hexaConverted !== 123456) throw new Error('downloaded file meta: ' + JSON.stringify(o.meta));
    return { row, meta: o.meta };
  });

  await scenario('S. stub validates like the real server: a 70-char label is a 400, an oversized body a 413, the latest IGN case wins; the client shows the 400 toast', async () => {
    // contract checks straight against :8080 (validate.ts: label <= 64, data sections, meta ranges, 256 KB body limit)
    const long = new Array(71).join('x');
    const bad = [
      ['label', Object.assign(makeDoc('StubGuy', 250, '은월', base), { label: long })],
      ['preset.label', (() => { const d = makeDoc('StubGuy', 250, '은월', base); d.preset.label = long; return d; })()],
      ['meta.level', Object.assign(makeDoc('StubGuy', 250, '은월', base), { meta: { level: 301 } })],
      ['meta.hexaConverted', Object.assign(makeDoc('StubGuy', 250, '은월', base), { meta: { hexaConverted: -1 } })],
      ['data.hexa', (() => { const d = makeDoc('StubGuy', 250, '은월', base); delete d.preset.data.hexa; return d; })()],
    ];
    for (const [what, doc] of bad) { const r = await cloudReq('PUT', '/v1/characters/StubGuy', doc); if (r.status !== 400 || !r.json || r.json.error !== 'invalid_body') throw new Error(what + ': expected 400 invalid_body, got ' + r.status + ' ' + JSON.stringify(r.json)); }
    const big = makeDoc('StubGuy', 250, '은월', base); big.preset.data.stat.note = new Array(300 * 1024).join('y');
    const r413 = await cloudReq('PUT', '/v1/characters/StubGuy', big); if (r413.status !== 413) throw new Error('expected 413, got ' + r413.status);
    const ok1 = await cloudReq('PUT', '/v1/characters/StubGuy', makeDoc('StubGuy', 250, '은월', base)); if (ok1.status !== 201) throw new Error('valid PUT ' + ok1.status);
    const ok2 = await cloudReq('PUT', '/v1/characters/STUBGUY', makeDoc('STUBGUY', 251, '은월', base)); if (ok2.status !== 200) throw new Error('second PUT ' + ok2.status);
    const got = await cloudReq('GET', '/v1/characters/stubguy'); if (!got.json || got.json.ign !== 'STUBGUY') throw new Error('latest writer case not kept: ' + JSON.stringify(got.json && got.json.ign));
    await cloudReq('DELETE', '/v1/characters/stubguy', null, { 'X-Confirm': 'stubguy' });
    // client side: a linked import whose label is 70 characters, then the sync icon; the site must surface the 400
    const file4 = path.join(DL, 'imp4.json'); fs.writeFileSync(file4, JSON.stringify({ type: 'maplescouter-manual-preset', v: 1, savedAt: new Date().toISOString(), label: long, ign: 'LongLabel', data: makeDoc('LongLabel', 244, '아크', base).preset.data }));
    await openPicker();
    const [chooser4] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickOption('Import JSON...')]);
    await chooser4.accept([file4]);
    await waitFor(() => { var b = JSON.parse(localStorage.getItem('msfix:cloud:slots') || '{}'); var s = JSON.parse(localStorage.getItem('msfix:cloud:selected') || 'null'); return !!(s && b[s.key] && b[s.key].ign === 'LongLabel'); }, 10000, 'LongLabel imported + selected');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') !== 'synced', 8000, 'icon not synced');
    const putsBefore = cloudRequests.filter(r => /^PUT \/v1\/characters\/longlabel$/i.test(r)).length;
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload/.test(d.innerText); }, 8000, 'upload confirm');
    await clickDialogButton('Upload');
    const outcome = await waitFor(() => { if (/Cloud upload failed \(400/.test(document.body.innerText)) return 'toast'; var i = document.querySelector('.msfix-sync'); return i && i.getAttribute('data-msfix-sync') === 'synced' ? 'synced' : null; }, 10000, '400 toast or synced');
    const putsAfter = cloudRequests.filter(r => /^PUT \/v1\/characters\/longlabel$/i.test(r)).length;
    if (putsAfter === putsBefore) throw new Error('no PUT was sent');
    const doc = await cloudReq('GET', '/v1/characters/longlabel');
    if (outcome === 'toast' && doc.status !== 404) throw new Error('400 toast shown but the cloud has the character: ' + doc.status);
    if (outcome === 'synced' && (doc.status !== 200 || String(doc.json.label).length > 64)) throw new Error('synced but cloud label is ' + JSON.stringify(doc.json && doc.json.label));
    // cleanup so later scenarios start clean
    await openPicker();
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.msfix-dd [role=option]')).find(x => /LongLabel|xxxxxxxx/.test(x.textContent)); r.querySelector('[data-msfix-act=menu]').click(); });
    await clickDialogButton('Delete');
    await clickDeleteLocal();
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === ''; }, 8000, 'deselected after delete');
    if (doc.status === 200) await cloudReq('DELETE', '/v1/characters/longlabel', null, { 'X-Confirm': 'longlabel' });
    return { outcome, rejected: bad.map(b => b[0]), cloud: doc.status };
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

  await scenario('Q2. Enter after typing a saved name selects that character instead of opening Add character', async () => {
    await page.keyboard.press('Escape'); await wait(200);
    await openPicker(); await page.type('.msfix-charpicker input[role=combobox]', 'Len');
    await page.keyboard.press('Enter');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Len' && !document.querySelector('.msfix-dialog'); }, 8000, 'Len selected by Enter');
    if (await page.evaluate(() => !!document.querySelector('.msfix-dialog'))) throw new Error('Add dialog opened for a saved name');
    // a partial name that lists exactly one saved character also selects it
    await openPicker(); await page.type('.msfix-charpicker input[role=combobox]', 'Mai');
    await page.keyboard.press('Enter');
    await waitFor(() => { var i = document.querySelector('.msfix-charpicker input[role=combobox]'); return !!i && i.value === 'Main' && !document.querySelector('.msfix-dialog'); }, 8000, 'Main selected by Enter on a partial name');
    return { trigger: (await page.evaluate(H.trigger)).value };
  });

  await scenario('Q3. keyboard: ArrowRight opens the row menu with focus inside it; keys there never reach the picker; Tab wraps; Escape hands focus back to the input without reopening', async () => {
    await page.keyboard.press('Escape'); await wait(200);
    await openPicker();
    await page.keyboard.press('ArrowDown'); await wait(100);
    await page.keyboard.press('ArrowRight');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Overwrite/.test(d.innerText) && d.contains(document.activeElement); }, 4000, 'row menu with focus inside it');
    const ddHidden = () => page.evaluate(() => document.querySelector('.msfix-charpicker .msfix-dd').hidden);
    await page.keyboard.press('ArrowDown'); await wait(150); await page.keyboard.type('x'); await wait(150);
    if (!(await ddHidden())) throw new Error('dropdown reopened under the dialog');
    const first = await page.evaluate(() => document.activeElement.textContent.trim());
    if (first !== 'Overwrite') throw new Error('first control not focused: ' + first);
    const lastText = await page.evaluate(() => { var bs = document.querySelector('.msfix-dialog').querySelectorAll('button'); return bs[bs.length - 1].textContent.trim(); });
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await wait(100);
    const wrapped = await page.evaluate(() => ({ inDialog: document.querySelector('.msfix-dialog').contains(document.activeElement), text: document.activeElement.textContent.trim() }));
    if (!wrapped.inDialog || wrapped.text !== lastText) throw new Error('Shift+Tab did not wrap to the last control: ' + JSON.stringify(wrapped));
    await page.keyboard.press('Tab'); await wait(100);
    const back = await page.evaluate(() => document.activeElement.textContent.trim());
    if (back !== 'Overwrite') throw new Error('Tab did not wrap back to the first control: ' + back);
    await page.keyboard.press('Escape');
    await waitFor(() => !document.querySelector('.msfix-dialog'), 4000, 'dialog closed'); await wait(150);
    const after = await page.evaluate(() => ({ focusOnInput: document.activeElement === document.querySelector('.msfix-charpicker input[role=combobox]'), ddHidden: document.querySelector('.msfix-charpicker .msfix-dd').hidden }));
    if (!after.focusOnInput || !after.ddHidden) throw new Error('focus not handed back quietly: ' + JSON.stringify(after));
    await page.keyboard.press('ArrowDown');
    await waitFor(() => !document.querySelector('.msfix-charpicker .msfix-dd').hidden, 3000, 'ArrowDown reopens the dropdown');
    await page.keyboard.press('Escape'); await wait(200);
    return after;
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
