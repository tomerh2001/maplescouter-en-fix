// Gecko runtime smoke test of the userscript (translation + character picker + cloud sync) in Firefox,
// driven by puppeteer over WebDriver BiDi. Modelled on e2e-cloud.js but CDP-free: no download interception,
// no CDP session. Runs against the live site through the local proxy (node test/proxy.js -> :8787) and the
// cloud stub on :8080 (serves /v1/avatar/:ign for IGNs starting with e2e).
// Run from work/:  node e2e-firefox.js [firefox-executable]
// The Firefox binary defaults to the newest ~/.cache/puppeteer/firefox/*/Firefox.app installed by
// `npx @puppeteer/browsers install firefox@stable --path ~/.cache/puppeteer`.
const puppeteer = require('puppeteer'); const fs = require('fs'); const path = require('path'); const http = require('http'); const os = require('os');
const CLOUD = 'http://localhost:8080';
const OUT = path.join(__dirname, 'out', 'e2e-firefox');
const IGN = 'e2efox';
const results = []; let page, browser;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function findFirefox() {
  if (process.argv[2]) return process.argv[2];
  const root = path.join(os.homedir(), '.cache', 'puppeteer', 'firefox');
  try {
    const dirs = fs.readdirSync(root).filter(d => /^mac_/.test(d)).sort();
    for (let i = dirs.length - 1; i >= 0; i--) { const p = path.join(root, dirs[i], 'Firefox.app', 'Contents', 'MacOS', 'firefox'); if (fs.existsSync(p)) return p; }
  } catch (e) {}
  return undefined;   // let puppeteer resolve its pinned build
}
// Extra arguments after `label` are passed to the in-page function (closures do not cross into the page).
async function waitFor(fn, timeout, label, ...args) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await page.evaluate(fn, ...args); if (v) return v; await wait(120); }
  throw new Error('timeout: ' + (label || fn.toString().slice(0, 80)));
}
function cloudReq(method, p, body, headers) {
  return new Promise((res, rej) => {
    const u = new URL(CLOUD + p);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, r => {
      const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(ch).toString()); } catch (e) {} res({ status: r.statusCode, json: j }); });
    });
    rq.on('error', rej); if (body) rq.write(JSON.stringify(body)); rq.end();
  });
}
async function scenario(name, fn) {
  try { const info = await fn(); results.push({ name, ok: true, info }); console.log('PASS', name, info ? JSON.stringify(info).slice(0, 300) : ''); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.message || e) }); console.log('FAIL', name, e && e.message); try { await page.screenshot({ path: path.join(OUT, 'fail-' + name.replace(/\W+/g, '_') + '.png') }); } catch (e2) {} }
}
// in-page helpers (ES5, evaluated in the page)
const H = {
  stores: `(function(){ var d=window.__msfixDebug; var ps=d&&d.presetStore, ms=d&&d.manualStore; window.__e2e={ps:ps,ms:ms}; return !!(ps&&ms); })()`,
  slots: `(function(){ var m=window.__e2e.ps.getState().preset||{}; var o={}; for(var k in m) o[k]={label:m[k].label, level:m[k].data&&m[k].data.stat&&m[k].data.stat.level, cls:m[k].data&&m[k].data.stat&&m[k].data.stat.myClass, savedAt:m[k].savedAt}; return o; })()`,
  bindings: `(function(){ try { return { slots: JSON.parse(localStorage.getItem('msfix:cloud:slots')||'{}'), selected: JSON.parse(localStorage.getItem('msfix:cloud:selected')||'null') }; } catch(e){ return null; } })()`,
  icon: `(function(){ var b=document.querySelector('.msfix-charpicker .msfix-sync'); return b? b.getAttribute('data-msfix-sync') : null; })()`,
  trigger: `(function(){ var i=document.querySelector('.msfix-charpicker input[role=combobox]'); return i? {value:i.value, placeholder:i.placeholder, selected:i.getAttribute('data-msfix-selected')} : null; })()`,
};
async function setDraft(patch) {
  return page.evaluate((patch) => { var ms = window.__e2e.ms; var d = JSON.parse(JSON.stringify(ms.getState().draftStat)); for (var k in patch) d.stat[k] = patch[k]; ms.getState().setDraftStat(d); return d.stat.level; }, patch);
}
async function openPicker() {
  await page.click('.msfix-charpicker input[role=combobox]');
  await waitFor(() => { var d = document.querySelector('.msfix-charpicker .msfix-dd'); return d && !d.hidden; }, 3000, 'dropdown open');
  await wait(300);
}
// Real mouse click on the sync icon; site toasts can cover the header for a few seconds, so wait until the icon is on top.
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
// Labelled buttons of the front-most dialog, in on-screen order (the icon-only corner X is skipped).
function dialogButtons() { return page.evaluate(() => { var d = document.querySelectorAll('.msfix-dialog'); return Array.from(d[d.length - 1].querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t !== ''); }); }
async function levelInput(value) {
  const h = await page.evaluateHandle((v) => Array.from(document.querySelectorAll('input')).find(i => i.value === String(v)), value);
  const el = h.asElement(); if (!el) throw new Error('no input showing ' + value);
  return el;
}
// Type `next` over the input showing `current`. A triple click does not select the digits in Firefox when the
// click lands left of right-aligned text (the caret goes to the start), so select the text first, then type.
async function retype(current, next) {
  const el = await levelInput(current);
  await el.click(); await el.evaluate(i => i.select()); await page.keyboard.type(String(next));
  const v = await el.evaluate(i => i.value); if (v !== String(next)) throw new Error('input shows ' + v + ' after typing ' + next);
}
async function gotoInput() {
  await page.goto('http://localhost:8787/en/input', { waitUntil: 'networkidle2', timeout: 90000 });
  await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker mounted');
  await waitFor(H.stores, 10000, 'stores');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const executablePath = findFirefox();
  browser = await puppeteer.launch({ browser: 'firefox', headless: true, executablePath });
  const version = await browser.version();
  console.log('BROWSER', version, executablePath || '(puppeteer default)');
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e && e.message || e).slice(0, 200)));
  const consoleErrors = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') consoleErrors.push(m.type() + ': ' + m.text().slice(0, 200)); });
  const cloudRequests = []; page.on('request', r => { if (r.url().indexOf(CLOUD) === 0) cloudRequests.push(r.method() + ' ' + r.url().slice(CLOUD.length)); });
  await page.evaluateOnNewDocument((cloud) => { try { localStorage.setItem('msfix:locale', 'en'); localStorage.setItem('msfix:debug', '1'); localStorage.setItem('region', JSON.stringify({ state: { region: 'gms' }, version: 0 })); localStorage.setItem('msfix:cloud:url', cloud); } catch (e) {} }, CLOUD);

  const cleanup = await cloudReq('DELETE', '/v1/characters/' + IGN, null, { 'X-Confirm': IGN });   // a rerun must take the 404 path again
  console.log('stub cleanup', cleanup.status);
  await gotoInput();
  await wait(1500);   // let the idle-time translation pass settle

  await scenario('A. /en/input loads: header credit present, a known translated string, no raw Korean label in the preset row area', async () => {
    return page.evaluate(() => {
      var hangul = /[가-힯ᄀ-ᇿ㄰-㆏]/;
      var credit = document.querySelector('.msfix-credit');
      var svg = document.querySelector('button[data-slot=dialog-trigger] > svg.lucide-file-down');
      if (!svg) throw new Error('native Load trigger not found');
      var row = svg.parentElement.parentElement;
      var area = row.parentElement;
      var rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
      var areaText = (area.textContent || '').replace(/\s+/g, ' ').trim();
      var body = document.body.innerText || '';
      var known = ['Hard Reset', 'Level', 'Class'].filter(function (s) { return body.indexOf(s) !== -1; });
      var r = { credit: credit ? credit.textContent : null, creditVisible: !!(credit && credit.offsetWidth), route: document.documentElement.getAttribute('data-msfix-route'), rowText: rowText.slice(0, 120), areaText: areaText.slice(0, 200), known: known, koreanInRow: hangul.test(rowText), koreanInArea: hangul.test(areaText), title: document.title };
      if (!credit || credit.textContent !== 'Patched by Tomerh2001') throw new Error('credit missing ' + JSON.stringify(r));
      if (!known.length) throw new Error('no known translated string on the page ' + JSON.stringify(r));
      if (r.koreanInRow || r.koreanInArea) throw new Error('raw Korean in the preset row area ' + JSON.stringify(r));
      return r;
    });
  });

  await scenario('B. character picker mounts in the header; native Load/Save row hidden', async () => {
    return page.evaluate(() => {
      var row = document.querySelector('button[data-slot=dialog-trigger] > svg.lucide-file-down').parentElement.parentElement;
      var w = document.querySelector('.msfix-charpicker');
      var r = { rowDisplay: getComputedStyle(row).display, picker: !!w, pickerInHeader: !!w && w.parentElement === row.parentElement, pickerVisible: !!w && w.getBoundingClientRect().width > 0, icon: document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync'), routeStyleEnabled: !!document.getElementById('msfix-cloud-route') && !document.getElementById('msfix-cloud-route').disabled, trigger: !!document.querySelector('.msfix-charpicker input[role=combobox]') };
      if (r.rowDisplay !== 'none' || !r.picker || !r.pickerInHeader || !r.pickerVisible || r.icon !== 'none' || !r.routeStyleEnabled || !r.trigger) throw new Error('bad state ' + JSON.stringify(r));
      return r;
    });
  });

  await scenario('C. "+ Add character" with IGN ' + IGN + ' (stub 404) creates a local character, icon not-uploaded', async () => {
    await setDraft({ level: '275', myClass: '은월' });
    await wait(700);
    await openPicker();
    const before = await dropdownText();
    await clickOption('+ Add character');
    await waitFor(() => !!document.querySelector('.msfix-dialog input'), 4000, 'add dialog');
    await typeInDialog(IGN);
    await clickDialogButton('Add');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Add this character\?/.test(d.innerText); }, 6000, '404 confirm dialog');
    const confirmText = await dialogText();
    await clickDialogButton('Add');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'not-uploaded', 8000, 'icon not-uploaded');
    if ((await cloudReq('GET', '/v1/characters/' + IGN)).status !== 404) throw new Error('added character was uploaded automatically');
    const slots = await page.evaluate(H.slots); const b = await page.evaluate(H.bindings); const trig = await page.evaluate(H.trigger);
    const key = Object.keys(slots).find(k => slots[k].label === IGN); if (!key) throw new Error('no ' + IGN + ' slot ' + JSON.stringify(slots));
    if (!b.slots[key] || b.slots[key].ign !== IGN || !b.selected || b.selected.key !== key) throw new Error('binding ' + JSON.stringify(b));
    if (trig.value !== IGN) throw new Error('trigger ' + JSON.stringify(trig));
    return { key, level: slots[key].level, confirmText: confirmText.slice(0, 120), dropdownBefore: before.slice(0, 80) };
  });

  await scenario('D. editing the level auto-saves into the slot within 1 s (still not-uploaded before the first upload)', async () => {
    await retype('275', '276');
    const t0 = Date.now();
    await waitFor((ign) => { var m = window.__e2e.ps.getState().preset; for (var k in m) if (m[k].label === ign && m[k].data.stat.level === '276') return true; return false; }, 1000, 'slot updated <1s', IGN).catch(async (e) => { throw new Error(e.message + ' slots=' + JSON.stringify(await page.evaluate(H.slots))); });
    const ms = Date.now() - t0;
    const icon = await page.evaluate(H.icon); if (icon !== 'not-uploaded') throw new Error('icon ' + icon);
    return { savedAfterMs: ms, icon };
  });

  await scenario('E. sync icon -> "Upload to the cloud?" -> Upload -> synced; stub has the doc (GET 200, level 276)', async () => {
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload to the cloud\?/.test(d.innerText); }, 4000, 'upload prompt');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync') && document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'icon synced');
    const doc = await cloudReq('GET', '/v1/characters/' + IGN);
    if (doc.status !== 200 || !doc.json || doc.json.preset.data.stat.level !== '276') throw new Error('cloud doc ' + doc.status + ' ' + JSON.stringify(doc.json).slice(0, 120));
    const b = await page.evaluate(H.bindings); const k = b.selected && b.selected.key;
    if (!k || !b.slots[k] || !b.slots[k].cloudUpdatedAt) throw new Error('binding ' + JSON.stringify(b));
    return { cloudLevel: doc.json.preset.data.stat.level, puts: cloudRequests.filter(r => /^PUT/.test(r)).length };
  });

  await scenario('E2. an edit after the upload flips the icon to local-ahead within 1 s; icon -> "Upload changes" -> synced (cloud 277)', async () => {
    await retype('276', '277');
    const t0 = Date.now();
    await waitFor((ign) => { var m = window.__e2e.ps.getState().preset; for (var k in m) if (m[k].label === ign && m[k].data.stat.level === '277') return true; return false; }, 1000, 'slot updated <1s', IGN);
    const ms = Date.now() - t0;
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'local-ahead', 2000, 'local-ahead');
    await clickSync();
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Upload changes to the cloud\?/.test(d.innerText); }, 4000, 'upload changes dialog');
    await clickDialogButton('Upload');
    await waitFor(() => document.querySelector('.msfix-sync').getAttribute('data-msfix-sync') === 'synced', 8000, 'synced after upload');
    const doc = await cloudReq('GET', '/v1/characters/' + IGN);
    if (doc.json.preset.data.stat.level !== '277') throw new Error('cloud level ' + doc.json.preset.data.stat.level);
    return { savedAfterMs: ms, cloudLevel: doc.json.preset.data.stat.level };
  });

  await scenario('F. avatar: the dropdown row shows the stub picture, the closed trigger shows it too', async () => {
    await page.evaluate(() => localStorage.removeItem('msfix:cloud:avatars'));
    await openPicker();
    await waitFor((ign) => { var b = document.querySelector('.msfix-charpicker .msfix-dd .msfix-avatar[data-msfix-avatar="' + ign + '"]'); var i = b && b.querySelector('img'); return !!(i && b.getAttribute('data-msfix-avatar-state') === 'ok' && /\/avatar\.png/.test(i.getAttribute('src') || '')); }, 8000, 'row avatar painted', IGN).catch(async (e) => { throw new Error(e.message + ' boxes=' + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('.msfix-charpicker .msfix-dd .msfix-avatar')).map(b => b.outerHTML.slice(0, 160))))); });
    const row = await page.evaluate((ign) => { var b = document.querySelector('.msfix-charpicker .msfix-dd .msfix-avatar[data-msfix-avatar="' + ign + '"]'); var i = b.querySelector('img'); return { w: b.getBoundingClientRect().width, state: b.getAttribute('data-msfix-avatar-state'), src: i.getAttribute('src'), natural: i.naturalWidth, complete: i.complete }; }, IGN);
    await page.keyboard.press('Escape');
    await waitFor(() => { var a = document.querySelector('.msfix-charpicker .msfix-avatar-trigger'); var i = a && a.querySelector('img'); return !!(a && !a.hidden && i && /\/avatar\.png/.test(i.getAttribute('src') || '')); }, 4000, 'trigger shows the look');
    const trig = await page.evaluate(() => { var a = document.querySelector('.msfix-charpicker .msfix-avatar-trigger'); var i = document.querySelector('.msfix-charpicker input[role=combobox]'); var ar = a.getBoundingClientRect(), ir = i.getBoundingClientRect(); return { w: ar.width, left: ar.left - ir.left, hasClass: i.classList.contains('msfix-has-avatar'), ign: a.getAttribute('data-msfix-avatar') }; });
    if (Math.round(row.w) !== 28) throw new Error('row avatar box width ' + row.w);
    if (Math.round(trig.w) !== 20 || trig.left < 0 || trig.left > 20 || !trig.hasClass || trig.ign !== IGN) throw new Error('trigger avatar: ' + JSON.stringify(trig));
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('msfix:cloud:avatars') || '{}'));
    if (!cached[IGN] || !cached[IGN].image) throw new Error('cache entry: ' + JSON.stringify(cached));
    return { row, trigger: trig };
  });

  await scenario('G. row menu opens; Delete shows the four-way dialog; Cancel closes it', async () => {
    await openPicker();
    const clicked = await page.evaluate((ign) => { var r = Array.from(document.querySelectorAll('.msfix-charpicker .msfix-dd [role=option]')).find(x => (x.textContent || '').indexOf(ign) !== -1); if (!r) return 'no row'; var m = r.querySelector('[data-msfix-act=menu]'); if (!m) return 'no menu button'; m.click(); return 'ok'; }, IGN);
    if (clicked !== 'ok') throw new Error(clicked + ' :: ' + (await dropdownText()).slice(0, 160));
    await waitFor((ign) => { var d = document.querySelector('.msfix-dialog'); return d && d.innerText.indexOf(ign) !== -1 && /Delete/.test(d.innerText); }, 4000, 'row menu dialog', IGN);
    const menuButtons = await dialogButtons();
    for (const need of ['Overwrite', 'Rename', 'Download', 'History', 'Delete', 'Cancel']) if (menuButtons.indexOf(need) === -1) throw new Error('menu lacks ' + need + ': ' + JSON.stringify(menuButtons));
    await clickDialogButton('Delete');
    await waitFor(() => { var d = document.querySelector('.msfix-dialog'); return d && /Delete this character\?/.test(d.innerText); }, 4000, 'delete dialog');
    const delButtons = await dialogButtons();
    if (delButtons.join('|') !== 'Cancel|Delete local|Delete cloud|Delete both') throw new Error('delete buttons: ' + JSON.stringify(delButtons));
    await clickDialogButton('Cancel');
    await waitFor(() => !document.querySelector('.msfix-dialog'), 4000, 'dialog closed');
    const slots = await page.evaluate(H.slots); const trig = await page.evaluate(H.trigger);
    if (!Object.keys(slots).some(k => slots[k].label === IGN) || trig.value !== IGN) throw new Error('character changed after Cancel: ' + JSON.stringify({ slots, trig }));
    if ((await cloudReq('GET', '/v1/characters/' + IGN)).status !== 200) throw new Error('cloud copy gone after Cancel');
    return { menuButtons, delButtons };
  });

  await scenario('H. reload keeps the selection and the bindings', async () => {
    await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
    await waitFor(() => !!document.querySelector('.msfix-charpicker'), 30000, 'picker after reload');
    await waitFor(H.stores, 10000, 'stores');
    const trig = await page.evaluate(H.trigger); if (trig.value !== IGN) throw new Error('selection lost: ' + JSON.stringify(trig));
    await waitFor(() => ['synced', 'local-ahead', 'cloud-ahead', 'conflict'].indexOf(document.querySelector('.msfix-sync').getAttribute('data-msfix-sync')) !== -1, 8000, 'icon state after reload');
    const level = await page.evaluate(() => Array.from(document.querySelectorAll('input')).some(i => i.value === '277'));
    if (!level) throw new Error('form does not show the saved level after reload');
    const b = await page.evaluate(H.bindings);
    if (!b.selected || !b.slots[b.selected.key] || b.slots[b.selected.key].ign !== IGN) throw new Error('bindings: ' + JSON.stringify(b));
    return { trigger: trig.value, icon: await page.evaluate(H.icon) };
  });

  const ours = (s) => /msfix|__e2e|userscript|maplescouter-en-fix/i.test(s);
  const noise = (s) => /Minified React error #418|hydrat/i.test(s);
  console.log('BROWSER', version);
  const tally = (arr) => { const m = {}; arr.forEach(s => { m[s] = (m[s] || 0) + 1; }); return Object.keys(m).map(k => m[k] + 'x ' + k); };
  console.log('PAGE ERRORS (all, deduplicated):', JSON.stringify(tally(pageErrors)));
  console.log('PAGE ERRORS (ours):', JSON.stringify(pageErrors.filter(s => ours(s) && !noise(s))));
  console.log('CONSOLE ERRORS (ours):', JSON.stringify(consoleErrors.filter(s => ours(s) && !noise(s))));
  console.log('CONSOLE ERRORS (other, first 10):', JSON.stringify(consoleErrors.filter(s => !ours(s) && !noise(s)).slice(0, 10)));
  console.log('CLOUD REQUESTS:', cloudRequests.length, JSON.stringify(cloudRequests.slice(0, 40)));
  console.log('RESULTS:', JSON.stringify(results.map(r => ({ name: r.name, ok: r.ok, error: r.error }))));
  await browser.close();
  process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(async e => { console.error('FATAL', e); try { await page.screenshot({ path: path.join(OUT, 'fatal.png') }); } catch (e2) {} if (browser) await browser.close(); process.exit(2); });
