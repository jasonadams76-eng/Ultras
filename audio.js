// audio.js — procedural sound for the city: gunfire, police sirens and ambience. No audio files: everything is synthesised with Web Audio.
// Sounds are positional (distance volume + muffling, left/right pan, speed-of-sound delay). Starts after the first click/key (browser rule). M = mute.

const SOUND_SPEED=343;

// ---- one-shot synthesis (works on any BaseAudioContext, so it can also be rendered offline for checking) ----
const GUN={ // hp/cd: crack (high-passed noise) · bp/bd: body · f0->f1/td: low thump · tl: tail length
  pistol:{hp:1800,cd:.06,crack:.9,bp:1100,bd:.12,body:.6,f0:160,f1:55,td:.1,thump:.7,tail:.25,tl:.4},
  smg:{hp:2600,cd:.04,crack:.8,bp:1500,bd:.07,body:.5,f0:140,f1:70,td:.07,thump:.5,tail:.18,tl:.25},
  rifle:{hp:1500,cd:.08,crack:1,bp:700,bd:.2,body:.8,f0:100,f1:38,td:.18,thump:1,tail:.4,tl:.7},
  shotgun:{hp:900,cd:.1,crack:1,bp:380,bd:.3,body:1,f0:75,f1:30,td:.25,thump:1.2,tail:.5,tl:1}
};
export function makeNoise(ctx,seconds=2){
  const b=ctx.createBuffer(1,Math.floor(ctx.sampleRate*seconds),ctx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  return b;
}
function env(g,t,a,peak,d){g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0008,t+a+d);}
function noiseNode(ctx,buf,t,dur){const s=ctx.createBufferSource();s.buffer=buf;s.start(t,Math.random()*(buf.duration-dur-.1));s.stop(t+dur+.05);return s;}
function filt(ctx,type,f,q=.7){const b=ctx.createBiquadFilter();b.type=type;b.frequency.value=f;b.Q.value=q;return b;}
export function synthShot(ctx,out,buf,kind,t){
  const P=GUN[kind]||GUN.pistol,k=.92+Math.random()*.16;
  const mix=ctx.createGain();mix.gain.value=.6;mix.connect(out);
  { const n=noiseNode(ctx,buf,t,P.cd+.05),f=filt(ctx,'highpass',P.hp*k),g=ctx.createGain();n.connect(f);f.connect(g);g.connect(mix);env(g,t,.001,P.crack,P.cd); }
  { const n=noiseNode(ctx,buf,t,P.bd+.05),f=filt(ctx,'bandpass',P.bp*k,.8),g=ctx.createGain();n.connect(f);f.connect(g);g.connect(mix);env(g,t,.002,P.body,P.bd); }
  { const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(P.f0*k,t);o.frequency.exponentialRampToValueAtTime(P.f1*k,t+P.td);o.connect(g);g.connect(mix);env(g,t,.002,P.thump,P.td+.03);o.start(t);o.stop(t+P.td+.12); }
  { const n=noiseNode(ctx,buf,t,P.tl+.05),f=filt(ctx,'lowpass',650),g=ctx.createGain();n.connect(f);f.connect(g);g.connect(mix);env(g,t+.01,.01,P.tail,P.tl); }
}
export function synthBlast(ctx,out,buf,t){ // hero energy blast: falling saw zap + noise burst + thump
  const mix=ctx.createGain();mix.gain.value=.7;mix.connect(out);
  const o=ctx.createOscillator(),lp=filt(ctx,'lowpass',3200),g=ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(1400,t);o.frequency.exponentialRampToValueAtTime(170,t+.24);o.connect(lp);lp.connect(g);g.connect(mix);env(g,t,.004,.5,.26);o.start(t);o.stop(t+.35);
  const n=noiseNode(ctx,buf,t,.15),bp=filt(ctx,'bandpass',2600,.9),ng=ctx.createGain();n.connect(bp);bp.connect(ng);ng.connect(mix);env(ng,t,.002,.45,.1);
  const s=ctx.createOscillator(),sg=ctx.createGain();s.frequency.setValueAtTime(110,t);s.frequency.exponentialRampToValueAtTime(45,t+.2);s.connect(sg);sg.connect(mix);env(sg,t,.003,.6,.2);s.start(t);s.stop(t+.3);
}
export function synthPunch(ctx,out,buf,t){
  const mix=ctx.createGain();mix.connect(out);
  const n=noiseNode(ctx,buf,t,.12),lp=filt(ctx,'lowpass',520),g=ctx.createGain();n.connect(lp);lp.connect(g);g.connect(mix);env(g,t,.002,.9,.09);
  const o=ctx.createOscillator(),og=ctx.createGain();o.frequency.setValueAtTime(115,t);o.frequency.exponentialRampToValueAtTime(42,t+.12);o.connect(og);og.connect(mix);env(og,t,.002,.9,.12);o.start(t);o.stop(t+.25);
}
export function synthHorn(ctx,out,t,long=false){ // car horn: two detuned square tones, one or two honks
  const beeps=long?[[0,.7]]:[[0,.22],[.3,.35]];
  for(const [dt,len] of beeps)for(const f of [415,520]){
    const o=ctx.createOscillator(),bp=filt(ctx,'bandpass',900,.6),g=ctx.createGain();o.type='square';o.frequency.value=f*(.99+Math.random()*.02);o.connect(bp);bp.connect(g);g.connect(out);
    g.gain.setValueAtTime(0,t+dt);g.gain.linearRampToValueAtTime(.09,t+dt+.02);g.gain.setValueAtTime(.09,t+dt+len);g.gain.linearRampToValueAtTime(0,t+dt+len+.04);o.start(t+dt);o.stop(t+dt+len+.1);
  }
}
// offline render for checking the shapes of the sounds without speakers
export async function renderPreview(kind,seconds=1.6){
  const ctx=new OfflineAudioContext(1,Math.floor(44100*seconds),44100),buf=makeNoise(ctx,2),out=ctx.createGain();out.connect(ctx.destination);
  if(kind==='blast')synthBlast(ctx,out,buf,.05);else if(kind==='punch')synthPunch(ctx,out,buf,.05);else if(kind==='horn')synthHorn(ctx,out,.05);else synthShot(ctx,out,buf,kind,.05);
  return (await ctx.startRendering()).getChannelData(0);
}

