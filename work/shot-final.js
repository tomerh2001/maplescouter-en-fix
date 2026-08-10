const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join(__dirname,'..','dist','msfix-data.js'),'utf8');
const script = fs.readFileSync(path.join(__dirname,'..','dist','maplescouter-en-fix.user.js'),'utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
const A = path.join(__dirname,'..','extension','store-assets');
const withTimeout = (p, ms) => Promise.race([p, new Promise(r=>setTimeout(()=>r('timeout'),ms))]);

async function shot(browser, url, out, prep) {
  const page = await browser.newPage();
  await page.setViewport({ width:1280, height:800, deviceScaleFactor:1 });
  page.setDefaultNavigationTimeout(30000);
  await page.evaluateOnNewDocument(data);
  await page.evaluateOnNewDocument(script);
  await page.evaluateOnNewDocument(() => { try {
    localStorage.setItem('msfix:locale','en');
    localStorage.setItem('region', JSON.stringify({state:{region:'gms'},version:0}));
    localStorage.setItem('msfix:region-backup', JSON.stringify({state:{region:'gms'},version:0}));
  } catch(e){} });
  await withTimeout(page.goto(url, { waitUntil:'domcontentloaded' }).catch(()=>{}), 32000);
  await withTimeout((async()=>{ for(let i=0;i<20;i++){ await new Promise(r=>setTimeout(r,1500)); const ok=await page.evaluate(prep.ready).catch(()=>false); if(ok) break; } })(), 34000);
  await withTimeout(page.evaluate(prep.act).catch(()=>{}), 8000);
  await new Promise(r=>setTimeout(r,1800));
  await withTimeout(page.screenshot({ path: out }).catch(()=>{}), 15000);
  await page.close().catch(()=>{});
  console.log('wrote', path.basename(out));
}

(async () => {
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
  // home — verify disclaimer
  await shot(browser, 'https://maplescouter.com/en', path.join(A,'verify-home.png'), {
    ready: () => document.querySelector('header .msfix-credit') != null || /Manual Input/.test(document.body.innerText),
    act: () => { window.scrollTo(0,0); }
  });
  // boss page — dismiss modals, scroll to cards
  await shot(browser, 'https://maplescouter.com/en/result?name=' + encodeURIComponent('고마오'), path.join(A,'shot-boss.png'), {
    ready: () => /Party-able|Soloable|Impossible/.test(document.body.innerText),
    act: () => {
      [...document.querySelectorAll('button')].forEach(b=>{ const t=b.textContent.trim(); if(/^(Close|Don't show again today|Don't show again)$/i.test(t)) try{b.click()}catch(e){} });
      [...document.querySelectorAll('[class*="lucide-x"]')].forEach(x=>{ const btn=x.closest('button'); if(btn) try{btn.click()}catch(e){} });
      const cards=[...document.querySelectorAll('*')].filter(e=>/^(Party-able|Soloable|Soloable-|Soloable\+|Impossible|N\/A|Party-able-)$/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0);
      if(cards.length){ const top=Math.min(...cards.map(c=>c.getBoundingClientRect().top+window.scrollY)); window.scrollTo(0, Math.max(0, top-180)); } else window.scrollTo(0,500);
    }
  });
  await browser.close().catch(()=>{});
  console.log('DONE');
  process.exit(0);
})();
