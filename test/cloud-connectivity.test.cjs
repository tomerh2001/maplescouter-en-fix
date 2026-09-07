const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped functions without loading React or making requests to real characters.
const source = fs.readFileSync(path.join(__dirname, '../src/maplescouter-en-fix.user.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return source.slice(a, b);
}
function harness(response) {
  const notices = [];
  const draft = { value: 'unchanged' };
  const binding = { ign: 'TestCharacter', cloudUpdatedAt: 'old', remoteUpdatedAt: 'old', syncedHash: 'same' };
  const ctx = vm.createContext({
    cloud: { offline: false, bindings: { '1': binding } },
    fetch: async () => { if (response instanceof Error) throw response; return response; },
    AbortController, setTimeout, clearTimeout, FETCH_TIMEOUT_MS: 100,
    cloudEnabled: () => true, cloudUrl: () => 'https://example.invalid',
    cloudPath: ign => '/v1/characters/' + encodeURIComponent(ign),
    toastErr: text => notices.push(text), updateIcon() {}, renderDropdown() {}, refreshPickerRows() {}, saveBindings() {},
    selectedKey: () => '1', currentDraft: () => draft, hashData: () => 'same',
  });
  vm.runInContext(section('  function setOffline(', '  function busy('), ctx);
  vm.runInContext(section('  // Freshness belongs', '  function fetchDoc('), ctx);
  vm.runInContext(section('  function syncInfo(', '  var ICON_STATES'), ctx);
  return { ctx, binding, draft, notices };
}
function reply(status, body = '{}', etag = 'new') {
  return { status, ok: status >= 200 && status < 300,
    headers: new Headers(etag ? { ETag: `"${etag}"` } : {}), text: async () => body };
}

for (const status of [401, 403, 500, 502, 503, 504, 522]) {
  test(`HTTP ${status} cannot turn a saved character into a successful sync check`, async () => {
    const { ctx, binding, draft } = harness(reply(status, '<html>Blocked</html>'));
    await assert.rejects(ctx.cloudFetch('HEAD', '/v1/characters/TestCharacter'), e => e.offline && e.status === status);
    assert.equal(ctx.syncInfo().state, 'offline');
    assert.equal(binding.remoteUpdatedAt, 'old');
    assert.deepEqual(draft, { value: 'unchanged' });
  });
}

test('CORS rejection keeps local data and sets the offline state', async () => {
  const { ctx, notices } = harness(new TypeError('Failed to fetch'));
  await assert.rejects(ctx.cloudFetch('HEAD', '/v1/characters/TestCharacter'));
  assert.equal(ctx.syncInfo().state, 'offline');
  assert.match(notices[0], /local saves still work/);
});

test('a blocked first upload shows offline instead of suggesting it is ready to upload', async () => {
  const { ctx, binding } = harness(reply(403));
  binding.cloudUpdatedAt = null;
  binding.remoteUpdatedAt = null;
  await assert.rejects(ctx.cloudFetch('HEAD', '/v1/characters/TestCharacter'));
  assert.equal(ctx.syncInfo().state, 'offline');
  assert.equal(ctx.cloud.offlineReason, 'blocked');
});

for (const response of [reply(403), reply(502), new TypeError('CORS blocked avatar')]) {
  test(`avatar ${response.status || 'network'} failure does not change character connection status`, async () => {
    const { ctx, notices } = harness(response);
    const result = await ctx.cloudFetch('GET', '/v1/avatar/TestCharacter', { soft: true });
    assert.equal(result.ok, false);
    assert.equal(ctx.cloud.offline, false);
    assert.equal(notices.length, 0);
  });
}

test('a cached avatar success cannot clear a blocked character connection', async () => {
  const { ctx } = harness(reply(200, '{"image":"https://example.invalid/avatar.png"}'));
  ctx.cloud.offline = true;
  ctx.cloud.offlineReason = 'blocked';
  await ctx.cloudFetch('GET', '/v1/avatar/TestCharacter', { soft: true });
  assert.equal(ctx.cloud.offline, true);
});

test('a valid character HEAD response recovers and records the new cloud date', async () => {
  const { ctx, binding } = harness(reply(200, '', 'updated'));
  ctx.cloud.offline = true;
  await new Promise(resolve => ctx.checkRemote('1', resolve));
  assert.equal(ctx.cloud.offline, false);
  assert.equal(binding.remoteUpdatedAt, 'updated');
  assert.equal(ctx.syncInfo().state, 'cloud-ahead');
});

test('a real 404 clears the deleted cloud copy', async () => {
  const { ctx, binding } = harness(reply(404, '', null));
  await new Promise(resolve => ctx.checkRemote('1', resolve));
  assert.equal(binding.remoteUpdatedAt, null);
  assert.equal(binding.cloudUpdatedAt, null);
  assert.equal(ctx.syncInfo().state, 'not-uploaded');
});

for (const [method, response] of [
  ['GET', reply(200, '<html>Challenge</html>')],
  ['HEAD', reply(200, '', null)],
  ['GET', { ...reply(200), text: async () => { throw new Error('connection lost'); } }],
]) {
  test(`${method} cannot treat an invalid or interrupted response as recovered`, async () => {
    const { ctx } = harness(response);
    await assert.rejects(ctx.cloudFetch(method, '/v1/characters/TestCharacter'));
    assert.equal(ctx.cloud.offline, true);
  });
}

test('rate limit status and Retry-After remain available to the caller', async () => {
  const response = reply(429, '{"error":"rate_limited"}', null);
  response.headers.set('Retry-After', '60');
  const { ctx } = harness(response);
  const result = await ctx.cloudFetch('GET', '/v1/characters/TestCharacter');
  assert.equal(result.status, 429);
  assert.equal(result.retryAfter, 60);
});

function regionHarness(region = 'kms') {
  const events = [];
  const data = { isGMS: true, isTMS: false, isJMS: false, isMSEA: false, stat: { level: '292' } };
  const state = { region, setRegion(value) { events.push(`region:${value}`); this.region = value; } };
  let loaded;
  const ctx = vm.createContext({
    cloud: {}, siteRefs: { regionStore: { getState: () => state } },
    cloudStores: () => ({ ms: { getState: () => ({ loadDraft: d => { loaded = d; events.push(`load:${state.region}`); } }) } }),
    presetMap: () => ({ '1': { data } }), clone: value => JSON.parse(JSON.stringify(value)),
    backupRegion: () => events.push('backup'), readSiteRegion: () => ({ region: state.region }),
    toastErr: text => events.push(text),
  });
  vm.runInContext(section('  function regionForPreset(', '  function setSelected('), ctx);
  return { ctx, data, events, state, loaded: () => loaded };
}

for (const [region, flag] of [['gms', 'isGMS'], ['tms', 'isTMS'], ['jms', 'isJMS'], ['msea', 'isMSEA'], ['kms', null]]) {
  test(`loading ${region} selects its region before the form can rewrite the preset`, () => {
    const { ctx, data, events, loaded } = regionHarness(region === 'kms' ? 'gms' : 'kms');
    for (const key of ['isGMS', 'isTMS', 'isJMS', 'isMSEA']) data[key] = key === flag;
    const before = JSON.stringify(data);
    assert.equal(ctx.loadIntoForm('1'), true);
    assert.deepEqual(events, [`region:${region}`, 'backup', `load:${region}`]);
    assert.equal(JSON.stringify(data), before);
    assert.equal(JSON.stringify(loaded()), before);
  });
}

test('loading a matching region leaves the header alone', () => {
  const { ctx, events } = regionHarness('gms');
  assert.equal(ctx.loadIntoForm('1'), true);
  assert.deepEqual(events, ['load:gms']);
});

test('missing or contradictory flags do not guess a region', () => {
  const { ctx, data } = regionHarness();
  assert.equal(ctx.regionForPreset({ isGMS: true }), null);
  assert.equal(ctx.regionForPreset({ ...data, isJMS: true }), null);
});

test('missing region store stops an unsafe cross-region load', () => {
  const { ctx, events, loaded } = regionHarness();
  ctx.siteRefs.regionStore = null;
  assert.equal(ctx.loadIntoForm('1'), false);
  assert.equal(loaded(), undefined);
  assert.match(events[0], /Choose GMS/);
});

function refreshHarness() {
  const h = harness(reply(200, '', 'old'));
  const requests = [];
  let clock = Date.parse('2026-09-07T12:00:00Z'), paints = 0;
  class Clock extends Date { static now() { return clock; } }
  Object.assign(h.ctx, {
    Date: Clock, FOCUS_CHECK_GAP_MS: 60000,
    cloudFetch: (method, url) => new Promise(resolve => requests.push({ method, url, resolve })),
    refreshPickerRows: () => { paints++; },
    picker: { open: true, items: [{ type: 'local', key: '1' }] },
    document: { hidden: false }, isInputRoute: () => true,
  });
  return { ...h, requests, advance: ms => { clock += ms; }, paints: () => paints };
}
const head = (etag = 'old') => ({ ok: true, status: 200, etag });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a reloaded green baseline stays checking until the current cloud version arrives', async () => {
  const h = refreshHarness();
  assert.equal(h.ctx.syncInfo().state, 'checking');
  h.ctx.checkRemote('1');
  assert.equal(h.ctx.syncInfo().state, 'checking');
  h.requests[0].resolve(head('updated-on-other-PC'));
  await settle();
  assert.equal(h.ctx.syncInfo().state, 'cloud-ahead');
  assert.equal(h.binding.remoteUpdatedAt, 'updated-on-other-PC');
  assert.equal(h.binding.cloudUpdatedAt, 'old');
  assert.ok(h.paints() >= 2, 'dropdown repaints when the response arrives');
  assert.deepEqual(h.draft, { value: 'unchanged' });
});

