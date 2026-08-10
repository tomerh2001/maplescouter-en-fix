const puppeteer = require('puppeteer');
const fs = require('fs');
const data = fs.readFileSync('dist/msfix-data.js','utf8');
const script = fs.readFileSync('dist/maplescouter-en-fix.user.js','utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
(async () => {
  const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
  for (const W of [1920, 1440, 1280]) {
    const p = await b.newPage();
    await p.setViewport({width:W, height:800, deviceScaleFactor:2});
    await p.evaluateOnNewDocument(data); await p.evaluateOnNewDocument(script);
    await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('msfix:locale','en');localStorage.setItem('region',JSON.stringify({state:{region:'gms'},version:0}));}catch(e){}});
    try { await p.goto('https://maplescouter.com/en', {waitUntil:'networkidle2', timeout:40000}); } catch(e){}
    await new Promise(r=>setTimeout(r,5000));
    const info = await p.evaluate(()=>{
      const s=document.querySelector('.msfix-credit');
      const logo=[...document.querySelectorAll('header a')].find(a=>a.querySelector('img[alt="logo"],img[src*="logo"]') && a.offsetParent);
      const wm=logo?logo.querySelector('span'):null;
      if(!s||!logo||!wm) return {ok:false};
      const sr=s.getBoundingClientRect(), wr=wm.getBoundingClientRect(), lr=logo.getBoundingClientRect();
      const cs=getComputedStyle(s);
      return { fontPx: cs.fontSize, underWordmark: Math.abs(sr.left - wr.left) < 8, belowWordmark: sr.top >= wr.bottom - 4, notCentered: sr.left < 400, sTop: Math.round(sr.top), wmBottom: Math.round(wr.bottom), sLeft: Math.round(sr.left), wmLeft: Math.round(wr.left) };
    });
    // clip header for a look
    await p.evaluate(()=>{const btn=[...document.querySelectorAll('button')].find(x=>/Close|Don't show/i.test(x.textContent)); if(btn)btn.click();});
    await new Promise(r=>setTimeout(r,600));
    await p.screenshot({ path:`extension/store-assets/verify-credit-${W}.png`, clip:{x:0,y:0,width:Math.min(W,900),height:100} });
    console.log('W='+W, JSON.stringify(info));
    await p.close();
  }
  await b.close(); process.exit(0);
})();
