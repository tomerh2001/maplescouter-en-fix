import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { publishChrome, publishFirefox, checkVersion, compareVersions, amoJWT } from '../scripts/publish-stores.mjs';

const version = '1.7.1';
const revision = (v, state) => ({ state, distributionChannels: [{ crxVersion: v, deployPercentage: 100 }] });
const chrome = { version, publisherId: 'publisher-id', itemId: 'alopdmlliacajfcgnphmojmneanikbdg', token: 'test-token', zip: new Uint8Array([1]), sleep: async () => {}, attempts: 2 };
const firefox = { version, addonId: 'example@test', key: 'test-key', secret: 'test-secret', zip: new Uint8Array([1]), source: new Uint8Array([2]), notes: 'Fix region loading.', sleep: async () => {}, attempts: 2 };
const amoVersion = overrides => ({ id: 123, version, channel: 'listed', file: { status: 'unreviewed' }, source: 'https://addons.mozilla.org/source.zip', ...overrides });

function mock(steps) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const step = steps[calls.length];
      calls.push({ url, init });
      assert.ok(step, `Unexpected request ${url}`);
      assert.equal(init.method || 'GET', step.method || 'GET');
      assert.ok(url.endsWith(step.path), `Expected ${step.path}, got ${url}`);
      step.check?.(init);
      if (step.error) throw new Error(step.error);
      return new Response(JSON.stringify(step.body), { status: step.status || 200, headers: { 'Content-Type': 'application/json' } });
    },
    complete() { assert.equal(calls.length, steps.length); }
  };
}