test('matching cloud data turns green only after a successful check', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1'); h.requests[0].resolve(head()); await settle();
  assert.equal(h.ctx.syncInfo().state, 'synced');
});

test('mount, focus and dropdown checks share in-flight work and a one-minute cooldown', async () => {
  const h = refreshHarness(); let callbacks = 0;
  for (let i = 0; i < 3; i++) h.ctx.checkRemote('1', () => { callbacks++; }, 60000);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(head()); await settle();
  assert.equal(callbacks, 3);
  h.ctx.checkRemote('1', null, 60000);
  h.advance(59999); h.ctx.checkRemote('1', null, 60000);
  assert.equal(h.requests.length, 1);
  h.advance(1); h.ctx.checkRemote('1', null, 60000);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(head()); await settle();
});

test('an explicit retry skips the passive cooldown', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1'); h.requests[0].resolve(null); await settle();
  h.ctx.checkRemote('1', null, 60000); assert.equal(h.requests.length, 1);
  h.ctx.checkRemote('1'); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(head()); await settle();
  assert.equal(h.ctx.syncInfo().state, 'synced');
});

test('a rate-limited check stays unavailable and respects Retry-After', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1'); h.requests[0].resolve({ status: 429, ok: false, retryAfter: 180 }); await settle();
  assert.equal(h.ctx.syncInfo().state, 'offline');
  h.advance(61000); h.ctx.checkRemote('1', null, 60000); assert.equal(h.requests.length, 1);
  h.advance(120000); h.ctx.checkRemote('1', null, 60000); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(head()); await settle();
});

