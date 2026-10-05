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
const PAGEURL='https://www.stormsafesteel.com/hurricane-rated-steel-buildings';
const ld=JSON.stringify({'@context':'https://schema.org','@graph':[
  {'@type':'HomeAndConstructionBusiness','@id':'https://www.stormsafesteel.com/#business',name:'StormSafe Steel',url:'https://www.stormsafesteel.com/',telephone:'+1-561-771-5555',
   address:{'@type':'PostalAddress',addressLocality:'West Palm Beach',addressRegion:'FL',addressCountry:'US'},areaServed:{'@type':'State',name:'Florida'},
   description:'Custom hurricane-rated steel buildings: garages, carports, RV covers, commercial, agricultural and custom builds, engineered for Florida wind codes.'},
  {'@type':'BreadcrumbList',itemListElement:[
    {'@type':'ListItem',position:1,name:'Home',item:'https://www.stormsafesteel.com/'},
    {'@type':'ListItem',position:2,name:'Buildings',item:'https://www.stormsafesteel.com/buildings'},
    {'@type':'ListItem',position:3,name:'Hurricane-Rated Steel Buildings',item:PAGEURL}]},
  {'@type':'FAQPage','@id':PAGEURL+'#faq',mainEntity:faqs}
]});

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
rep('<div class="eyebrow">Wind Load · ASCE 7-22</div>','<h1 class="eyebrow" id="h1">Hurricane-Rated Steel Buildings · Florida</h1>');
rep('<h1 id="h1">What Holds Up<span class="teal">At 170+ MPH.</span></h1>','<p class="h1-display">What Holds Up<span class="teal">At 170+ MPH.</span></p>');
rep('\nh1{font-family:var(--h);font-weight:900;','\n.h1-display{font-family:var(--h);font-weight:900;');
rep('\nh1 .teal{','\n.h1-display .teal{');
s=s.replace(/<div class="stub">[\s\S]*?<\/div><\/div>\n/, sections+'\n');
// county rows rendered into the HTML so crawlers see the data without JS
{
  const cities=eval('['+/const CITIES = \[([\s\S]*?)\];/.exec(s)[1]+']');
  const hw=eval(/const HW = (\[[^\]]*\]);/.exec(s)[1]);
  const rows=cities.map((c,i)=>({c:c[0],co:c[1],v:c[2],i})).sort((a,b)=>b.v-a.v||a.c.localeCompare(b.c)).map(d=>{
    const isHW=hw.includes(d.co), p=Math.max(0,Math.min(1,(d.v-110)/60))*100, ov=d.v>150?(d.v-150)/(d.v-110)*100:0;
    return '<li class="row" tabindex="0" role="button" data-i="'+d.i+'" aria-label="'+d.c+', '+d.co+' County, '+d.v+' mph. Load into the storm test."><div class="row-name">'+d.c+'<small>'+d.co+' Co.</small></div><div class="bar"><i data-w="'+p+'"><b style="width:'+ov+'%"></b></i></div><div class="row-val">'+(isHW?'<span class="hwtag">HW</span>':'')+d.v+'<small>MPH</small></div></li>';
  }).join('');
  rep('<ul class="rows" id="rows"></ul>','<ul class="rows" id="rows">'+rows+'</ul>');
}

// expose city data for the county chart; page script last
rep('  const $ = id => document.getElementById(id);','  window.SS_CITIES=CITIES; window.SS_HW=HW;\n  const $ = id => document.getElementById(id);');
rep('</body>','<script>\n'+js+'</script>\n</body>');

const out=ROOT+'/mockups/hurricane-rated-redesign.html';
fs.writeFileSync(out,s);


// ── Wix embed version: Wix supplies header/footer; the fixed-height iframe never scrolls ──
let e=s;
const cut=(re,label)=>{ if(!re.test(e)) throw new Error('embed: missing '+label); e=e.replace(re,''); };
cut(/<nav class="top">[\s\S]*?<\/nav>\s*/,'nav');
cut(/<div class="mobile-menu" id="mm">[\s\S]*?<\/div>\s*/,'mobile menu');
cut(/<footer>[\s\S]*?<\/footer>\s*/,'footer');
cut(/<div class="mob-cta">[\s\S]*?<\/div>\s*/,'mob-cta');
e=e.replace('<body>','<body class="embed">');
e=e.split('<details>').join('<details open>');
e=e.replace('</style>',rd(path.join(D,'embed.css'))+'</style>');
e=e.replace('Scroll. Your building assembles one layer at a time, from the anchors up.','Your building assembles one layer at a time, from the anchors up. Tap any layer.');
const out2=ROOT+'/mockups/hurricane-rated-WIX-EMBED.html';
fs.writeFileSync(out2,e);
console.log('wrote',out2,(e.length/1024).toFixed(0)+' KB');
