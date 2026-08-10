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
  await page.evaluateOnNewDocument(data);
  await page.evaluateOnNewDocument(script);
  await page.evaluateOnNewDocument(() => { try {
    localStorage.setItem('msfix:locale','en');
    localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0}));
    localStorage.setItem('msfix:region-backup', JSON.stringify({state:{region:'gms'},version:0}));
  } catch(e){} });
  const url = 'https://maplescouter.com/en/result?name=' + encodeURIComponent('고마오');
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch(e){}
  // wait for boss cards
  for (let i=0;i<24;i++){ await new Promise(r=>setTimeout(r,2000)); const ok=await page.evaluate(()=>/Party-able|Soloable|Impossible/.test(document.body.innerText)).catch(()=>false); if(ok) break; }
  // close every modal / popup: click X, Close, "Don't show", and press Escape
  await page.evaluate(() => {
    const clickAll = (pred) => [...document.querySelectorAll('button, [role=button], svg, [aria-label]')].forEach(b => { try { if (pred(b)) b.click(); } catch(e){} });
    // close buttons (X icons) and Close/Don't show buttons
    [...document.querySelectorAll('button')].forEach(b => { const t=b.textContent.trim(); if(/^(Close|Don't show again today|Don't show again|✕|×)$/i.test(t)) b.click(); });
    [...document.querySelectorAll('[aria-label]')].forEach(b => { if(/close/i.test(b.getAttribute('aria-label')||'')) try{b.click()}catch(e){} });
    // lucide X icons inside dialogs
    [...document.querySelectorAll('.lucide-x, svg.lucide-x, [class*="lucide-x"]')].forEach(x => { const btn=x.closest('button')||x; try{btn.click()}catch(e){} });
  });
  await new Promise(r=>setTimeout(r,800));
  await page.keyboard.press('Escape');
  await new Promise(r=>setTimeout(r,800));
  // scroll so the boss card grid (Party-able/Soloable badges) sits near the top
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('*')].filter(e => /^(Party-able|Soloable|Soloable-|Soloable\+|Impossible|N\/A|Party-able-)$/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0);
    if (cards.length) { const top = Math.min(...cards.map(c=>c.getBoundingClientRect().top + window.scrollY)); window.scrollTo(0, Math.max(0, top - 170)); }
    else window.scrollTo(0, 500);
  });
  await new Promise(r=>setTimeout(r,1500));
  await page.screenshot({ path: path.join(__dirname,'..','extension','store-assets','shot-boss.png') });
  const still = await page.evaluate(()=>!!document.querySelector('[role=dialog]') || /Boss Clear Spec Guide/.test(document.body.innerText));
  console.log('captured; guide modal still present:', still);
  await browser.close();
})();