test('an old 404 cannot undo a successful upload while HEAD was in flight', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1');
  h.binding.cloudUpdatedAt = h.binding.remoteUpdatedAt = 'uploaded';
  h.ctx.noteRemote(h.binding, head('uploaded'));
  h.requests[0].resolve({ status: 404, ok: false }); await settle();
  assert.equal(h.binding.remoteUpdatedAt, 'uploaded');
  assert.equal(h.ctx.syncInfo().state, 'synced');
});

test('slot renumbering during a check does not update the wrong character', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1');
  h.ctx.cloud.bindings['2'] = h.binding;
  h.ctx.cloud.bindings['1'] = { ign: 'SomeoneElse', cloudUpdatedAt: 'untouched' };
  h.requests[0].resolve(head('updated')); await settle();
  assert.equal(h.ctx.cloud.bindings['2'].remoteUpdatedAt, 'updated');
  assert.equal(h.ctx.cloud.bindings['1'].cloudUpdatedAt, 'untouched');
});

test('opening the dropdown checks unselected characters with bounded concurrency', async () => {
  const h = refreshHarness();
  h.ctx.cloud.bindings['2'] = { ...h.binding, ign: 'OtherCharacter' };
  h.ctx.cloud.bindings['3'] = { ...h.binding, ign: 'ThirdCharacter' };
  h.ctx.picker.items.push({ type: 'local', key: '2' }, { type: 'local', key: '3' });
  h.ctx.refreshPickerCloud();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(head('updated')); h.requests[1].resolve(head());
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(head()); await settle();
  h.ctx.refreshPickerCloud(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.requests.length, 3, 'opening again does not repeat fresh checks');
});

test('hidden tabs and a closed picker make no dropdown requests', () => {
  const h = refreshHarness();
  h.ctx.document.hidden = true; h.ctx.refreshPickerCloud();
  h.ctx.document.hidden = false; h.ctx.picker.open = false; h.ctx.refreshPickerCloud();
  assert.equal(h.requests.length, 0);
});

