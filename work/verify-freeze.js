const puppeteer = require('puppeteer');
const fs = require('fs'), path = require('path');
const data = fs.readFileSync('dist/msfix-data.js','utf8');
const script = fs.readFileSync('dist/maplescouter-en-fix.user.js','utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
(async () => {
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({width:1280,height:800});
  await page.evaluateOnNewDocument(data);
  await page.evaluateOnNewDocument(script);
  await page.evaluateOnNewDocument(()=>{try{localStorage.setItem('msfix:locale','en');localStorage.setItem('region',JSON.stringify({state:{region:'gms'},version:0}));}catch(e){}});
  const start = Date.now();
  let responsive = false;
  try {
    await page.goto('https://maplescouter.com/en/result?name='+encodeURIComponent('고마오'), {waitUntil:'domcontentloaded', timeout:35000});
  } catch(e){ console.log('nav:', e.message.slice(0,40)); }
  // poll responsiveness: can we run JS quickly while the page churns?
  for (let i=0;i<12;i++){
    const t0 = Date.now();
    const r = await Promise.race([
      page.evaluate(()=>({ cards:/Party|Solo|Impossible/.test(document.body.innerText), credit: !!document.querySelector('a.msfix-credit'), creditText: (document.querySelector('a.msfix-credit')||{}).textContent, title: document.title })).catch(e=>({err:String(e).slice(0,30)})),
      new Promise(res=>setTimeout(()=>res({slow:true}), 5000))
    ]);
    const dt = Date.now()-t0;
    if (r.slow) { console.log('  poll', i, 'UNRESPONSIVE (>5s)'); }
    else { responsive = true; console.log('  poll', i, 'ok in', dt+'ms', '| cards:', r.cards, '| credit:', r.creditText, '| title:', r.title); if (r.cards) break; }
    await new Promise(res=>setTimeout(res,1500));
  }
  console.log('RESULT: page stayed responsive =', responsive);
  await browser.close();
  process.exit(0);
})();
