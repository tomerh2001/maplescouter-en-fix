# Publishing to the Chrome Web Store

Everything is pre-built — you only need the developer account and the upload clicks.

## One-time setup (~10 min)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with your Google account.
2. Pay the one-time $5 developer registration fee.

## Publish / update
1. Build: `node build.js && node build-extension.js`
   (or download `maplescouter-en-fix-extension.zip` from the latest GitHub release)
2. In the Developer Console: **New item** → upload `dist/maplescouter-en-fix-extension.zip`.
3. Store listing (copy/paste below), category **Fun** or **Productivity → Tools**, language English.
4. Privacy tab:
   - Single purpose: "Translates maplescouter.com into English, remembers site preferences, and adds a character picker with optional cloud sync of the user's stat presets."
   - Host permission justification: "The extension only runs on maplescouter.com to translate its interface text, persist the user's language/server selection, and manage the stat presets of the Manual Input page."
   - Data usage: the only data transmitted is a stat preset the user explicitly uploads (or has opted in to auto-upload) to scouter.tomerh2001.com — declare "user activity / website content" as collected for app functionality only, not sold, not used for unrelated purposes; link the privacy policy (PRIVACY.md on GitHub).
5. Submit for review. First review usually takes a few hours to a couple of days.
6. For updates: bump the userscript @version, rebuild, upload the new zip to the existing item.

## Listing copy

**Name:** MapleScouter English Fix

**Summary (132 chars max):**
Full English translations for maplescouter.com with real GMS terms, a character picker with cloud sync, language memory, no ads.

**Description:**
MapleScouter (환산주스탯) is the best MapleStory stat-equivalence calculator around, but its English mode ships with thousands of missing translations. This extension fixes that:

• ~4,500 missing translations added, using proper Global MapleStory terminology (Sacred Symbol, Legion, Boss Clear Spec — not machine translations)
• ~55,000 official item/monster/map names from KMS↔GMS game-data matching
• Fixes awkward Konglish the site already had ("Boss Cut", "Doping", "Authentic Symbol"…)
• Remembers your language and server (GMS/KMS/JMS/TMS/MSEA) — no more resetting to Korean every visit
• Removes ads and sponsor banners
• Tooltips stay open while your mouse is over them
• Character picker on the Manual Input page: inputs auto-save into the selected preset, switch characters instantly
• Optional cloud sync of your presets (public, no account) so the same character is available from any browser
• Preset export/import improvements (old files, per-slot overwrite, IGN carried in the file)
• Player names and user posts are never altered

Not affiliated with maplescouter.com or Nexon. All game data © Nexon.
