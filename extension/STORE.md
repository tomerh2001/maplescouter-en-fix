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
   - Host permission justification: "The extension only runs on maplescouter.com to translate its interface text, persist the user's language/server selection, and manage the character presets of the site's Character page. The only network requests go to scouter.tomerh2001.com, and only when the user loads or uploads a character by IGN."
   - Data usage: the only data transmitted is a stat preset the user explicitly uploads to scouter.tomerh2001.com — declare "Website content" as collected for app functionality only, not sold, not used for unrelated purposes; link the privacy policy (PRIVACY.md on GitHub).
5. Submit for review. First review usually takes a few hours to a couple of days.
6. For updates: bump the userscript @version, rebuild, upload the new zip to the existing item.

## Listing copy

**Name:** MapleScouter English Fix + Cloud Characters

**Summary (132 chars max):**
Full English for maplescouter.com, a character picker with auto-save, cloud sync by IGN, history, no ads. Made for GMS players.

**Description:**
MapleScouter (환산주스탯) is the best MapleStory stat calculator around, but its English mode is missing thousands of translations and it cannot load GMS characters. This extension fixes both.

Translation
- About 4,500 missing translations added, with real Global MapleStory terms (Sacred Symbol, Legion, Boss Clear Spec), not machine translations
- About 55,000 official item, monster and map names from KMS to GMS game data matching
- Fixes awkward English the site already had ("Boss Cut", "Doping", "Authentic Symbol")
- Player names and user posts are never changed

Characters (the Character page)
- One list of your saved characters with class, level and HEXA stat; pick one and everything you type is saved into it as you go
- Switch characters instantly, no reload
- Cloud sync by IGN: upload a character, then load it from any browser by typing its name. Nothing is uploaded until you click the sync icon
- The sync icon shows synced, edited since the last upload, cloud copy newer, or conflict, and lets you upload, discard your changes, or compare
- History: the last 10 saves of each character, restorable with one click
- Overwrite, rename, download or delete a character from its menu; import JSON files

Quality of life
- Remembers your language and server (GMS, KMS, JMS, TMS, MSEA), no more resetting to Korean every visit
- Removes ads and sponsor banners
- Tooltips stay open while your mouse is over them

The cloud is public and needs no account: anyone who knows an IGN can load or overwrite it, so do not store anything private.

Not affiliated with maplescouter.com or Nexon. All game data (c) Nexon.
