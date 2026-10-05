/* ─── NAV ─── */
function toggleMenu(){var m=document.getElementById('mm');var o=m.classList.toggle('open');document.querySelector('.nav-menu-btn').setAttribute('aria-expanded',o);}
function closeMenu(){document.getElementById('mm').classList.remove('open');document.querySelector('.nav-menu-btn').setAttribute('aria-expanded','false');}
document.getElementById('yr').textContent=new Date().getFullYear();
var REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ─── DATA PLATE ─── */
(function(){
  var P={std:{model:'Standard',mph:150,frame:'14-ga steel tube',oc:"5' on center"},
         hw:{model:'High-Wind',mph:170,frame:'12-ga tube on wide spans',oc:"4' on center"}};
  var mphEl=document.getElementById('pl-mph'),cur=170,raf=null;
  function set(k){
    var d=P[k];
    document.querySelectorAll('[data-plate]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.plate===k);});
    document.getElementById('pl-model').textContent='Model: '+d.model;
    ['pl-frame','pl-oc'].forEach(function(id){var el=document.getElementById(id);el.textContent=id==='pl-frame'?d.frame:d.oc;el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');});
    if(raf)cancelAnimationFrame(raf);
    if(REDUCE){cur=d.mph;mphEl.textContent=cur;return;}
    var from=cur,t0=performance.now();
    (function step(now){var p=Math.min(1,(now-t0)/500);cur=Math.round(from+(d.mph-from)*(1-Math.pow(1-p,3)));mphEl.textContent=cur;if(p<1)raf=requestAnimationFrame(step);})(t0);
  }
  document.querySelectorAll('[data-plate]').forEach(function(b){b.addEventListener('click',function(){set(b.dataset.plate);});});
})();

/* ─── ANATOMY: building assembles layer by layer as you scroll ─── */
(function(){
  var canvas=document.getElementById('c-anat');
  if(!canvas||!window.THREE)return;
  var R;try{R=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});}catch(e){return;}
  R.setPixelRatio(Math.min(devicePixelRatio,2));R.outputEncoding=THREE.sRGBEncoding;
  var scene=new THREE.Scene();
  var cam=new THREE.PerspectiveCamera(30,1.4,1,600);
  var TARGET=new THREE.Vector3(0,6,0),CAMDIR=new THREE.Vector3(46,30,64).normalize();
  scene.add(new THREE.HemisphereLight(0xffffff,0x3b4a5c,1.0));
  var key=new THREE.DirectionalLight(0xffffff,.55);key.position.set(35,45,60);scene.add(key);
  var rim=new THREE.DirectionalLight(0xbfefff,.3);rim.position.set(-40,25,-40);scene.add(rim);

  var W=30,L=40,H=12,PITCH=.25,RISE=W/2*PITCH,TOP=H+RISE,OC=4;
  var root=new THREE.Group();scene.add(root);
  var LAYERS=[],HL=[.5,.28,1,.12,.45],DROP=[-3,10,6,9,4];
  function layer(){var g=new THREE.Group();root.add(g);var o={g:g,mats:[],vis:0,hl:0};LAYERS.push(o);return o;}
  function mat(o,p){var m=new THREE.MeshStandardMaterial(Object.assign({roughness:.55,metalness:.3,transparent:true,opacity:0},p));m.emissive=new THREE.Color(0x8dc63f);m.emissiveIntensity=0;o.mats.push(m);return m;}
  function box(o,w,h,d,m,x,y,z,parent){var me=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);me.position.set(x,y,z);(parent||o.g).add(me);return me;}
  var UP=new THREE.Vector3(0,1,0);
  function beam(o,m,a,b,t){var v=new THREE.Vector3().subVectors(b,a),len=v.length();
    var me=new THREE.Mesh(new THREE.BoxGeometry(t,len,t),m);me.position.copy(a).addScaledVector(v,.5);
    me.quaternion.setFromUnitVectors(UP,v.normalize());o.g.add(me);return me;}
  var V=function(x,y,z){return new THREE.Vector3(x,y,z);};
  function ribTex(base,dark,light,vertical){
    var c=document.createElement('canvas');c.width=vertical?96:4;c.height=vertical?4:96;var g=c.getContext('2d');
    g.fillStyle=base;g.fillRect(0,0,c.width,c.height);
    var bar=function(p,w,col,a){g.globalAlpha=a;g.fillStyle=col;vertical?g.fillRect(p,0,w,4):g.fillRect(0,p,4,w);};
    [0,32,64].forEach(function(p){bar(p,5,dark,.55);bar(p+5,2,light,.7);bar(p+18,1,dark,.18);});g.globalAlpha=1;
    var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.encoding=THREE.sRGBEncoding;t.anisotropy=R.capabilities.getMaxAnisotropy();return t;}
  var frames=[];for(var z=-L/2;z<=L/2+.01;z+=OC)frames.push(z);
  var roofY=function(x){return H+Math.max(0,W/2-Math.abs(x))*PITCH;};

  // 0 — foundation
  var F=layer();
  box(F,W+1.5,.5,L+1.5,mat(F,{color:0x7d8692,roughness:.95,metalness:0}),0,-.25,0);
  var anc=mat(F,{color:0x39424e,metalness:.7,roughness:.35});
  frames.forEach(function(z){[-1,1].forEach(function(s){var m=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,1.1,10),anc);m.position.set(s*(W/2-.35),.45,z);F.g.add(m);});});
  [-10,0,10].forEach(function(x){[-1,1].forEach(function(s){var m=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,1.1,10),anc);m.position.set(x,.45,s*(L/2-.35));F.g.add(m);});});

  // 1 — frame
  var FR=layer(),galv=mat(FR,{color:0xb9c3cd,metalness:.65,roughness:.32});
  frames.forEach(function(z){
    [-1,1].forEach(function(s){
      beam(FR,galv,V(s*W/2,0,z),V(s*W/2,H,z),.38);
      beam(FR,galv,V(s*W/2,H,z),V(0,TOP,z),.38);
      // doubled rafter: second tube under the top ~2/3 of each rafter
      var nx=-s*.243,ny=-.97,o=.75;
      var a=V(s*W/2*(1-.34),H+RISE*.34,z),b=V(s*W/2*(1-.98),H+RISE*.98,z);
      beam(FR,galv,V(a.x+nx*o,a.y+ny*o,z),V(b.x+nx*o,b.y+ny*o,z),.26);
    });
  });
  [-1,1].forEach(function(s){
    beam(FR,galv,V(s*W/2,.15,-L/2),V(s*W/2,.15,L/2),.32);           // base rail
    beam(FR,galv,V(s*W/2,H,-L/2),V(s*W/2,H,L/2),.3);                // eave rail
    [4,8].forEach(function(y){beam(FR,galv,V(s*(W/2+.2),y,-L/2),V(s*(W/2+.2),y,L/2),.18);});  // girts
    [.25,.55,.85].forEach(function(f){var x=s*W/2*(1-f);beam(FR,galv,V(x,roofY(x)+.3,-L/2-.4),V(x,roofY(x)+.3,L/2+.4),.18);}); // purlins
  });
  [-L/2,L/2].forEach(function(z){[-10,-5,5,10].forEach(function(x){beam(FR,galv,V(x,0,z),V(x,roofY(x),z),.3);});beam(FR,galv,V(0,0,z),V(0,TOP,z),.3);});

  // 2 — bracing (knee braces on side-wall frames, not end walls)
  var BR=layer(),kb=mat(BR,{color:0xd3dbe3,metalness:.6,roughness:.3});
  frames.forEach(function(z){if(Math.abs(z)>L/2-.1)return;[-1,1].forEach(function(s){
    beam(BR,kb,V(s*W/2,H-3,z),V(s*(W/2-3),H+3*PITCH-.15,z),.3);});});

  // 3 — skin (panels + trim)
  var SK=layer();
  var wallM=function(rep){var t=ribTex('#d9dee5','#9aa4b1','#ffffff',true);t.repeat.set(rep,1);return mat(SK,{map:t});};
  var trim=mat(SK,{color:0x2a3039,roughness:.5});
  [[W/2,Math.PI/2],[-W/2,-Math.PI/2]].forEach(function(a){var m=new THREE.Mesh(new THREE.PlaneGeometry(L,H),wallM(L/3));m.position.set(Math.sign(a[0])*(W/2+.45),H/2,0);m.rotation.y=a[1];SK.g.add(m);});
  var sh=new THREE.Shape();sh.moveTo(-W/2,0);sh.lineTo(W/2,0);sh.lineTo(W/2,H);sh.lineTo(0,TOP);sh.lineTo(-W/2,H);sh.closePath();
  [[L/2+.25,0],[-L/2-.25,Math.PI]].forEach(function(a){var t=ribTex('#d9dee5','#9aa4b1','#ffffff',true);t.repeat.set(1/3,1);var m=new THREE.Mesh(new THREE.ShapeGeometry(sh),mat(SK,{map:t}));m.position.z=a[0];m.rotation.y=a[1];SK.g.add(m);});
  var slope=Math.hypot(W/2,RISE),ang=Math.atan(PITCH),OH=.8;
  [1,-1].forEach(function(sd){
    var t=ribTex('#4a5361','#2b323c','#6b7584',false);t.repeat.set(1,(L+2*OH)/3);
    var piv=new THREE.Group();piv.position.set(sd*W/4,H+RISE/2+.55,0);piv.rotation.z=-sd*ang;SK.g.add(piv);
    var p=new THREE.Mesh(new THREE.PlaneGeometry(slope+OH,L+2*OH),mat(SK,{map:t,side:THREE.DoubleSide,roughness:.5,metalness:.35}));
    p.rotation.x=-Math.PI/2;p.position.x=sd*OH/2;piv.add(p);
    [L/2+OH,-(L/2+OH)].forEach(function(z){box(SK,slope+OH,.45,.3,trim,sd*OH/2,.05,z,piv);});
    box(SK,.35,.5,L+2*OH,trim,sd*(slope/2+OH),-.1,0,piv);
  });
  box(SK,1.4,.35,L+2*OH,trim,0,TOP+.62,0);
  [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(function(a){box(SK,.55,H,.55,trim,a[0]*(W/2+.5),H/2,a[1]*(L/2+.3));});

  // 4 — openings
  var OP=layer();
  var sc=document.createElement('canvas');sc.width=4;sc.height=64;var sg=sc.getContext('2d');
  sg.fillStyle='#eef1f4';sg.fillRect(0,0,4,64);sg.fillStyle='#b8c0ca';sg.fillRect(0,0,4,3);sg.fillStyle='#fff';sg.fillRect(0,3,4,2);
  var st=new THREE.CanvasTexture(sc);st.wrapS=st.wrapT=THREE.RepeatWrapping;st.encoding=THREE.sRGBEncoding;st.repeat.set(1,10/.75);
  var otrim=mat(OP,{color:0x2a3039,roughness:.5}),white=mat(OP,{color:0xf1f4f7,roughness:.45}),glass=mat(OP,{color:0x1d3347,roughness:.15,metalness:.6});
  box(OP,10,10,.2,mat(OP,{map:st,roughness:.45}),0,5,L/2+.45);
  box(OP,10.8,.9,.7,otrim,0,10.45,L/2+.7);
  [-5.3,5.3].forEach(function(x){box(OP,.45,10.6,.4,mat(OP,{color:0x9aa6b3,metalness:.6,roughness:.3}),x,5.3,L/2+.5);});
  function grp(x,z,ry){var g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=ry;OP.g.add(g);return g;}
  var wd=grp(W/2+.5,10,Math.PI/2);box(OP,3,7,.15,white,0,3.5,.08,wd);box(OP,3.4,.3,.2,otrim,0,7.15,.1,wd);[-1.6,1.6].forEach(function(px){box(OP,.25,7,.2,otrim,px,3.5,.1,wd);});
  [-4,-14].forEach(function(z){var w=grp(W/2+.5,z,Math.PI/2);box(OP,3.5,3.5,.12,white,0,5.5,.06,w);box(OP,3,3,.18,glass,0,5.5,.1,w);});

  // ground grid
  var grid=new THREE.PolarGridHelper(40,16,5,96,0x09d6dc,0x09d6dc);grid.material.transparent=true;grid.material.opacity=.12;grid.position.y=-.52;scene.add(grid);

  // step tracking
  var step=-1,started=false,NAMES=['Foundation','Frame','Bracing','Skin','Openings'];
  var dots=document.querySelectorAll('.anat-dots i'),stepsEl=document.querySelectorAll('.anat-step');
  function setStep(i){step=i;document.getElementById('anat-n').textContent='0'+(i+1);document.getElementById('anat-t').textContent=NAMES[i];
    dots.forEach(function(d,j){d.classList.toggle('on',j===i);});stepsEl.forEach(function(s,j){s.classList.toggle('on',j===i);});}
  // active step = the one whose middle is closest to the viewport middle
  function pickStep(){var mid=innerHeight/2,best=0,bd=1e9;stepsEl.forEach(function(s,j){var r=s.getBoundingClientRect(),d=Math.abs(r.top+r.height/2-mid);if(d<bd){bd=d;best=j;}});if(best!==step)setStep(best);}
  addEventListener('scroll',pickStep,{passive:true});addEventListener('resize',pickStep);
  setStep(0);pickStep();

  var visible=false;
  function onScreen(){var r=canvas.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}

  function resize(){var w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;var pr=R.getPixelRatio();
    if(canvas.width!==Math.round(w*pr)||canvas.height!==Math.round(h*pr)){R.setSize(w,h,false);cam.aspect=w/h;
      var d=86*Math.max(1,1.45/cam.aspect);cam.position.copy(TARGET).addScaledVector(CAMDIR,d);cam.lookAt(TARGET);cam.updateProjectionMatrix();}}

  var t0=performance.now(),T=0;
  function frame(now){
    requestAnimationFrame(frame);
    var dt=Math.min(.05,(now-t0)/1000);t0=now;
    visible=onScreen();if(!visible)return;started=true;
    T+=dt;resize();
    root.rotation.y=REDUCE?-.3:-.3+Math.sin(T*.22)*.38;
    LAYERS.forEach(function(o,j){
      var tv=started&&j<=step?1:0,th=j===step?1:0;
      if(REDUCE){o.vis=tv;o.hl=th;}else{o.vis+=(tv-o.vis)*Math.min(1,dt*3.2);o.hl+=(th-o.hl)*Math.min(1,dt*4);}
      o.g.visible=o.vis>.01;
      o.g.position.y=(1-o.vis)*DROP[j];
      var glow=o.hl*HL[j]*(REDUCE?.8:(.72+.28*Math.sin(T*3)));
      o.mats.forEach(function(m){m.opacity=o.vis;m.depthWrite=o.vis>.98;m.emissiveIntensity=glow*.55;});
    });
    R.render(scene,cam);
  }
  requestAnimationFrame(frame);
})();

