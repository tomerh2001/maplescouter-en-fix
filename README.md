# MapleScouter Enhancements

A Tampermonkey userscript / Chrome extension, formerly called MapleScouter English Fix, that makes [maplescouter.com](https://maplescouter.com) actually usable in English — full GMS-context translations, a character picker with auto-save and cloud sync for the Character page, quality-of-life fixes, and no ads.

MapleScouter (환산주스탯 계산기) is the best MapleStory stat-equivalence calculator around, but its English mode ships with **thousands of missing translations** and quite a few awkward, Google-Translate-style ones. This script fixes that — and much more.

## Install

**Option A — Chrome extension (unpacked or Web Store):** download `maplescouter-en-fix-extension.zip` from the [latest release](https://github.com/tomerh2001/maplescouter-en-fix/releases), unzip, and load it via chrome://extensions → Developer mode → "Load unpacked" (works in Chrome/Arc/Edge). Store publication steps live in [extension/STORE.md](extension/STORE.md).

**Option B — Tampermonkey userscript:**

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Arc/Edge/Firefox/Safari).
2. Click here: **[Install MapleScouter Enhancements](https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/maplescouter-en-fix.user.js)** — Tampermonkey will show an install prompt.
3. Open [maplescouter.com](https://maplescouter.com). Done.

**Option C, Firefox add-on:** download `maplescouter-en-fix-firefox.zip` from the [latest release](https://github.com/tomerh2001/maplescouter-en-fix/releases) and load it via about:debugging → This Firefox → "Load Temporary Add-on" (needs Firefox 140 or newer; a temporary add-on is removed when Firefox closes). The listed version on [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/maplescouter-enhancements/) installs permanently and updates itself once the listing is approved. Steps for the listing live in [extension/STORE.md](extension/STORE.md).

Updates: Tampermonkey → Utilities → *Check for userscript updates* (each release bumps the version, which also refreshes the translation data payload). Releases are published automatically on [GitHub Releases](https://github.com/tomerh2001/maplescouter-en-fix/releases).

## Features

### Translations
- **~4,500 missing translations added.** Every UI string that shipped Korean-only in English mode — menus, simulators, boss tables, tooltips, toasts — translated with proper Global MapleStory terminology (researched against official GMS names, not machine-translated).
- **~55,000 official item/monster/map names**, built by joining KMS and GMS game data by ID, so equipment and drops from the Nexon API display *official* GMS names (몽환의 벨트 → Dreamy Belt, 어센틱심볼 → Sacred Symbol).
- **Fixes literal/Konglish translations** the site already had — "Boss Cut" → "Boss Clear Spec", "Hunting Cut" → "Farming Spec", "Doping" → "Consumables & Buffs", "Authentic Symbol" → "Sacred Symbol", "Union" → "Legion", and hundreds more.
- **Full official stat names** on input forms: Attack Power, Magic Attack, Critical Rate, Boss Damage + Damage — no cryptic abbreviations.
- **Works when switching language live** — switching Korean → English through the site's selector translates everything without a page refresh, including dynamically-mounted tooltips.
- **Player and character names are never touched** — IGNs, rankings, and user posts stay exactly as they are.
- Korean-only API content that can't be translated (the Latest Updates changelog) is hidden in English mode instead of showing raw Korean.

### Characters and cloud sync (Character page), 1.7.x
The site's **Load Preset / Save Preset** buttons and the IGN search on `/input` are replaced by a **Characters** picker and a **sync icon**.
- **One list, chips for where a character lives.** Every saved preset is a row: name, class, level, **HEXA** (the site's HEXA-converted stat, filled in once you press Result), when it was saved and when its cloud copy changed, with `local` / `cloud` chips. The selected character is highlighted.
- **Every character shows its current look.** The list, the closed picker and the add dialog show the character's in-game look, taken from the public GMS rankings. The add dialog also shows the class and level the rankings report (or "Not found in the GMS rankings"; you can still add it). Looks are looked up once when you open the list, once when you type an IGN in the add dialog, and once after a rename or Set IGN. They are cached in your browser for a week, never fetched in the background.
- **Auto-save.** Pick a character and everything you type is saved into it as you go. Switching characters loads the other one instantly, without a reload.
- **Row menu (⋯ or → on a row):** overwrite it with the current inputs, rename / set its IGN, download it as JSON, open its history, delete it.
- **+ Add character** starts a new character from the current inputs (local until you upload it). Every question is a short one with plain buttons:
  - IGN already saved here: **Overwrite it** (the current inputs replace it) or **Switch to it**.
  - IGN already in the cloud: **Keep my inputs** (saved here, linked to the IGN, not uploaded until you click the sync icon) or **Load from cloud** (the cloud copy becomes the new character, already synced).
  - IGN not in the cloud: **Add**. The character stays local until you upload it.
- **Cloud by IGN, never a directory.** Type an IGN in the search box to load that character from [scouter.tomerh2001.com](https://scouter.tomerh2001.com); the extension never lists other people's characters.
- **Sync icon** with a proper tooltip: not uploaded, synced, edited since the last upload, cloud copy newer, or conflict. Click it to upload, load the cloud copy, or replace it. When the two copies differ you get one question with two or three buttons, and a **Show differences** link lists the fields that changed. It re-checks every 30 s and on focus. Uploads are always explicit (no auto-upload).
- **Import JSON...** in the picker footer imports a native or old-format preset file; a file that carries an `ign` which already exists offers to replace it.
- **History.** The row menu keeps the last 10 saves of each character (uploads, edits, cloud pulls, and what was there before an overwrite). Pick one to load it into the form locally; upload it from the sync icon if you want it in the cloud.
- **Adding a character keeps it local.** "+ Add character" saves the current inputs under the IGN in this browser; the sync icon shows "not uploaded" until you click it.
- **One Delete, four choices.** Delete in the row menu asks "Delete this character?" and offers **Cancel**, **Delete local**, **Delete cloud** and **Delete both** when the character has a cloud copy. Delete cloud keeps the local copy linked to the IGN. Delete both removes the cloud copy first and keeps the local copy if that fails. A character with no cloud copy gets a plain Cancel / Delete.
- The cloud is **public and unauthenticated by design**: anyone who knows an IGN can load or overwrite it. Don't store anything you consider private.
- **Export carries the IGN.** Save-as-JSON files of a linked preset contain `"ign"`, and importing such a file links the new preset again.

### Quality of life
- **Remembers your language.** The site redirects every fresh visit to Korean; the script sends you back to your language automatically.
- **Remembers your server selection** (GMS/KMS/JMS/TMS/MSEA) and restores it if the site wipes it.
- **No ads.** Ad slots, sponsor banners, popup ads, and the NOTICE billboard bar are removed — along with the empty gaps they reserve.
- **Tooltips stay open.** Hover cards that used to vanish when you moved the mouse onto them now stay pinned until your cursor actually leaves.
- **Preset import, improved.** MapleScouter now ships its own JSON preset export/import, so the script no longer adds its own buttons — it fills the gaps in the site's instead:
  - **Old export files still work.** Files saved by earlier versions of this script are translated to the site's format on the fly and imported natively (validated, added to a slot, no reload).
  - **Pick the character.** Those old files hold *every* preset you had saved, so when a file contains more than one character you're asked which to import instead of getting all of them.
  - **Overwrite an existing preset.** The site can only ever *add* a preset. Every row in the Save window gets an extra Import icon next to its Save-as-JSON / Delete pair, so you can refresh that specific preset from a file — choose the character, choose the name (keep the current one, take the file's, auto, or type your own), then confirm the overwrite.
- The empty Favorites bar and other wasted-space blocks are removed; labels that clipped or overflowed with longer English text are fixed.

## How it works

| Layer | What it does |
|---|---|
| **i18n bundle patch** | Wraps the site's webpack chunk loader and merges ~5,600 added/corrected keys into `en/common.json` before i18next consumes it. Bundle detection is content-based, so it survives site redeploys. |
| **DOM dictionary** | A `MutationObserver` + exact-match KO→EN dictionary (official game-data join) for text that's hardcoded or arrives from the API at runtime, plus pattern rules for dynamic strings (Korean number units 억/만, dates, burst-window notation like 3극 4준). |
| **Persistence & QoL** | Locale/region memory, ad removal, tooltip keep-alive, preset import/overwrite — all in the userscript core. |
| **Characters & cloud** | Drives the site's own zustand stores (`manual-store` = the form's draft, `preset` = the slots), captured while webpack executes them, so loads and auto-saves need no reload. Slot↔IGN links live in `localStorage` (`msfix:cloud:*`); the backend is a small file-backed JSON API ([maplescouter-cloud](https://github.com/tomerh2001/maplescouter-cloud)) reached with plain `fetch` + `If-Match` for conflict detection. Character looks come from `GET scouter.tomerh2001.com/v1/avatar/:ign`, which proxies Nexon's public GMS ranking API (the site cannot call it directly: no CORS) and caches each answer for a day; the browser keeps its own copy in `localStorage` (`msfix:cloud:avatars`, hits for 7 days, misses for 1 day) and loads the picture straight from Nexon's avatar image host. Set `localStorage.msfix:cloud:url` to point the script at another backend (e.g. a local one for testing). |

## Repo layout

```
src/         userscript source
data/        translation sources (i18n patch, dictionary, regex rules, CSS fixes)
dist/        built files served to Tampermonkey (userscript + data payload)
work/        corpus pipeline: game-data fetch, AST extraction, batch merge
test/        local proxy that injects the script at document-start for testing
work/e2e-cloud.js   puppeteer end-to-end suite for the character picker + cloud sync (needs the proxy and a backend on :8080)
build.js     bundles data/ into dist/msfix-data.js
```

Rebuild after editing data: `node build.js`. When the site ships new Korean strings, the `work/` pipeline re-scans the live site and produces the untranslated delta.

## Notes

- Translations aim for **official GMS terms first**, then widely-used community terms for KMS-only content with no official English name yet (e.g. Legion Champion).
- A React hydration warning (#418) in the console is expected — the server renders Korean, the client re-renders English.
- Cloud sync sends only the preset you explicitly upload to scouter.tomerh2001.com, plus the IGN alone for cloud checks and ranking look-ups. Nothing else ever leaves your browser — see [PRIVACY.md](PRIVACY.md).
- Not affiliated with maplescouter.com or Nexon. All game data © Nexon.

## License

MIT
