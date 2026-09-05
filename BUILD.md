# Building MapleScouter Enhancements from source

These steps reproduce the exact packages that are published (Chrome Web Store zip, Firefox zip, Tampermonkey userscript).

## Requirements
- Node.js 20 (any 20.x; no npm packages are needed for the build, only Node built-ins)
- The `zip` command line tool (preinstalled on macOS and most Linux distributions)
- macOS or Linux shell

## Steps
```bash
node build.js            # bundles data/*.json into dist/msfix-data.js and stamps the userscript header into dist/maplescouter-en-fix.user.js
node build-extension.js  # writes dist-extension/ (Chrome) and dist-extension-firefox/ (Firefox) and zips both into dist/
```

Outputs:
- `dist/maplescouter-en-fix-extension.zip` (Chrome)
- `dist/maplescouter-en-fix-firefox.zip` (Firefox; same files plus the `browser_specific_settings.gecko` block that `build-extension.js` adds to the manifest)
- `dist/maplescouter-en-fix.user.js` and `dist/msfix-data.js` (Tampermonkey)

## What is generated
- `msfix-data.js` is `window.__MSFIX_DATA__ = {...}`: the JSON translation tables from `data/` (i18n patch, dictionary, regex rules, CSS fixes) assigned to one global. It is data, not transpiled or minified code.
- `maplescouter-en-fix.js` inside the extension is `src/maplescouter-en-fix.user.js` with the `==UserScript==` header removed. Nothing else is transformed.
- `manifest.json` is `extension/manifest.json` with the version copied from the userscript `@version`, plus the gecko block for the Firefox build.
