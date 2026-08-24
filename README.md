# MapleScouter English Fix

A Tampermonkey userscript that makes [maplescouter.com](https://maplescouter.com) actually usable in English — full GMS-context translations, quality-of-life fixes, and no ads.

MapleScouter (환산주스탯 계산기) is the best MapleStory stat-equivalence calculator around, but its English mode ships with **thousands of missing translations** and quite a few awkward, Google-Translate-style ones. This script fixes that — and much more.

## Install

**Option A — Chrome extension (unpacked or Web Store):** download `maplescouter-en-fix-extension.zip` from the [latest release](https://github.com/tomerh2001/maplescouter-en-fix/releases), unzip, and load it via chrome://extensions → Developer mode → "Load unpacked" (works in Chrome/Arc/Edge). Store publication steps live in [extension/STORE.md](extension/STORE.md).

**Option B — Tampermonkey userscript:**

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Arc/Edge/Firefox/Safari).
2. Click here: **[Install MapleScouter English Fix](https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/maplescouter-en-fix.user.js)** — Tampermonkey will show an install prompt.
3. Open [maplescouter.com](https://maplescouter.com). Done.

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

### Quality of life
- **Remembers your language.** The site redirects every fresh visit to Korean; the script sends you back to your language automatically.
- **Remembers your server selection** (GMS/KMS/JMS/TMS/MSEA) and restores it if the site wipes it.
- **No ads.** Ad slots, sponsor banners, popup ads, and the NOTICE billboard bar are removed — along with the empty gaps they reserve.
- **Tooltips stay open.** Hover cards that used to vanish when you moved the mouse onto them now stay pinned until your cursor actually leaves.
- **Legacy preset-file compatibility.** MapleScouter now ships its own JSON preset export/import, so the script no longer adds its own buttons. Files exported by earlier versions of this script still work: when you import one through the site's native importer, the script recognizes the old format and restores it automatically.
- The empty Favorites bar and other wasted-space blocks are removed; labels that clipped or overflowed with longer English text are fixed.

## How it works

| Layer | What it does |
|---|---|
| **i18n bundle patch** | Wraps the site's webpack chunk loader and merges ~5,600 added/corrected keys into `en/common.json` before i18next consumes it. Bundle detection is content-based, so it survives site redeploys. |
| **DOM dictionary** | A `MutationObserver` + exact-match KO→EN dictionary (official game-data join) for text that's hardcoded or arrives from the API at runtime, plus pattern rules for dynamic strings (Korean number units 억/만, dates, burst-window notation like 3극 4준). |
| **Persistence & QoL** | Locale/region memory, ad removal, tooltip keep-alive, legacy preset-file compatibility — all in the userscript core. |

## Repo layout

```
src/         userscript source
data/        translation sources (i18n patch, dictionary, regex rules, CSS fixes)
dist/        built files served to Tampermonkey (userscript + data payload)
work/        corpus pipeline: game-data fetch, AST extraction, batch merge
test/        local proxy that injects the script at document-start for testing
build.js     bundles data/ into dist/msfix-data.js
```

Rebuild after editing data: `node build.js`. When the site ships new Korean strings, the `work/` pipeline re-scans the live site and produces the untranslated delta.

## Notes

- Translations aim for **official GMS terms first**, then widely-used community terms for KMS-only content with no official English name yet (e.g. Legion Champion).
- A React hydration warning (#418) in the console is expected — the server renders Korean, the client re-renders English.
- Not affiliated with maplescouter.com or Nexon. All game data © Nexon.

## License

MIT
