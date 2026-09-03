// Promo tiles for the Chrome Web Store (1.6.0 rebrand). Writes straight into extension/store-assets/.
const puppeteer = require('puppeteer'); const path = require('path'); const fs = require('fs');
const OUT = path.join(__dirname, '..', 'extension', 'store-assets');
const icon = path.join(__dirname, '..', 'extension', 'icons', 'icon128.png');
const MARGIN = 24;
const html = (w, h, big) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${big ? 48 : 20}px;background:linear-gradient(135deg,#1a1a1f 0%,#2b1a12 60%,#4a2313 100%);font-family:Helvetica,Arial">
  <img id="icon" src="file://${icon}" width="${big ? 160 : 88}" height="${big ? 160 : 88}" style="border-radius:${big ? 32 : 18}px">
  <div id="text" style="max-width:${big ? 1000 : 260}px"><div style="color:#fff;font-size:${big ? 56 : 26}px;font-weight:700;letter-spacing:-0.5px;line-height:1.1">MapleScouter<br>Enhancements</div>
  <div style="color:#ffb08a;font-size:${big ? 24 : 12}px;margin-top:${big ? 14 : 8}px;line-height:1.35">Full GMS English. Characters that save themselves. Cloud sync by IGN. No ads.</div></div></body></html>`;
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage();
  let failed = false;
  for (const [name, w, h, big] of [['promo-small', 440, 280, false], ['promo-marquee', 1400, 560, true]]) {
    const f = path.join(OUT, name + '.html'); fs.writeFileSync(f, html(w, h, big));
    await p.setViewport({ width: w, height: h }); await p.goto('file://' + f, { waitUntil: 'load' });
    const box = await p.evaluate(() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
      return { text: r('text'), icon: r('icon'), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    });
    const inside = r => r.left >= MARGIN && r.top >= MARGIN && r.right <= w - MARGIN && r.bottom <= h - MARGIN;
    const ok = inside(box.text) && inside(box.icon) && box.sw <= w && box.sh <= h;
    console.log('tile', name, w + 'x' + h, 'text', JSON.stringify(box.text), 'icon', JSON.stringify(box.icon), ok ? 'OK' : 'OVERFLOW');
    if (!ok) failed = true;
    await p.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 92 }); fs.unlinkSync(f);
  }
  await b.close();
  if (failed) { console.error('text does not fit with a ' + MARGIN + 'px margin'); process.exit(1); }
})();