/* ─── COUNTY CHART ─── */
(function(){
  var C=window.SS_CITIES||[],HW=window.SS_HW||[],rows=document.getElementById('rows'),body=document.querySelector('.chart-body');
  var MIN=110,MAX=170,sort='mph',shown=false;
  function draw(){
    var list=C.map(function(c,i){return {c:c[0],co:c[1],v:c[2],i:i};});
    list.sort(sort==='mph'?function(a,b){return b.v-a.v||a.c.localeCompare(b.c);}:function(a,b){return a.c.localeCompare(b.c);});
    rows.innerHTML=list.map(function(d){
      var hw=HW.indexOf(d.co)>=0,p=Math.max(0,Math.min(1,(d.v-MIN)/(MAX-MIN)))*100,ov=d.v>150?(d.v-150)/(d.v-MIN)*100:0;
      return '<li class="row" tabindex="0" role="button" data-i="'+d.i+'" aria-label="'+d.c+', '+d.co+' County, '+d.v+' mph. Load into the storm test.">'+
        '<div class="row-name">'+d.c+'<small>'+d.co+' Co.</small></div>'+
        '<div class="bar"><i data-w="'+p+'"'+(shown?' style="width:'+p+'%"':'')+'><b style="width:'+ov+'%"></b></i></div>'+
        '<div class="row-val">'+(hw?'<span class="hwtag">HW</span>':'')+d.v+'<small>MPH</small></div></li>';
    }).join('');
    body.style.setProperty('--rows-h',rows.offsetHeight+'px');
  }
  function grow(){shown=true;rows.querySelectorAll('.bar i').forEach(function(el){el.style.width=el.dataset.w+'%';});}
  function pick(el){var sel=document.getElementById('city');if(!sel)return;sel.value=el.dataset.i;sel.dispatchEvent(new Event('change'));
    document.getElementById('storm-test').scrollIntoView({behavior:REDUCE?'auto':'smooth'});}
  rows.addEventListener('click',function(e){var r=e.target.closest('.row');if(r)pick(r);});
  rows.addEventListener('keydown',function(e){var r=e.target.closest('.row');if(r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick(r);}});
  document.querySelectorAll('[data-sort]').forEach(function(b){b.addEventListener('click',function(){sort=b.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach(function(x){x.setAttribute('aria-pressed',x===b);});draw();});});
  draw();
  addEventListener('resize',function(){body.style.setProperty('--rows-h',rows.offsetHeight+'px');});
  new IntersectionObserver(function(es,o){if(es[0].isIntersecting){o.disconnect();setTimeout(grow,150);}},{threshold:.2}).observe(rows);
})();

