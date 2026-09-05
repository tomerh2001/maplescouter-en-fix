#!/usr/bin/env node
/* Builds the browser extensions (MV3) from the userscript source + data payload.
   Output: dist-extension/          (Chrome, unpacked) + dist/maplescouter-en-fix-extension.zip
           dist-extension-firefox/  (Firefox, unpacked) + dist/maplescouter-en-fix-firefox.zip
   The Firefox build is the Chrome build plus a browser_specific_settings.gecko block
   (add-on id, minimum Firefox version and the AMO data collection declaration). */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = __dirname;

// Firefox-only manifest additions. Chrome never sees this key.
//  - strict_min_version 140.0: "world": "MAIN" in content_scripts needs Firefox 128, and the
//    data collection consent dialog below only exists from Firefox 140 (web-ext lint warns
//    when the minimum is lower, and older Firefox would install without showing the consent).
//  - data_collection_permissions: required since 3 Nov 2025 for new add-ons on
//    addons.mozilla.org. The only data that ever leaves the browser is the stat preset the
//    user typed into the site's form plus the IGN, sent to scouter.tomerh2001.com when the
//    user clicks Upload / Add / Load, so "websiteContent" is declared as required.
const GECKO = {
  id: 'maplescouter-enhancements@tomerh2001.github.io',
  strict_min_version: '140.0',
  data_collection_permissions: {
    required: ['websiteContent']
  }
};

// 1. content script = userscript minus the ==UserScript== header block
const src = fs.readFileSync(path.join(root, 'src/maplescouter-en-fix.user.js'), 'utf8');
const body = src.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
const version = (src.match(/@version\s+([\d.]+)/) || [])[1];
if (!version) throw new Error('no @version in userscript');

const template = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));

function build(dirName, zipName, patchManifest) {
  const out = path.join(root, dirName);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

  fs.writeFileSync(path.join(out, 'maplescouter-en-fix.js'), body);

  // 2. data payload (must be built already: run node build.js first)
  fs.copyFileSync(path.join(root, 'dist/msfix-data.js'), path.join(out, 'msfix-data.js'));

  // 3. manifest with synced version (deep copy so the Chrome manifest stays untouched)
  const manifest = JSON.parse(JSON.stringify(template));
  manifest.version = version;
  if (patchManifest) patchManifest(manifest);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 4. icons
  for (const f of fs.readdirSync(path.join(root, 'extension/icons'))) {
    fs.copyFileSync(path.join(root, 'extension/icons', f), path.join(out, 'icons', f));
  }

  // 5. zip for store upload
  const zip = path.join(root, 'dist', zipName);
  fs.rmSync(zip, { force: true });
  execSync(`cd "${out}" && zip -qr "${zip}" .`);
  console.log('extension v' + version, '→ ' + dirName + '/ +', path.relative(root, zip),
    '(' + (fs.statSync(zip).size / 1024 / 1024).toFixed(2) + ' MB)');
}

// Chrome (Web Store): manifest as in extension/manifest.json, no gecko key.
build('dist-extension', 'maplescouter-en-fix-extension.zip');

// Firefox (addons.mozilla.org): same files, plus browser_specific_settings.gecko.
build('dist-extension-firefox', 'maplescouter-en-fix-firefox.zip', function (manifest) {
  manifest.browser_specific_settings = { gecko: GECKO };
});