// ---- the sound engine ----
export function createAudio({camera,P,getTraffic,vol=.5}){
  const A={ctx:null,muted:(()=>{try{return localStorage.getItem('ultras_muted')==='1';}catch(e){return false;}})(),vol,voices:0,sirens:new Map(),ready:false};
  let master,comp,noiseBuf,rev,revSend,amb={},ui;
  const right=[1,0,0],lpos=[0,0,0];
  let horn=25,farSiren=45;

  function init(){
    if(A.ctx)return;
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const c=new AC();A.ctx=c;
    master=c.createGain();master.gain.value=A.muted?0:A.vol;
    comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=5;
    master.connect(comp);comp.connect(c.destination);
    noiseBuf=makeNoise(c,3);
    // city echo: generated impulse response (decaying noise), fed by a small send from every positional sound
    const len=Math.floor(c.sampleRate*1.8),ir=c.createBuffer(2,len,c.sampleRate);
    for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6);}
    rev=c.createConvolver();rev.buffer=ir;revSend=c.createGain();revSend.gain.value=.5;revSend.connect(rev);
    const rg=c.createGain();rg.gain.value=.55;rev.connect(rg);rg.connect(master);
    // ambience beds
    const loopNoise=()=>{const s=c.createBufferSource();s.buffer=noiseBuf;s.loop=true;s.start();return s;};
    { const s=loopNoise(),a=filt(c,'lowpass',170),b=filt(c,'lowpass',260),g=c.createGain();g.gain.value=.05;s.connect(a);a.connect(b);b.connect(g);g.connect(master);amb.rumble=g; }
    { const s=loopNoise(),f=filt(c,'bandpass',1100,.5),g=c.createGain();g.gain.value=.01;s.connect(f);f.connect(g);g.connect(master);amb.hiss=g; }
    { const s=loopNoise(),f=filt(c,'bandpass',520,.6),g=c.createGain();g.gain.value=.02;s.connect(f);f.connect(g);g.connect(master);amb.wind=g;amb.windF=f; }
    A.ready=true;
    if(c.state==='suspended')c.resume();
    updateIcon();
  }
  function wake(){if(!A.ctx)init();else if(A.ctx.state==='suspended')A.ctx.resume();}
  for(const ev of ['pointerdown','keydown','touchstart'])addEventListener(ev,wake,{passive:true});
  A.wake=wake;
  function setMuted(m){A.muted=m;try{localStorage.setItem('ultras_muted',m?'1':'0');}catch(e){}if(master)master.gain.setTargetAtTime(m?0:A.vol,A.ctx.currentTime,.05);updateIcon();}
  addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat){wake();setMuted(!A.muted);}});

  // little speaker button, bottom-left
  const bar=document.createElement('div');bar.id='ctl';bar.style.cssText='position:fixed;left:14px;bottom:14px;z-index:6;display:flex;gap:8px';
  const BTN='width:38px;height:38px;border-radius:50%;background:rgba(8,12,24,.84);border:1px solid #3b4a78;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px #0009;user-select:none';
  ui=document.createElement('div');ui.id='snd';ui.style.cssText=BTN;ui.title='Sound on/off (M)';
  ui.addEventListener('click',e=>{e.stopPropagation();wake();setMuted(!A.muted);});
  const fs=document.createElement('div');fs.id='fsb';fs.style.cssText=BTN;fs.title='Full screen (Shift+F)';
  const toggleFS=()=>{try{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();}catch(e){}};
  fs.addEventListener('click',e=>{e.stopPropagation();toggleFS();});
  const fsIcon=()=>{const on=!!document.fullscreenElement;fs.innerHTML=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on?'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>':'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'}</svg>`;fs.title=on?'Exit full screen (Shift+F)':'Full screen (Shift+F)';};
  document.addEventListener('fullscreenchange',fsIcon);fsIcon();
  addEventListener('keydown',e=>{if(e.code==='KeyF'&&e.shiftKey&&!e.repeat)toggleFS();});
  bar.appendChild(ui);bar.appendChild(fs);document.body.appendChild(bar);
  function updateIcon(){
    ui.innerHTML=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#cfe0ff"/>${A.muted?'<path d="M17 9l5 6M22 9l-5 6" stroke="#ff7a7a"/>':'<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12"/>'}</svg>`;
    ui.style.opacity=A.ctx&&!A.muted?1:.7;
  }
  updateIcon();

  // ---- positional routing ----
  function listener(){
    camera.updateMatrixWorld();const e=camera.matrixWorld.elements;
    right[0]=e[0];right[1]=e[1];right[2]=e[2];lpos[0]=camera.position.x;lpos[1]=camera.position.y;lpos[2]=camera.position.z;
  }
  function geom(x,y,z){
    const dx=x-lpos[0],dy=y-lpos[1],dz=z-lpos[2],d=Math.hypot(dx,dy,dz)||.01;
    return {d,pan:Math.max(-.9,Math.min(.9,(dx*right[0]+dy*right[1]+dz*right[2])/d*.9))};
  }
  const gainFor=(d,ref=14)=>1/(1+Math.pow(d/ref,1.4));
  function route(pos,{maxD=330,ref=14,reverb=.3}={}){ // returns an input node placed in the world, or null if too far
    const c=A.ctx;if(!c||c.state!=='running'||A.voices>30)return null;
    const g=geom(pos.x,pos.y===undefined?1.2:pos.y,pos.z);if(g.d>maxD)return null;
    const gain=c.createGain();gain.gain.value=gainFor(g.d,ref);
    const lp=filt(c,'lowpass',Math.max(900,Math.min(20000,22000/(1+g.d/28))));
    const st=c.createStereoPanner();st.pan.value=g.pan;
    const dl=c.createDelay(2);dl.delayTime.value=Math.min(1.8,g.d/SOUND_SPEED);
    gain.connect(lp);lp.connect(st);st.connect(dl);dl.connect(master);
    const rs=c.createGain();rs.gain.value=reverb*Math.min(1,.4+g.d/80);lp.connect(rs);rs.connect(revSend);
    A.voices++;setTimeout(()=>{A.voices--;},1600);
    return gain;
  }
  A.gun=(pos,kind='pistol')=>{const n=route(pos,{ref:kind==='shotgun'?18:14});if(n)synthShot(A.ctx,n,noiseBuf,kind,A.ctx.currentTime+.005);};
  A.blast=(pos)=>{const n=route(pos,{ref:12,reverb:.2});if(n)synthBlast(A.ctx,n,noiseBuf,A.ctx.currentTime+.005);};
  A.punch=(pos)=>{const n=route(pos,{ref:10,reverb:.1});if(n)synthPunch(A.ctx,n,noiseBuf,A.ctx.currentTime+.005);};
  A.horn=(pos,long)=>{const n=route(pos,{ref:9,reverb:.25,maxD:140});if(n)synthHorn(A.ctx,n,A.ctx.currentTime+.01,long);};

  // ---- sirens ----
  class Siren{
    constructor(){
      const c=A.ctx;this.o=c.createOscillator();this.o.type='sawtooth';this.o2=c.createOscillator();this.o2.type='square';
      this.bp=filt(c,'bandpass',1200,.8);this.hp=filt(c,'highpass',380);this.lp=filt(c,'lowpass',9000);this.g=c.createGain();this.g.gain.value=0;this.st=c.createStereoPanner();
      const m2=c.createGain();m2.gain.value=.25;
      this.o.connect(this.bp);this.o2.connect(m2);m2.connect(this.bp);this.bp.connect(this.hp);this.hp.connect(this.lp);this.lp.connect(this.g);this.g.connect(this.st);this.st.connect(master);
      const rs=c.createGain();rs.gain.value=.15;this.g.connect(rs);rs.connect(revSend);
      this.o.start();this.o2.start();this.prev=null;this.t=Math.random()*10;
    }
    update(x,z,dt,level=1){
      const c=A.ctx,g=geom(x,1.4,z);this.t+=dt;
      const mode=(this.t%14)<8?0:1; // wail for 8 s, then yelp for 6 s
      const f=mode===0?650+700*(.5-.5*Math.cos(2*Math.PI*this.t/3.8)):750+800*((this.t*3.2)%1);
      const vr=this.prev===null?0:(g.d-this.prev)/Math.max(dt,.001);this.prev=g.d;
      const dop=SOUND_SPEED/(SOUND_SPEED+Math.max(-45,Math.min(45,vr))*2.5);
      this.o.frequency.setTargetAtTime(f*dop,c.currentTime,.03);this.o2.frequency.setTargetAtTime(f*dop*2,c.currentTime,.03);
      this.g.gain.setTargetAtTime(g.d>360?0:level*.45/(1+Math.pow(g.d/16,1.5)),c.currentTime,.08);
      this.lp.frequency.setTargetAtTime(Math.max(1200,9000/(1+g.d/55)),c.currentTime,.1);
      this.st.pan.setTargetAtTime(g.pan,c.currentTime,.05);
    }
    stop(){const c=A.ctx;this.g.gain.setTargetAtTime(0,c.currentTime,.1);setTimeout(()=>{try{this.o.stop();this.o2.stop();}catch(e){}this.g.disconnect();},600);}
  }
  let farS=null,farT=0,farAng=0;

  // ---- per-frame ----
  A.update=function(dt){
    const c=A.ctx;if(!c||c.state!=='running')return;
    listener();
    const tr=getTraffic(),now=c.currentTime;
    // traffic ambience follows how many cars are near the hero
    let near=0,movers=0;
    if(tr&&tr.vehicles)for(const v of tr.vehicles){const d=Math.hypot(v.x-P.pos.x,v.z-P.pos.z);if(d<70){near++;if(v.speed>2)movers++;}}
    amb.rumble.gain.setTargetAtTime(.04+.012*Math.min(10,near),now,.4);
    amb.hiss.gain.setTargetAtTime(.008+.004*Math.min(10,movers),now,.4);
    const air=P.fly?Math.min(1,(P.pos.y/160)+(P.speed||0)/90):Math.min(.25,P.pos.y/60);
    amb.wind.gain.setTargetAtTime(.02+.22*air,now,.3);amb.windF.frequency.setTargetAtTime(420+700*air+120*Math.sin(now*.37),now,.3);
    // sirens: the three nearest police cars that have theirs on
    if(tr&&tr.vehicles){
      const cars=tr.vehicles.filter(v=>v.cop&&v.sirenOn).map(v=>({v,d:Math.hypot(v.x-P.pos.x,v.z-P.pos.z)})).sort((a,b)=>a.d-b.d).slice(0,3);
      const live=new Set();
      for(const {v} of cars){live.add(v.id);let s=A.sirens.get(v.id);if(!s){s=new Siren();A.sirens.set(v.id,s);}s.update(v.x,v.z,dt);}
      for(const [id,s] of A.sirens)if(!live.has(id)){s.stop();A.sirens.delete(id);}
    }
    // occasional car horn from a nearby vehicle, and a far-off siren now and then
    horn-=dt;
    if(horn<=0){horn=30+Math.random()*35;if(tr&&tr.vehicles){const c2=tr.vehicles.filter(v=>!v.cop&&Math.hypot(v.x-P.pos.x,v.z-P.pos.z)<60);if(c2.length){const v=c2[Math.floor(Math.random()*c2.length)];A.horn({x:v.x,y:1.2,z:v.z},Math.random()<.1);}}}
    farSiren-=dt;
    if(farSiren<=0&&!farS){farS=new Siren();farT=7;farAng=Math.random()*6.28;farSiren=45+Math.random()*50;}
    if(farS){farT-=dt;farAng+=dt*.25;farS.update(P.pos.x+Math.cos(farAng)*230,P.pos.z+Math.sin(farAng)*230,dt,.7);if(farT<=0){farS.stop();farS=null;}}
  };
  A.debug=()=>({state:A.ctx&&A.ctx.state,voices:A.voices,sirens:A.sirens.size,muted:A.muted,rumble:amb.rumble&&amb.rumble.gain.value});
  return A;
}
