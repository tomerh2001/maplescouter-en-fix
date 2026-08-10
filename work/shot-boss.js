const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('msfix:locale','en');
      localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0}));
      localStorage.setItem('msfix:region-backup', JSON.stringify({state:{region:'gms'},version:0}));
    } catch(e){}
  });
  const url = 'http://localhost:8787/en/result?name=' + encodeURIComponent('고마오');
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch(e){ console.log('nav warn', e.message.slice(0,50)); }
  // wait for boss cards to render
  let ok = false;
  for (let i=0;i<20;i++){
    await new Promise(r=>setTimeout(r,1500));
    ok = await page.evaluate(() => /Party-able|Soloable|Impossible/.test(document.body.innerText));
    if (ok) break;
  }
  console.log('boss cards present:', ok);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => /Party-able|Soloable/.test(e.textContent) && e.getBoundingClientRect().top > 100);
    if (el) el.scrollIntoView({block:'start'}); else window.scrollTo(0, 600);
    window.scrollBy(0, -120);
  });
  await new Promise(r=>setTimeout(r,1500));
  await page.screenshot({ path: path.join(__dirname,'..','extension','store-assets','shot-boss.png') });
  console.log('captured');
  await browser.close();
})();
