# Weekly MapleScouter maintenance

The weekly Codex task runs on Thursday at 10:00 Asia/Jerusalem. Its scope includes site changes, translations, layout, compatibility, tests, GitHub releases, and submissions to both existing marketplace listings. Store approval remains Google's and Mozilla's decision. Both submissions request publication as soon as review allows it.

Repository: `tomerh2001/maplescouter-en-fix`.
Local checkout: `/Users/tomerh2001/Desktop/Projects/maplescouter-en-fix`.

## Audit

1. Inspect the working tree and fetch the latest main branch. Preserve unrelated work. Use a separate checkout if it would otherwise be overwritten.
2. Install the audit-only parser with `npm ci --prefix scripts/audit --ignore-scripts`.
3. Run `node work/refresh-chunks.js`, then `node work/audit-live.js --details`. Review `work/live-index.json` and `work/audit-live.json`. A failed fetch or parse is an incomplete audit, not a clean bill of health.
4. Compare the current routes and chunk hashes with `docs/audits/live-baseline.json`. The scan covers the chunks referenced by public pages and the live locale tables. Lazy/API responses and signed-in states also need targeted browser checks. The `new` flag is only a hint from the local cache, not a reason to ignore other missing strings.
5. Read changed UI code for intent. Keep GMS skill, equipment, stat, flame and Legion names consistent. Check Nexon's current documentation where names or mechanics are uncertain. For KMS-only content, document provisional terminology. Never change game calculations to fill missing results.
6. Add reviewed translations to `data/overrides/YYYY-MM-DD.json`. These override the old dictionary at build time and during a full merge. Preserve interpolation tokens and all numeric values. Do not translate IGNs, URLs, diagnostic logs, or literal submission tags. `docs/audits/retained-korean.json` explains known exceptions; do not use it to conceal untranslated UI.
7. Test in the supported browser against the current live site and an isolated local proxy. For a separate test origin, use `PORT=8793 MSFIX_AUDIT_CACHE=1 node test/proxy.js`. The cache serves the current audit's immutable chunks; API calls still reach the live calculator. Never overwrite real characters for testing. Use existing local fixtures or a stub backend for cloud writes.
8. Use `/en/__test/tooltip` on the local proxy to check menu closure, tooltip retention while hovered, pointer-leave dismissal and Escape. Keep the pointer on that tab during the hover check. Then check desktop and phone layouts, navigation and language switching, region retention, Character picker, import/download, local autosave, sync status, Result and Detailed Information, HEXA, equipment tooltips, and the newly changed routes. Check failures without the extension before assigning their cause. Record anything blocked by login, upstream failures, or unavailable browsers.

## Validate and release

- Run `node --test test/*.test.*`, `node --check src/maplescouter-en-fix.user.js`, and `git diff --check`.
- Bump the userscript version only if a user-facing change is needed. Run `node build.js` and `node build-extension.js`. Both generated manifests must have that version.
- Run Firefox validation with `npx web-ext lint --source-dir dist-extension-firefox --self-hosted=false`. Fix new errors; review and record warnings.
- If a build gains a dependency, include it in the Mozilla source archive in `scripts/prepare-store-release.py`. The source ZIP must reproduce both marketplace packages without private files.
- Write the dated audit report, update README details if needed, and save the reviewed live hashes/routes in `docs/audits/live-baseline.json`. Preserve previous dated reports.
- Commit only this task's changes and push main. The Release workflow builds the GitHub release and submits both stores through Publish marketplaces. Inspect each job and its submission receipt. A GitHub release alone is not a store submission.
- If an older Chrome review blocks the new release, use the existing Publish marketplaces workflow with the new version, `store=chrome`, and `replace_pending=true`. It verifies the pending version is older before canceling it. Do not cancel equal or newer submissions.
- Do not print credentials or copy them into source. Publishing secrets already live in GitHub Actions.
- If no extension changes are needed, record the audit without bumping the version or uploading identical packages. Report changes, store status, and any blocker concisely.