test('versions are validated and compared numerically', () => {
  for (const invalid of ['', '../1.7.1', '1.7.1;echo x', 'v1.7.1', '1.7.1-beta']) assert.throws(() => checkVersion(invalid));
  assert.equal(compareVersions('1.10.0', '1.7.1'), 1);
  assert.equal(compareVersions('1.7.1', '1.7.1.0'), 0);
});
test('Mozilla tokens have short expiry and valid HMAC signatures', () => {
  const token = amoJWT('key', 'secret', 1000), [h, p, s] = token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(payload.iss, 'key'); assert.equal(payload.exp, 1060); assert.equal(payload.iat, 995);
  assert.equal(s, createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url'));
  assert.notEqual(amoJWT('key', 'secret', 1000), token);
});
test('Chrome uploads the requested version and publishes after review', async () => {
  const m = mock([
    { path: ':fetchStatus', body: { publishedItemRevisionStatus: revision('1.7.0', 'PUBLISHED') } },
    { path: ':upload', method: 'POST', body: { crxVersion: version, uploadState: 'SUCCEEDED' } },
    { path: ':publish', method: 'POST', body: { state: 'PENDING_REVIEW' }, check: init => assert.deepEqual(JSON.parse(init.body), { publishType: 'DEFAULT_PUBLISH', skipReview: false, deployInfos: [{ deployPercentage: 100 }] }) }
  ]);
  assert.equal((await publishChrome({ ...chrome, fetchImpl: m.fetchImpl })).state, 'PENDING_REVIEW'); m.complete();
});
for (const state of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) test(`Chrome waits for ${state}`, async () => {
  const m = mock([
    { path: ':fetchStatus', body: {} },
    { path: ':upload', method: 'POST', body: { uploadState: state } },
    { path: ':fetchStatus', body: { lastAsyncUploadState: 'SUCCEEDED' } },
    { path: ':publish', method: 'POST', body: { state: 'PENDING_REVIEW' } }
  ]);
  await publishChrome({ ...chrome, fetchImpl: m.fetchImpl }); m.complete();
});
for (const [field, state, v, expected] of [
  ['publishedItemRevisionStatus', 'PUBLISHED', version, 'PUBLISHED'],
  ['publishedItemRevisionStatus', 'PUBLISHED', '1.8.0', 'SUPERSEDED'],
  ['submittedItemRevisionStatus', 'PENDING_REVIEW', version, 'PENDING_REVIEW']
]) test(`Chrome retry preserves ${field} ${v}`, async () => {
  const m = mock([{ path: ':fetchStatus', body: { [field]: revision(v, state) } }]);
  assert.equal((await publishChrome({ ...chrome, fetchImpl: m.fetchImpl })).state, expected); m.complete();
});
test('Chrome does not cancel a different pending version', async () => {
  const m = mock([{ path: ':fetchStatus', body: { submittedItemRevisionStatus: revision('1.7.0', 'PENDING_REVIEW') } }]);
  await assert.rejects(publishChrome({ ...chrome, fetchImpl: m.fetchImpl }), /another version/); m.complete();
});
test('Chrome publishes an already approved staged version without another upload', async () => {
  const m = mock([
    { path: ':fetchStatus', body: { submittedItemRevisionStatus: revision(version, 'STAGED') } },
    { path: ':publish', method: 'POST', body: { state: 'PUBLISHED' } }
  ]);
  assert.equal((await publishChrome({ ...chrome, fetchImpl: m.fetchImpl })).state, 'PUBLISHED'); m.complete();
});
for (const failed of [{ crxVersion: '1.7.0', uploadState: 'SUCCEEDED' }, { uploadState: 'FAILED' }]) test(`Chrome never publishes a bad upload ${JSON.stringify(failed)}`, async () => {
  const m = mock([{ path: ':fetchStatus', body: {} }, { path: ':upload', method: 'POST', body: failed }]);
  await assert.rejects(publishChrome({ ...chrome, fetchImpl: m.fetchImpl })); m.complete();
});
test('Chrome stops on a rejected version', async () => {
  const m = mock([{ path: ':fetchStatus', body: { submittedItemRevisionStatus: revision(version, 'REJECTED') } }]);
  await assert.rejects(publishChrome({ ...chrome, fetchImpl: m.fetchImpl }), /rejected/); m.complete();
});
test('mutation timeouts are not blindly retried', async () => {
  const m = mock([{ path: ':fetchStatus', body: {} }, { path: ':upload', method: 'POST', error: 'timeout' }]);
  await assert.rejects(publishChrome({ ...chrome, fetchImpl: m.fetchImpl }), /timeout/); m.complete();
});
test('Firefox submits listed package, source, reviewer notes and release notes', async () => {
  const m = mock([
    { path: '/addons/addon/example%40test/', body: {} },
    { path: `/versions/${version}/`, status: 404, body: {} },
    { path: '/addons/upload/', method: 'POST', body: { uuid: 'upload-id', processed: false }, check: init => assert.equal(init.body.get('channel'), 'listed') },
    { path: '/addons/upload/upload-id/', body: { uuid: 'upload-id', processed: true, valid: true, version } },
    { path: '/versions/', method: 'POST', body: amoVersion(), check: init => { assert.ok(init.body.get('source') instanceof Blob); assert.match(init.body.get('approval_notes'), /generated translation data/); } },
    { path: '/versions/123/', method: 'PATCH', body: amoVersion(), check: init => { const body = JSON.parse(init.body); assert.deepEqual(body.compatibility, ['firefox']); assert.equal(body.release_notes['en-US'], firefox.notes); } },
    { path: '/versions/123/', body: amoVersion() }
  ]);
  const result = await publishFirefox({ ...firefox, fetchImpl: m.fetchImpl });
  assert.equal(result.state, 'PENDING_REVIEW'); assert.equal(result.sourceAttached, true); m.complete();
});
test('Firefox retries repair missing source without creating another version', async () => {
  const m = mock([
    { path: '/addons/addon/example%40test/', body: {} },
    { path: `/versions/${version}/`, body: amoVersion({ source: null }) },
    { path: '/versions/123/', method: 'PATCH', body: amoVersion(), check: init => assert.ok(init.body.get('source') instanceof Blob) },
    { path: '/versions/123/', method: 'PATCH', body: amoVersion() },
    { path: '/versions/123/', body: amoVersion() }
  ]);
  await publishFirefox({ ...firefox, fetchImpl: m.fetchImpl }); m.complete();
});
test('Firefox leaves an approved version untouched', async () => {
  const m = mock([{ path: '/addons/addon/example%40test/', body: {} }, { path: `/versions/${version}/`, body: amoVersion({ file: { status: 'public' } }) }]);
  assert.equal((await publishFirefox({ ...firefox, fetchImpl: m.fetchImpl })).state, 'PUBLISHED'); m.complete();
});
for (const data of [{ channel: 'unlisted' }, { file: { status: 'disabled' } }, { is_disabled: true }]) test(`Firefox refuses incompatible existing state ${JSON.stringify(data)}`, async () => {
  const m = mock([{ path: '/addons/addon/example%40test/', body: {} }, { path: `/versions/${version}/`, body: amoVersion(data) }]);
  await assert.rejects(publishFirefox({ ...firefox, fetchImpl: m.fetchImpl })); m.complete();
});
test('Firefox validation errors never become a submitted version', async () => {
  const m = mock([
    { path: '/addons/addon/example%40test/', body: {} },
    { path: `/versions/${version}/`, status: 404, body: {} },
    { path: '/addons/upload/', method: 'POST', body: { uuid: 'id', processed: true, valid: false, version } }
  ]);
  await assert.rejects(publishFirefox({ ...firefox, fetchImpl: m.fetchImpl }), /validation/); m.complete();
});
test('store errors do not print response bodies containing credentials', async () => {
  const m = mock([{ path: ':fetchStatus', status: 403, body: { secret: 'do-not-log-me' } }]);
  await assert.rejects(publishChrome({ ...chrome, fetchImpl: m.fetchImpl }), error => !error.message.includes('do-not-log-me') && error.message.includes('HTTP 403')); m.complete();
});

test('explicit replacement cancels only the older Chrome review before uploading', async () => {
  const m = mock([
    { path: ':fetchStatus', body: { submittedItemRevisionStatus: revision('1.7.0', 'PENDING_REVIEW') } },
    { path: ':cancelSubmission', method: 'POST', body: {} },
    { path: ':fetchStatus', body: {} },
    { path: ':upload', method: 'POST', body: { crxVersion: version, uploadState: 'SUCCEEDED' } },
    { path: ':publish', method: 'POST', body: { state: 'PENDING_REVIEW' } },
  ]);
  await publishChrome({ ...chrome, replacePending: true, fetchImpl: m.fetchImpl }); m.complete();
});
test('replacement never cancels a newer pending Chrome version', async () => {
  const m = mock([{ path: ':fetchStatus', body: { submittedItemRevisionStatus: revision('1.8.0', 'PENDING_REVIEW') } }]);
  await assert.rejects(publishChrome({ ...chrome, replacePending: true, fetchImpl: m.fetchImpl }), /another version/); m.complete();
});
test('upload waits for confirmed cancellation', async () => {
  const m = mock([
    { path: ':fetchStatus', body: { submittedItemRevisionStatus: revision('1.7.0', 'PENDING_REVIEW') } },
    { path: ':cancelSubmission', method: 'POST', body: {} },
    { path: ':fetchStatus', body: { submittedItemRevisionStatus: revision('1.7.0', 'PENDING_REVIEW') } },
  ]);
  await assert.rejects(publishChrome({ ...chrome, replacePending: true, fetchImpl: m.fetchImpl }), /not confirmed/); m.complete();
});
