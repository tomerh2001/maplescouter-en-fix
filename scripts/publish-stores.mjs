import { createHmac, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CHROME_API = 'https://chromewebstore.googleapis.com';
const AMO_API = 'https://addons.mozilla.org/api/v5';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export const APPROVAL_NOTES = 'msfix-data.js is generated translation data, not minified or obfuscated code. The attached source includes data/, src/, build.js, build-extension.js, and BUILD.md. Run node build.js && node build-extension.js with Node.js 20 or newer and zip installed to reproduce both packages. This update preserves the preset region on load and fixes cloud error handling. Cloud uploads remain explicit.';

export function checkVersion(version) {
  if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error('Expected a numeric extension version, such as 1.7.1');
  return version;
}
export function compareVersions(a, b) {
  checkVersion(a); checkVersion(b);
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0) ? 1 : -1;
  return 0;
}
export function amoJWT(key, secret, now = Math.floor(Date.now() / 1000)) {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, jti: randomUUID(), iat: now - 5, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

// Deliberately no automatic retries of mutations: a timeout can mean the store accepted them.
// Re-running the workflow checks the store first and resumes an existing version.
export async function request(url, init = {}, fetchImpl = fetch, allowed = []) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(120000), redirect: 'error' });
  let body;
  try { body = await response.json(); } catch { throw new Error(`Invalid JSON from ${new URL(url).hostname} (HTTP ${response.status})`); }
  if (!response.ok && !allowed.includes(response.status)) {
    // Never include credentials, request headers, or response bodies in CI logs.
    throw new Error(`${init.method || 'GET'} ${new URL(url).pathname}: HTTP ${response.status}; check the store dashboard for details`);
  }
  return { status: response.status, body };
}

export async function chromeToken(credentials, fetchImpl = fetch) {
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) throw new Error('Invalid Chrome service-account credentials');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: 'https://oauth2.googleapis.com/token', iat: now - 5, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url')}`;
  const { body } = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) }, fetchImpl);
  if (!body.access_token) throw new Error('Google did not return an access token');
  return body.access_token;
}

const versionsOf = revision => (revision?.distributionChannels || []).map(channel => channel.crxVersion).filter(Boolean);
export async function publishChrome({ version, publisherId, itemId, token, zip, fetchImpl = fetch, sleep = delay, attempts = 36 }) {
  checkVersion(version);
  if (!/^[a-z]{32}$/.test(itemId) || !/^[a-zA-Z0-9-]+$/.test(publisherId)) throw new Error('Invalid Chrome publisher or item ID');
  const name = `publishers/${publisherId}/items/${itemId}`;
  const headers = { Authorization: `Bearer ${token}` };
  const call = async (suffix, init = {}) => (await request(`${CHROME_API}/v2/${name}:${suffix}`, { ...init, headers: { ...headers, ...init.headers } }, fetchImpl)).body;
  const state = await call('fetchStatus');
  if (state.takenDown) throw new Error('Chrome listing is taken down; resolve it in the dashboard');
  const published = versionsOf(state.publishedItemRevisionStatus);
  if (published.some(v => compareVersions(v, version) >= 0)) return { store: 'chrome', version, state: published.includes(version) ? 'PUBLISHED' : 'SUPERSEDED' };
  const submitted = state.submittedItemRevisionStatus;
  const submittedVersions = versionsOf(submitted);
  if (submitted?.state === 'PENDING_REVIEW') {
    if (submittedVersions.includes(version)) return { store: 'chrome', version, state: 'PENDING_REVIEW', existing: true };
    throw new Error('Chrome has another version awaiting review; it was left untouched');
  }
  if (submittedVersions.some(v => compareVersions(v, version) > 0)) throw new Error('Chrome already has a newer submission');
  if (submittedVersions.includes(version) && submitted?.state === 'REJECTED') throw new Error('Chrome rejected this version; address the review before resubmitting');
  if (!(submitted?.state === 'STAGED' && submittedVersions.includes(version))) {
    const uploaded = (await request(`${CHROME_API}/upload/v2/${name}:upload`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: zip }, fetchImpl)).body;
    if (uploaded.crxVersion && uploaded.crxVersion !== version) throw new Error('Chrome received a different version than requested');
    let uploadState = uploaded.uploadState;
    for (let i = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState) && i < attempts; i++) {
      await sleep(5000);
      uploadState = (await call('fetchStatus')).lastAsyncUploadState;
    }
    if (uploadState !== 'SUCCEEDED') throw new Error(`Chrome upload did not finish successfully: ${uploadState}`);
  }
  const result = await call('publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, deployInfos: [{ deployPercentage: 100 }] }) });
  if (!['PENDING_REVIEW', 'PUBLISHED'].includes(result.state)) throw new Error(`Chrome did not accept automatic publication: ${result.state}`);
  return { store: 'chrome', version, state: result.state, publishType: 'DEFAULT_PUBLISH' };
}

