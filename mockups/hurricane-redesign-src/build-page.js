const fs=require('fs'),path=require('path');
const D=__dirname, ROOT='C:/Users/ops/stormsafe-kit';
const rd=f=>fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
let s=rd(ROOT+'/mockups/hurricane-wind-slider-mockup.html');
const repo=rd(ROOT+'/hurricane-rated-steel-buildings.html');
const sections=rd(path.join(D,'sections.html')), css=rd(path.join(D,'extra.css'));
let js=rd(path.join(D,'page.js'));
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('missing: '+a.slice(0,80)); s=s.replace(a,()=>b); };

// truss data + frame drawing, lifted from the repo page (Truss style sheets.pdf)
const t0=repo.indexOf('/* ─── TRUSS DATA'), t1=repo.indexOf('/* ─── STATIC CARDS');
if(t0<0||t1<0) throw new Error('truss block not found');
js=js.replace('/*__TRUSS__*/', repo.slice(t0,t1).replace(/\bTIERS\b/g,'TRUSS'));

// FAQ schema from the FAQ markup
const strip=h=>h.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').trim();
const faqs=[...sections.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
  .map(m=>({'@type':'Question',name:strip(m[1]),acceptedAnswer:{'@type':'Answer',text:strip(m[2])}}));
const ld=JSON.stringify({'@context':'https://schema.org','@type':'FAQPage',mainEntity:faqs});

// head
const title='Hurricane-Rated Steel Buildings in Florida | StormSafe Steel';
const desc="Steel buildings engineered to 150 or 170 mph, certified to Florida code. Check your city's wind speed and see how a hurricane-rated build goes together.";
if(title.length>60||desc.length>155) throw new Error('title '+title.length+' / desc '+desc.length);
rep(/<title>[^<]*<\/title>/.exec(s)[0],'<title>'+title+'</title>');
rep(/<meta name="description"[^>]*>/.exec(s)[0],'<meta name="description" content="'+desc+'">');
rep('<meta name="robots" content="noindex">\n',
`<link rel="canonical" href="https://www.stormsafesteel.com/hurricane-rated-steel-buildings">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="https://www.stormsafesteel.com/hurricane-rated-steel-buildings">
<meta property="og:image" content="https://static.wixstatic.com/media/f8c53c_d3fa06901cd84546822d7acb5b84eb11~mv2.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<link rel="preconnect" href="https://cdnjs.cloudflare.com">
<script type="application/ld+json">${ld}</script>
`);

// styles
s=s.replace(/\/\* mockup banner \*\/\n[^\n]*\n[^\n]*\n/,'');
s=s.replace(/\/\* rest-of-page stub \*\/\n[^\n]*\n[^\n]*\n/,'');
rep('</style>',css+'</style>');

// body: real nav + mobile menu, hero id, sections
s=s.replace(/<div class="mock-banner">[\s\S]*?<\/div>\n\n/,'');
const n0=repo.indexOf('<nav class="top">'), n1=repo.indexOf('<!-- HERO -->');
s=s.replace(/<nav class="top">[\s\S]*?<\/nav>\n/, repo.slice(n0,n1).trim()+'\n');
rep('<section class="storm" aria-labelledby="h1">','<section class="storm" id="storm-test" aria-labelledby="h1">');
rep('<div class="eyebrow">Wind Load · ASCE 7-22</div>','<div class="eyebrow">Hurricane-Rated · Florida</div>');
s=s.replace(/<div class="stub">[\s\S]*?<\/div><\/div>\n/, sections+'\n');

// expose city data for the county chart; page script last
rep('  const $ = id => document.getElementById(id);','  window.SS_CITIES=CITIES; window.SS_HW=HW;\n  const $ = id => document.getElementById(id);');
rep('</body>','<script>\n'+js+'</script>\n</body>');

const out=ROOT+'/mockups/hurricane-rated-redesign.html';
fs.writeFileSync(out,s);
console.log('wrote',out,(s.length/1024).toFixed(0)+' KB','faqs',faqs.length,'h1s',(s.match(/<h1/g)||[]).length);
