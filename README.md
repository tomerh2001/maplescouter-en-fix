# MapleScouter English Fix

A Tampermonkey userscript that makes [maplescouter.com](https://maplescouter.com) actually usable in English.

MapleScouter (환산주스탯 계산기) is the best MapleStory stat-equivalence calculator around, but its English mode ships with **thousands of missing translations** and quite a few awkward, Google-Translate-style ones. This script fixes that — and it also **remembers your language and server (GMS/KMS/JMS/TMS/MSEA) selections**, so the site stops resetting you back to Korean/KMS every visit.

## What it does

- **~2,100 missing translations added.** Every UI string that shipped Korean-only in English mode — menus, simulators, boss tables, tooltips, toasts — translated with proper Global MapleStory terminology (researched against official GMS names, not machine-translated).
- **~55,000 official item/monster/map names.** Built by joining KMS and GMS game data by ID, so equipment and drops coming from the Nexon API display their *official* GMS names (e.g. 몽환의 벨트 → Dreamy Belt, 어센틱심볼 → Sacred Symbol).
- **Fixes literal/Konglish translations** that were already on the site — e.g. "Boss Cut" → "Boss Clear Spec", "Hunting Cut Analysis" → "Farming Spec Analysis", "Doping" → "Consumables & Buffs", "Authentic Symbol" → "Sacred Symbol", "Union" → "Legion".
- **Remembers your language.** The site hard-redirects every fresh visit to the Korean version; the script sends you back to `/en` (or whatever you last used) automatically.
- **Remembers your server selection** (GMS/KMS/…) and restores it if the site ever wipes it.
- **UI fixes** for layout issues caused by longer English strings.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Arc/Edge/Firefox/Safari).
2. Click here: **[Install MapleScouter English Fix](https://raw.githubusercontent.com/tomerh2001/maplescouter-en-fix/main/dist/maplescouter-en-fix.user.js)** — Tampermonkey will pick it up and show an install prompt.
3. Open [maplescouter.com](https://maplescouter.com). Done.

> On Chrome/Arc you may need to enable **Developer mode** for extensions for Tampermonkey to run userscripts (chrome://extensions → Developer mode toggle) on some Chrome versions (MV3).

## How it works

Three layers:

| Layer | What it catches |
|---|---|
| **i18n bundle patch** | Wraps the site's webpack chunk loader and merges ~3,600 added/corrected keys into `en/common.json` before i18next consumes it — everything rendered through `t()` comes out as proper English, interpolations intact. |
| **DOM dictionary** | A `MutationObserver` + exact-match KO→EN dictionary (official game-data join) for text that's hardcoded in the app or arrives from the Nexon API at runtime. Character/player names are never touched — only known game strings are replaced. |
| **Persistence** | Stores your last locale and mirrors the site's `region` localStorage key, restoring both on every visit. |

## Repo layout

```
src/         userscript source
data/        translation sources (i18n patch, dictionary, regex rules, CSS fixes)
dist/        built files served to Tampermonkey (userscript + data payload)
test/        local proxy that injects the script at document-start for testing
build.js     bundles data/ into dist/msfix-data.js
```

To rebuild after editing data: `node build.js`

## Notes

- Translations aim for **official GMS terms first**, then widely-used community terms for KMS-only content that has no official English name yet (e.g. Legion Champion).
- The site updates regularly; if a new deploy ships new Korean strings, they'll show up in Korean until this script's data is refreshed. PRs welcome.
- Not affiliated with maplescouter.com or Nexon. All game data © Nexon.

## License

MIT
