const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
(async () => {
  const data = fs.readFileSync(path.join(__dirname,'..','dist','msfix-data.js'),'utf8');
  const script = fs.readFileSync(path.join(__dirname,'..','dist','maplescouter-en-fix.user.js'),'utf8')
    .replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  // inject data + userscript at document-start on the REAL site
  await page.evaluateOnNewDocument(data);
  await page.evaluateOnNewDocument(script);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('msfix:locale','en');
      localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0}));
      localStorage.setItem('msfix:region-backup', JSON.stringify({state:{region:'gms'},version:0}));
    } catch(e){}
  });
  const url = 'https://maplescouter.com/en/result?name=' + encodeURIComponent('고마오');
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch(e){ console.log('nav', e.message.slice(0,40)); }
  let ok=false;
  for (let i=0;i<24;i++){ await new Promise(r=>setTimeout(r,2000)); ok = await page.evaluate(()=>/Party-able|Soloable|Impossible|Boss Clear Spec/.test(document.body.innerText)).catch(()=>false); if(ok) break; }
  console.log('boss content present:', ok);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => /Party-able|Soloable/.test(e.textContent) && e.getBoundingClientRect().top>60 && e.getBoundingClientRect().width>0);
    if (el) { el.scrollIntoView({block:'start'}); window.scrollBy(0,-150); } else window.scrollTo(0,500);
  }).catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
  await page.screenshot({ path: path.join(__dirname,'..','extension','store-assets','shot-boss.png') });
  console.log('captured');
  await browser.close();
})();