export async function publishFirefox({ version, addonId, key, secret, zip, source, notes, fetchImpl = fetch, sleep = delay, attempts = 60 }) {
  checkVersion(version);
  const addon = `${AMO_API}/addons/addon/${encodeURIComponent(addonId)}`;
  const call = async (url, init = {}, allowed = []) => request(url, { ...init, headers: { Authorization: `JWT ${amoJWT(key, secret)}`, ...init.headers } }, fetchImpl, allowed);
  const detail = (await call(`${addon}/`)).body;
  if (detail.is_disabled) throw new Error('Firefox listing is disabled; resolve it in the dashboard');
  if (detail.current_version && compareVersions(detail.current_version.version, version) > 0) return { store: 'firefox', version, state: 'SUPERSEDED' };
  const existing = await call(`${addon}/versions/${version}/`, {}, [404]);
  let result;
  if (existing.status !== 404) {
    result = existing.body;
    if (result.channel !== 'listed' || result.is_disabled || result.file?.status === 'disabled') throw new Error('This Firefox version is disabled or not listed; it was left untouched');
    if (result.file?.status === 'public') return { store: 'firefox', version, state: 'PUBLISHED', versionId: result.id };
    if (result.file?.status !== 'unreviewed') throw new Error('Unrecognized Firefox version status');
  } else {
    const upload = new FormData();
    upload.set('upload', new Blob([zip], { type: 'application/zip' }), 'maplescouter-en-fix-firefox.zip');
    upload.set('channel', 'listed');
    let uploaded = (await call(`${AMO_API}/addons/upload/`, { method: 'POST', body: upload })).body;
    if (!uploaded.uuid) throw new Error('Mozilla did not return an upload ID');
    const uuid = uploaded.uuid;
    for (let i = 0; !uploaded.processed && i < attempts; i++) {
      await sleep(5000);
      uploaded = (await call(`${AMO_API}/addons/upload/${encodeURIComponent(uuid)}/`)).body;
    }
    if (!uploaded.processed || !uploaded.valid) throw new Error('Firefox validation failed or timed out; check the Developer Hub');
    if (uploaded.version !== version) throw new Error('Mozilla received a different version than requested');
    const form = new FormData();
    form.set('upload', uuid);
    form.set('source', new Blob([source], { type: 'application/zip' }), 'maplescouter-en-fix-source.zip');
    form.set('license', 'MIT');
    form.set('approval_notes', APPROVAL_NOTES);
    result = (await call(`${addon}/versions/`, { method: 'POST', body: form })).body;
  }
  if (result.version !== version || !result.id) throw new Error('Mozilla created an unexpected version');
  // Resume a partial submission without re-uploading the extension or dropping its review queue.
  if (!result.source) {
    const form = new FormData();
    form.set('source', new Blob([source], { type: 'application/zip' }), 'maplescouter-en-fix-source.zip');
    await call(`${addon}/versions/${result.id}/`, { method: 'PATCH', body: form });
  }
  await call(`${addon}/versions/${result.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_notes: APPROVAL_NOTES, compatibility: ['firefox'], release_notes: { 'en-US': notes } }) });
  const verified = (await call(`${addon}/versions/${result.id}/`)).body;
  if (verified.version !== version || verified.channel !== 'listed' || !verified.source || !['public', 'unreviewed'].includes(verified.file?.status)) throw new Error('Firefox submission could not be verified with its source archive');
  return { store: 'firefox', version, state: verified.file.status === 'public' ? 'PUBLISHED' : 'PENDING_REVIEW', versionId: verified.id, channel: 'listed', sourceAttached: true };
}

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
async function main() {
  const store = process.argv[2], version = checkVersion(required('RELEASE_VERSION'));
  const dir = process.env.RELEASE_DIR || 'store-release';
  let result;
  if (store === 'chrome') {
    const credentials = JSON.parse(required('CWS_SERVICE_ACCOUNT_JSON'));
    result = await publishChrome({ version, publisherId: required('CWS_PUBLISHER_ID'), itemId: required('CWS_EXTENSION_ID'), token: await chromeToken(credentials), zip: await readFile(`${dir}/maplescouter-en-fix-extension.zip`) });
  } else if (store === 'firefox') {
    result = await publishFirefox({ version, addonId: required('AMO_ADDON_ID'), key: required('AMO_JWT_ISSUER'), secret: required('AMO_JWT_SECRET'), zip: await readFile(`${dir}/maplescouter-en-fix-firefox.zip`), source: await readFile(`${dir}/maplescouter-en-fix-source.zip`), notes: await readFile(`${dir}/release-notes.txt`, 'utf8') });
  } else throw new Error('Choose chrome or firefox');
  await mkdir('store-results', { recursive: true });
  await writeFile(`store-results/${store}.json`, JSON.stringify(result, null, 2));
  console.log(`${store} ${version}: ${result.state}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${store}: ${version}\n\nStatus: **${result.state}**. Accepted submissions use automatic publication after store approval.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