/* ─── FINDER (truss by width) ─── */
/*__TRUSS__*/
(function(){
  document.getElementById('tier-bar').innerHTML=TRUSS.map(function(t){return '<div class="tier-seg" data-id="'+t.id+'"></div>';}).join('');
  document.getElementById('tier-ticks').innerHTML=TRUSS.map(function(t){return '<span data-id="'+t.id+'">'+t.min+'–'+t.max+"'</span>";}).join('');
  var input=document.getElementById('width');
  function render(){
    var w=+input.value,t=tierFor(w);
    document.getElementById('finder-svg').innerHTML=frameSVG(w,t);
    document.getElementById('stage-tag').textContent="End frame · "+w+"' wide · 12' legs";
    document.getElementById('r-width').textContent=w;
    document.getElementById('r-name').textContent=t.name;
    var pill=document.getElementById('r-pill');pill.textContent=t.kind;pill.className='pill '+t.kind.toLowerCase();
    document.getElementById('r-desc').textContent=t.desc;
    document.getElementById('r-legs').textContent=t.legs;
    document.getElementById('r-range').textContent=t.min+"' – "+t.max+"'";
    document.getElementById('r-cta').textContent="Customize a "+w+"' Build →";
    document.querySelectorAll('.finder [data-id]').forEach(function(el){el.classList.toggle('on',el.getAttribute('data-id')===t.id);});
  }
  input.addEventListener('input',render);render();
})();

/* ─── REVEAL ─── */
(function(){
  var els=document.querySelectorAll('.reveal');
  if(REDUCE||!('IntersectionObserver' in window)){els.forEach(function(el){el.classList.add('in');});return;}
  var groups=new Map();
  els.forEach(function(el){if(el.hasAttribute('data-delay')){el.style.setProperty('--ri',el.dataset.delay);return;}var p=el.parentElement,i=groups.get(p)||0;if(i>0)el.style.setProperty('--ri',Math.min(i,6));groups.set(p,i+1);});
  var io=new IntersectionObserver(function(en){en.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12,rootMargin:'0px 0px -50px 0px'});
  els.forEach(function(el){io.observe(el);});
})();
