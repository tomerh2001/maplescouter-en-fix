# Privacy Policy — MapleScouter English Fix

_Last updated: 2026-09-03_

MapleScouter English Fix does **not collect, sell, or track any user data.** The only data that can leave your browser is a MapleStory stat preset you choose to upload to the cloud sync service (below).

## What the extension does
- It runs only on `maplescouter.com`.
- It replaces Korean interface text with English and applies quality-of-life fixes to that site's pages.
- It saves your language and server (GMS/KMS/JMS/TMS/MSEA) preferences in your browser's local storage so the site does not reset them each visit. This information never leaves your device.
- On the Manual Input page it saves the inputs into the site's own preset slots (local storage) and, optionally, syncs a preset with the cloud service described below.

## Cloud sync (scouter.tomerh2001.com)
- **What is sent:** only the manual-input preset (class, level, stats, equipment settings and the IGN you typed) of a character you explicitly upload, or — if you turn on "Auto-upload changes" — the selected character's inputs after you edit them. Reading the list of characters and checking for updates sends the IGN only. Your IP address is seen by the server like for any web request; it is used for rate limiting and request logs only.
- **The service is public:** there are no accounts. Anyone who knows an IGN can view or overwrite its preset, and the character list is visible to everyone. Do not upload anything you consider private.
- **Opt out:** "Cloud sync: off" in the character picker's footer stops every network call to the service; the picker and local auto-save keep working. No cloud request is made until you add, select, or upload a character.

## Data collection
Apart from the optional cloud sync above, none. The extension performs all of its work locally in your browser. It does not send any information to the developer or to any third party, and it contains no analytics, tracking, or advertising code.

## Permissions
- **Host access to `maplescouter.com`** — required so the content script can translate that site's interface. The extension has no access to any other website.

## Third parties
The extension is not affiliated with maplescouter.com or Nexon. All MapleStory game data is © Nexon.

## Contact
Questions or issues: https://github.com/tomerh2001/maplescouter-en-fix/issues
