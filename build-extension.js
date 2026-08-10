#!/usr/bin/env node
/* Builds the Chrome extension (MV3) from the userscript source + data payload.
   Output: dist-extension/ (unpacked) + dist/maplescouter-en-fix-extension.zip */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = __dirname;
const out = path.join(root, 'dist-extension');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

// 1. content script = userscript minus the ==UserScript== header block
const src = fs.readFileSync(path.join(root, 'src/maplescouter-en-fix.user.js'), 'utf8');
const body = src.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
const version = (src.match(/@version\s+([\d.]+)/) || [])[1];
if (!version) throw new Error('no @version in userscript');
fs.writeFileSync(path.join(out, 'maplescouter-en-fix.js'), body);

// 2. data payload (must be built already — run node build.js first)
fs.copyFileSync(path.join(root, 'dist/msfix-data.js'), path.join(out, 'msfix-data.js'));

// 3. manifest with synced version
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
manifest.version = version;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4. icons
for (const f of fs.readdirSync(path.join(root, 'extension/icons'))) {
  fs.copyFileSync(path.join(root, 'extension/icons', f), path.join(out, 'icons', f));
}

// 5. zip for Web Store upload
const zip = path.join(root, 'dist', 'maplescouter-en-fix-extension.zip');
fs.rmSync(zip, { force: true });
execSync(`cd "${out}" && zip -qr "${zip}" .`);
console.log('extension v' + version, '→ dist-extension/ +', path.relative(root, zip),
  '(' + (fs.statSync(zip).size / 1024 / 1024).toFixed(2) + ' MB)');