function timeHarness() {
  const h = refreshHarness();
  vm.runInContext(section('  function relTime(', '  function slotName('), h.ctx);
  vm.runInContext(section('  function saveTimes(', '  function renderDropdown('), h.ctx);
  h.ctx.refreshPickerRows = () => {};
  return h;
}
const timeCases = [
  [0, 'just now'], [1, '1 second ago'], [59, '59 seconds ago'],
  [60, '1 minute ago'], [3599, '59 minutes ago'], [3600, '1 hour ago'],
  [86399, '23 hours ago'], [86400, '1 day ago'], [180000, '2 days ago'],
  [2592000, '1 month ago'], [5184000, '2 months ago'],
  [31536000, '1 year ago'], [63072000, '2 years ago'],
];
for (const [seconds, label] of timeCases) {
  test(`relative time formats ${seconds} seconds as ${label}`, () => {
    const h = timeHarness();
    assert.equal(h.ctx.relTime(new Date(h.ctx.Date.now() - seconds * 1000).toISOString()), label);
  });
}

test('future, invalid and missing dates never display negative or NaN ages', () => {
  const h = timeHarness();
  assert.equal(h.ctx.relTime(new Date(h.ctx.Date.now() + 60000).toISOString()), 'just now');
  assert.equal(h.ctx.relTime('invalid'), '');
  assert.equal(h.ctx.relTime(null), 'never');
});

test('local and cloud timestamps use identical wording and refresh without changing data', async () => {
  const h = timeHarness();
  const savedAt = new Date(h.ctx.Date.now() - 60000).toISOString();
  const remoteAt = new Date(h.ctx.Date.now() - 180000000).toISOString();
  h.binding.cloudUpdatedAt = remoteAt;
  h.ctx.checkRemote('1');
  assert.equal(h.ctx.saveTimes({ savedAt }, h.binding), 'Local: 1 minute ago, Cloud: checking...');
  h.requests[0].resolve(head(remoteAt)); await settle();
  assert.equal(h.ctx.saveTimes({ savedAt }, h.binding), 'Local: 1 minute ago, Cloud: 2 days ago');
  h.advance(60000);
  assert.equal(h.ctx.saveTimes({ savedAt }, h.binding), 'Local: 2 minutes ago, Cloud: 2 days ago');
  assert.equal(h.requests.length, 1, 'time labels do not need network requests');
});

test('first mount checks immediately and later form remounts reuse the polling schedule', () => {
  const h = refreshHarness(); let checks = 0, schedules = 0;
  const header = { contains: () => false, appendChild() {} };
  Object.assign(h.ctx, {
    applyRouteGate() {}, nativePresetRow: () => ({ parentElement: header }),
    ensureSubscriptions: () => true, reconcileBindings() {}, renderTrigger() {}, renderDropdown() {},
    pollTick: () => { checks++; }, startPolling: () => { schedules++; },
    unmountPicker() {},
  });
  h.ctx.picker.el = {}; h.ctx.picker.open = false;
  vm.runInContext(section('  function ensureCharPicker(', '  function schedulePickerMount('), h.ctx);
  h.ctx.ensureCharPicker(); h.ctx.ensureCharPicker();
  assert.equal(checks, 1); assert.equal(schedules, 1);
  h.ctx.isInputRoute = () => false; h.ctx.ensureCharPicker();
  h.ctx.isInputRoute = () => true; h.ctx.ensureCharPicker();
  assert.equal(checks, 2, 'returning to Character checks again without a click');
});

test('storage reloads preserve this tabs completed check only when cloud stamps still match', async () => {
  const h = refreshHarness();
  h.ctx.checkRemote('1'); h.requests[0].resolve(head()); await settle();
  let stored = JSON.parse(JSON.stringify(h.ctx.cloud.bindings));
  Object.assign(h.ctx, { LS_CLOUD_SLOTS: 'slots', LS_CLOUD_SELECTED: 'selected', lsJson: key => key === 'slots' ? stored : null, eqi: (a,b) => a?.toLowerCase() === b?.toLowerCase() });
  vm.runInContext(section('  function loadBindings(', '  function saveBindings('), h.ctx);
  h.ctx.loadBindings(); assert.equal(h.ctx.syncInfo().state, 'synced');
  stored = JSON.parse(JSON.stringify(stored)); stored['1'].remoteUpdatedAt = 'updated';
  h.ctx.loadBindings(); assert.equal(h.ctx.syncInfo().state, 'checking');
  assert.equal(h.requests.length, 1, 'storage notifications do not cause cross-tab request loops');
});
