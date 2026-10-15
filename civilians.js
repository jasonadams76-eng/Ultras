// civilians.js — ambient pedestrians. Random outfits / skin tones / genders; they walk the sidewalks, cross at the lights,
// slide around trees and walls, and run from gunfire. Shots and blasts pass through them (they can't be hurt).
export function createCivilians(ctx){
  const {THREE,P,cam,NPCM,npcFigure,eject,getTraffic,count=15}=ctx;
  const N=14,C=i=>-260+40*i,LAT=8.6; // street centre lines (same grid as traffic.js); sidewalk lane = LAT metres from a street centre
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),R=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.floor(Math.random()*a.length)];
  const MEN=['men_Casual_2','men_Casual_Hoodie','men_Punk','men_Suit','men_Worker','men_Farmer','men_Beach'].filter(k=>NPCM[k]);
  const WOMEN=['women_Casual','women_Punk','women_Formal','women_Suit','women_Worker'].filter(k=>NPCM[k]);
  const SKINS=[0xf1d1b5,0xe5b690,0xd29b6c,0xc28555,0xa8693f,0x8a5232,0x6b3f26,0x4e2c1c]; // light … deep
  const HAIR_DARK=[0x0e0a08,0x1c130d,0x2b1b12,0x3a2417],HAIR_ANY=[0x0e0a08,0x2b1b12,0x5a3a22,0x8a5a2e,0xd8b45c,0x8a3a1e,0xb9b6b0,0x6a4a2a];
  const SKIN=/^Skin/,HAIR=/^(Hair|Eyebrows|Moustache)/,KEEP=/^(Eye|Earrings|Gold|Metal|Visor|Worker_|Swat)/;
  const col=(h,s,l)=>new THREE.Color().setHSL(h,s,l,THREE.SRGBColorSpace).getHex(THREE.SRGBColorSpace);

  function matNames(key){const set=new Set();NPCM[key].scene.traverse(o=>{if(o.isMesh||o.isSkinnedMesh)[].concat(o.material).forEach(m=>set.add(m.name));});return [...set];}
  function lookFor(key){ // random skin tone, hair colour and clothes colours
    const si=Math.floor(R(0,SKINS.length)),skin=SKINS[si],look={};
    const hair=si>=5&&Math.random()<.9?pick(HAIR_DARK):pick(HAIR_ANY);
    for(const n of matNames(key)){
      if(SKIN.test(n))look[n]=n==='Skin'?skin:new THREE.Color(skin).multiplyScalar(.82).getHex(THREE.SRGBColorSpace);
      else if(HAIR.test(n))look[n]=hair;
      else if(KEEP.test(n))continue;
      else if(/^(White|Black|Grey)$/.test(n)?Math.random()<.4:Math.random()<.9)look[n]=col(Math.random(),R(.3,.75),R(.22,.6));
    }
    return look;
  }

  // ---- sidewalk graph: nodes are the 4 sidewalk corners of each intersection {i,j,sx,sz} ----
  const nodePos=(n,lat)=>[C(n.i)+n.sx*lat,C(n.j)+n.sz*lat];
  const nodeKey=n=>n&&(n.i+','+n.j+','+n.sx+','+n.sz);
  function options(n){
    const o=[];
    const ni=n.i+n.sx,nj=n.j+n.sz;
    if(ni>=0&&ni<N)o.push({type:'walk',axis:'x',to:{i:ni,j:n.j,sx:-n.sx,sz:n.sz}});            // along the sidewalk beside the E-W street
    if(nj>=0&&nj<N)o.push({type:'walk',axis:'z',to:{i:n.i,j:nj,sx:n.sx,sz:-n.sz}});            // along the sidewalk beside the N-S street
    o.push({type:'cross',axis:'x',to:{i:n.i,j:n.j,sx:-n.sx,sz:n.sz}});                          // cross the N-S street (walking along x)
    o.push({type:'cross',axis:'z',to:{i:n.i,j:n.j,sx:n.sx,sz:-n.sz}});                          // cross the E-W street (walking along z)
    return o;
  }
  function nearestNode(x,z){
    const i=clamp(Math.round((x+260)/40),0,N-1),j=clamp(Math.round((z+260)/40),0,N-1);
    return {i,j,sx:x>=C(i)?1:-1,sz:z>=C(j)?1:-1};
  }
  function canCross(n,axis){ // cars on the street being crossed must be stopped (red)
    const tr=getTraffic();if(!tr||!tr.sig)return true;
    return tr.sig(n.i,n.j,axis==='x'?'z':'x',tr.T)===2;
  }

  const _v=new THREE.Vector3();
  const inView=(x,z)=>{_v.set(x,1.5,z).project(cam);return _v.z<1&&Math.abs(_v.x)<1.2&&Math.abs(_v.y)<1.2;};

  // ---- the people ----
  const list=[];
  const kinds=[];for(let k=0;k<count;k++)kinds.push(k%2?pick(WOMEN):pick(MEN));
  for(const key of kinds){
    if(!key)continue;
    const h=key.startsWith('women')?R(1.6,1.78):R(1.68,1.9);
    const f=npcFigure(key,h,null,lookFor(key));
    const c={g:f.g,anim:f.anim,mode:'walk',node:null,prev:null,edge:null,target:null,lat:LAT,pace:R(.85,1.15),wait:0,panic:0,alarm:null,stuck:0,lastX:0,lastZ:0,rot:0,key};
    f.g.visible=false;list.push(c);
  }

  function assignEdge(c){
    const opts=options(c.node).filter(o=>nodeKey(o.to)!==nodeKey(c.prev));
    const lastAxis=c.edge&&c.edge.axis;
    const w=opts.map(o=>o.axis===lastAxis?6:2); // mostly keep going straight
    let r=Math.random()*w.reduce((a,b)=>a+b,0),k=0;for(;k<opts.length-1;k++){r-=w[k];if(r<=0)break;}
    const e=opts[k];
    c.edge=e;c.target=nodePos(e.to,c.lat);c.wait=e.type==='cross'?22:-1; // crossings wait at the kerb for a red
  }
  function placeAt(c,node){
    c.node=node;c.prev=null;c.edge=null;c.lat=LAT+R(-.7,.5);c.mode='walk';c.panic=0;c.stuck=0;
    const p=nodePos(node,c.lat);c.g.position.set(p[0],0,p[1]);c.lastX=p[0];c.lastZ=p[1];
    assignEdge(c);c.g.visible=true;
  }
  function relocate(c,first){ // put this person on a sidewalk corner 40–110 m from the hero (out of view unless it's the initial fill)
    for(let k=0;k<40;k++){
      const n={i:Math.floor(R(0,N)),j:Math.floor(R(0,N)),sx:Math.random()<.5?1:-1,sz:Math.random()<.5?1:-1};
      const p=nodePos(n,LAT),d=Math.hypot(p[0]-P.pos.x,p[1]-P.pos.z);
      if(d<(first?25:45)||d>110)continue;
      if(!first&&inView(p[0],p[1]))continue;
      if(list.some(o=>o!==c&&o.g.visible&&Math.hypot(o.g.position.x-p[0],o.g.position.z-p[1])<6))continue;
      placeAt(c,n);return true;
    }
    return false;
  }
  let spawnT=0,booted=false;

  function alarm(pos,radius=45){ // a shot was fired here: everyone close enough runs away
    for(const c of list){
      if(!c.g.visible)continue;
      if(Math.hypot(c.g.position.x-pos.x,c.g.position.z-pos.z)<radius){
        c.panic=8;c.alarm=[pos.x,pos.z];
        if(c.mode!=='flee'){c.mode='flee';c.edge=null;}
      }
    }
  }

  function update(dt){
    if(!booted){booted=true;for(const c of list)relocate(c,true);}
    spawnT-=dt;
    for(const c of list){
      const A=c.anim,p=c.g.position;
      if(!c.g.visible){if(spawnT<=0){spawnT=.4;relocate(c,false);}continue;}
      // far from the hero: reuse this person somewhere new
      const dh=Math.hypot(p.x-P.pos.x,p.z-P.pos.z);
      if(dh>130&&spawnT<=0){spawnT=.4;if(relocate(c,false))continue;}
      let state='Idle',speed=0,dx=0,dz=0;
      if(c.mode==='flee'){
        c.panic-=dt;
        const ax=p.x-c.alarm[0],az=p.z-c.alarm[1],d=Math.hypot(ax,az)||1;
        const wob=Math.sin(performance.now()/700+c.pace*10)*.35;
        dx=(ax/d)*Math.cos(wob)-(az/d)*Math.sin(wob);dz=(ax/d)*Math.sin(wob)+(az/d)*Math.cos(wob);
        speed=5.2*c.pace;state='Run';
        if(c.panic<=0){ // calm down: head for the nearest sidewalk corner and carry on walking
          c.mode='walk';const n=nearestNode(p.x,p.z);c.node=n;c.prev=null;c.edge={type:'walk',axis:null,to:n};c.target=nodePos(n,c.lat);c.wait=-1;
        }
      }else{
        const tx=c.target[0]-p.x,tz=c.target[1]-p.z,d=Math.hypot(tx,tz);
        let waiting=false;
        if(c.edge.type==='cross'&&c.wait>0){ // standing at the kerb until the cross traffic is stopped
          if(canCross(c.node,c.edge.axis))c.wait=-1;
          else if((c.wait-=dt)<=0){c.wait=-1;assignEdge(c);}   // waited long enough: go another way
          else waiting=true;
        }
        if(!waiting){
          if(d<.5){c.prev=c.node;c.node=c.edge.to;assignEdge(c);}
          else{dx=tx/d;dz=tz/d;speed=1.45*c.pace;state='Walk';}
        }
        // not getting anywhere for a couple of seconds (a tree or pole in the way)? pick another lane and route
        c.stuck+=dt;
        if(c.stuck>=2){
          if(state==='Walk'&&Math.hypot(p.x-c.lastX,p.z-c.lastZ)<.8){c.lat=LAT+R(-.9,.6);c.prev=null;assignEdge(c);}
          c.stuck=0;c.lastX=p.x;c.lastZ=p.z;
        }
      }
      if(speed>0){
        p.x+=dx*speed*dt;p.z+=dz*speed*dt;
        let a=Math.atan2(dx,dz)-c.rot;a=Math.atan2(Math.sin(a),Math.cos(a));c.rot+=a*Math.min(1,dt*8);c.g.rotation.y=c.rot;
      }
      // keep clear of vehicles (oriented boxes) and of each other / the hero
      const tr2=getTraffic();
      if(tr2&&tr2.vehicles)for(const v of tr2.vehicles){
        const ddx=p.x-v.x,ddz=p.z-v.z;if(ddx*ddx+ddz*ddz>100)continue;
        const f=ddx*v.hx+ddz*v.hz,l=-ddx*v.hz+ddz*v.hx,hl=v.len/2+.5,hw=v.wid/2+.5;
        if(Math.abs(f)<hl&&Math.abs(l)<hw){ // inside: push out the nearest side
          if(hl-Math.abs(f)<hw-Math.abs(l)){const d=(Math.sign(f||1)*hl-f);p.x+=v.hx*d;p.z+=v.hz*d;}
          else{const d=(Math.sign(l||1)*hw-l);p.x+=-v.hz*d;p.z+=v.hx*d;}
        }else if(speed>0&&state==='Walk'&&v.speed>1.5){ // a moving car close ahead: hold still until it has passed
          const gx=v.x-p.x,gz=v.z-p.z;if(gx*gx+gz*gz<20&&(gx*dx+gz*dz)>0){p.x-=dx*speed*dt;p.z-=dz*speed*dt;state='Idle';}
        }
      }
      for(const o of list){
        if(o===c||!o.g.visible)continue;
        const sx=p.x-o.g.position.x,sz=p.z-o.g.position.z,sd=Math.hypot(sx,sz);
        if(sd<.8){const push=(.8-sd)*.5,nx=sd>.01?sx/sd:Math.random()-.5,nz=sd>.01?sz/sd:Math.random()-.5;p.x+=nx*push;p.z+=nz*push;o.g.position.x-=nx*push;o.g.position.z-=nz*push;}
      }
      {const sx=p.x-P.pos.x,sz=p.z-P.pos.z,sd=Math.hypot(sx,sz);if(sd<.9&&sd>.001){p.x+=sx/sd*(.9-sd);p.z+=sz/sd*(.9-sd);}}
      eject(p,.38);
      if(A){A.play(state,{fade:.2});A.update(dt);}
    }
  }
  const peds=()=>list.filter(c=>c.g.visible).map(c=>({x:c.g.position.x,z:c.g.position.z,r:.42}));
  return {update,alarm,peds,list,count:()=>list.filter(c=>c.g.visible).length};
}
