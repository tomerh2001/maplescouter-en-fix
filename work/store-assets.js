#!/usr/bin/env node
/* Generates Chrome Web Store assets with puppeteer's bundled Chromium:
   - 1280x800 screenshots of the fixed site (through the localhost proxy testbed)
   - 440x280 small promo tile + 1400x560 marquee (rendered from local HTML) */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'extension', 'store-assets');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['shot-1-home', 'http://localhost:8787/en'],
  ['shot-2-input', 'http://localhost:8787/en/input'],
  ['shot-3-starforce', 'http://localhost:8787/en/simulator/starforce'],
  ['shot-4-exp', 'http://localhost:8787/en/exp/total'],
];

const PROMO = (w, h, big) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;
  display:flex;align-items:center;justify-content:center;gap:${big ? 48 : 24}px;
  background:linear-gradient(135deg,#1a1a1f 0%,#2b1a12 60%,#4a2313 100%);font-family:Helvetica,Arial">
  <img src="file://${path.join(__dirname, '..', 'extension', 'icons', 'icon128.png')}" width="${big ? 160 : 96}" height="${big ? 160 : 96}" style="border-radius:${big ? 32 : 20}px">
  <div>
    <div style="color:#fff;font-size:${big ? 56 : 28}px;font-weight:700;letter-spacing:-0.5px">MapleScouter<br>Enhancements</div>
    <div style="color:#ffb08a;font-size:${big ? 26 : 14}px;margin-top:${big ? 14 : 8}px">Full GMS English &middot; No ads &middot; Remembers your server</div>
  </div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('msfix:locale', 'en');
      localStorage.setItem('region', JSON.stringify({ state: { region: 'gms' }, version: 0 }));
      localStorage.setItem('msfix:region-backup', JSON.stringify({ state: { region: 'gms' }, version: 0 }));
    } catch (e) {}
  });
  for (const [name, url] of PAGES) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 4000)); // let the script's sweeps settle
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('shot:', name);
    } catch (e) { console.log('FAILED', name, e.message.slice(0, 80)); }
  }
  // promo tiles
  for (const [name, w, h, big] of [['promo-small', 440, 280, false], ['promo-marquee', 1400, 560, true]]) {
    const f = path.join(OUT, name + '.html');
    fs.writeFileSync(f, PROMO(w, h, big));
    await page.setViewport({ width: w, height: h });
    await page.goto('file://' + f, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    fs.unlinkSync(f);
    console.log('tile:', name, w + 'x' + h);
  }
  await browser.close();
})();
