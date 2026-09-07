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
    toastErr: text => notices.push(text), updateIcon() {}, renderDropdown() {}, saveBindings() {},
    selectedKey: () => '1', currentDraft: () => draft, hashData: () => 'same',
  });
  vm.runInContext(section('  function setOffline(', '  function busy('), ctx);
  vm.runInContext(section('  function checkRemote(', '  function fetchDoc('), ctx);
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
