# Privacy Policy, MapleScouter English Fix

_Last updated: 2026-09-03_

MapleScouter English Fix does **not collect, sell, or track any user data.** The only data that can leave your browser is a MapleStory character preset you choose to upload to the cloud sync service described below.

## What the extension does
- It runs only on `maplescouter.com`.
- It replaces Korean interface text with English and applies quality-of-life fixes to that site's pages.
- It saves your language and server (GMS/KMS/JMS/TMS/MSEA) preferences in your browser's local storage so the site does not reset them each visit. This information never leaves your device.
- On the Character page it saves your inputs into the site's own preset slots (local storage), keeps the last 10 saves of each character in local storage, and can sync a character with the cloud service below when you ask it to.

## Cloud sync (scouter.tomerh2001.com)
- **What is sent when you upload:** the inputs of the character you upload (class, level, stats, equipment settings) and the IGN you typed. Nothing is uploaded until you click the sync icon and confirm.
- **What is sent otherwise:** the IGN only. This happens when you type an IGN to load a character from the cloud, when you add a character and the extension checks whether that IGN already exists, and when it checks the selected character for a newer cloud copy (at most every 5 minutes while the tab is visible, plus at most once a minute when you return to the tab).
- Your IP address is seen by the server like for any web request. It is used for rate limiting and request logs only.
- **The service is public:** there are no accounts. Anyone who knows an IGN can load or overwrite its preset. The extension never lists other people's characters. Do not upload anything you consider private.
- **Opt out:** do not upload. A character that has never been uploaded stays in your browser, and no cloud request is made for it apart from the IGN checks above. Set `localStorage["msfix:cloud:url"]` to another server to use your own backend.

## Data collection
Apart from the cloud sync above, none. The extension performs all of its work locally in your browser. It does not send any information to the developer or to any third party, and it contains no analytics, tracking, or advertising code.

## Permissions
- **Host access to `maplescouter.com`**: required so the content script can translate that site's interface and manage the Character page. The extension has no access to any other website.

## Third parties
The extension is not affiliated with maplescouter.com or Nexon. All MapleStory game data is © Nexon.

## Contact
Questions or issues: https://github.com/tomerh2001/maplescouter-en-fix/issues
