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
   - Single purpose: "Translates maplescouter.com into English and remembers site preferences."
   - Host permission justification: "The extension only runs on maplescouter.com to translate its interface text and persist the user's language/server selection."
   - Data usage: select "does not collect or transmit any user data."
5. Submit for review. First review usually takes a few hours to a couple of days.
6. For updates: bump the userscript @version, rebuild, upload the new zip to the existing item.

## Listing copy

**Name:** MapleScouter English Fix

**Summary (132 chars max):**
Full English translations for maplescouter.com with real GMS terminology — plus language/server memory, ad removal, and QoL fixes.

**Description:**
MapleScouter (환산주스탯) is the best MapleStory stat-equivalence calculator around, but its English mode ships with thousands of missing translations. This extension fixes that:

• ~4,500 missing translations added, using proper Global MapleStory terminology (Sacred Symbol, Legion, Boss Clear Spec — not machine translations)
• ~55,000 official item/monster/map names from KMS↔GMS game-data matching
• Fixes awkward Konglish the site already had ("Boss Cut", "Doping", "Authentic Symbol"…)
• Remembers your language and server (GMS/KMS/JMS/TMS/MSEA) — no more resetting to Korean every visit
• Removes ads and sponsor banners
• Tooltips stay open while your mouse is over them
• Preset Export/Import buttons for backing up your character setup
• Player names and user posts are never altered

Not affiliated with maplescouter.com or Nexon. All game data © Nexon.
