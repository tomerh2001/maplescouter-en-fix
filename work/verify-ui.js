const puppeteer = require('puppeteer');
const fs = require('fs');
const data = fs.readFileSync('dist/msfix-data.js','utf8');
const script = fs.readFileSync('dist/maplescouter-en-fix.user.js','utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
(async () => {
  const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({width:1280,height:800,deviceScaleFactor:2});
  await p.evaluateOnNewDocument(data);
  await p.evaluateOnNewDocument(script);
  await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('msfix:locale','en');localStorage.setItem('region',JSON.stringify({state:{region:'gms'},version:0}));}catch(e){}});
  try { await p.goto('https://maplescouter.com/en', {waitUntil:'networkidle2', timeout:40000}); } catch(e){}
  await new Promise(r=>setTimeout(r,5000));
  const info = await p.evaluate(()=>{
    const c = document.querySelector('a.msfix-credit');
    const rect = c ? c.getBoundingClientRect() : null;
    return { creditText: c?c.textContent:null, creditHref: c?c.href:null,
      creditVisible: c ? (c.offsetParent!==null && rect.width>0) : false,
      logoText: [...document.querySelectorAll('header a span')].map(s=>s.textContent).join('|'),
      headerOverflow: document.body.scrollWidth > window.innerWidth };
  });
  console.log(JSON.stringify(info,null,1));
  // close ad popup then screenshot the header region for a visual
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/Close|Don't show/i.test(x.textContent)); if(b)b.click(); });
  await new Promise(r=>setTimeout(r,800));
  await p.screenshot({ path:'extension/store-assets/verify-header.png', clip:{x:0,y:0,width:1280,height:120} });
  console.log('header shot saved');
  await b.close(); process.exit(0);
})();
