// traffic.js — ambient traffic (cars from two Quaternius packs), traffic lights, and police response.
// Streets form a 14x14 grid of lanes (lane centres C(i) = -260 + 40*i). Vehicles drive on the right, obey signals,
// take turns through intersections on bezier paths, stop for anything in their way and resume when it clears.
export function createTraffic(ctx){
  const {THREE,scene,OBJLoader,MTLLoader,A,P,E,B,msg,R,npcFigure,label,cam}=ctx;
  const N=14, C=i=>-260+40*i, LANE=3.5, BOX=7, TARGET=30;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const Y=new THREE.Vector3(0,1,0);
  const solids=[]; // signal poles: solid cylinders {x,z,r,h} for the hero and NPCs

  // ---------------------------------------------------------------- vehicle models
  // front: which obj-space axis the vehicle faces (pack-1 cars are +z; transport pack checked by eye). len = target length (m)
  const DEFS=[
    {k:'NormalCar1',pack:'cars',len:4.2,w:3,body:['Blue']},
    {k:'NormalCar2',pack:'cars',len:3.6,w:3,body:['LightBlue']},
    {k:'SUV',pack:'cars',len:4.4,w:2,body:['White']},
    {k:'SportsCar',pack:'cars',len:4.0,w:2,body:['Orange','DarkOrange']},
    {k:'SportsCar2',pack:'cars',len:4.0,w:2,body:['White']},
    {k:'Taxi',pack:'cars',len:4.2,w:1,body:null},
    {k:'Cop',pack:'cars',len:4.0,w:0,body:null,cop:true},
    {k:'Bus',pack:'transport',len:8.4,w:1.5,body:null,front:'-x'},
    {k:'SchoolBus',pack:'transport',len:7.6,w:1,body:null,front:'-x'},
    {k:'Ambulance',pack:'transport',len:5.4,w:1,body:null,front:'+z'},
  ];
  const COLORS={ // the transport pack's OBJ/FBX lost its colours, so they are assigned per material name
    Bus:{Top:'#3f7fd0',Bottom:'#1f3f7a',Windows:'#9fe0f0',Bumper:'#30363c',Details:'#2a2d33',Lights:'#fff1b0',Material:'#2c3e5a'},
    SchoolBus:{Yellow:'#f2c230',Windows:'#8fe4f2',Bumper:'#2d2f33',Details:'#1d1f23',Lights:'#fff1b0',Wheel:'#25272b'},
    Ambulance:{White:'#f2f2f2',Red:'#d23b3b',Windows:'#4a90e2',Bumper:'#3a3d42',Lights:'#fff1b0',Grey:'#8b9096',Material:'#f2f2f2'},
  };
  const PALETTE=[0xc0392b,0x2e86c1,0x27ae60,0x8e44ad,0xecf0f1,0x2c3e50,0x7f8c8d,0xe67e22,0x16a085,0xb03a6a,0x34495e,0xd4ac0d];
  const models={};
  const keyOf=d=>d.id||d.k;

  function centroid(obj,re){ // centroid of vertices whose material name matches re (obj space)
    const v=new THREE.Vector3(),sum=new THREE.Vector3();let n=0;
    obj.traverse(o=>{if(!o.isMesh)return;const mats=[].concat(o.material),g=o.geometry,pos=g.attributes.position,idx=g.index;
      for(const gr of g.groups){const m=mats[gr.materialIndex];if(!m||!re.test(m.name))continue;
        for(let i=gr.start;i<gr.start+gr.count;i++){const vi=idx?idx.getX(i):i;v.fromBufferAttribute(pos,vi);sum.add(v);n++;}}});
    return n?sum.multiplyScalar(1/n):null;
  }

  async function loadModel(d){
    const dir=A+(d.pack==='cars'?'cars/':'transport/');
    const mats=await new MTLLoader().setPath(dir).loadAsync(d.k+'.mtl');mats.preload();
    const obj=await new OBJLoader().setMaterials(mats).setPath(dir).loadAsync(d.k+'.obj');
    const table=COLORS[d.k];
    let tex=null;if(d.tex){tex=new THREE.TextureLoader().load(dir+d.tex);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;}
    obj.traverse(o=>{if(!o.isMesh)return;
      o.material=[].concat(o.material).map(m=>{const c=new THREE.MeshStandardMaterial({color:m.color.clone(),name:m.name,roughness:.55,metalness:.15});
        if(d.pack==='cars')c.color.convertLinearToSRGB();          // .mtl Kd values are linear (Blender); the loader assumed sRGB
        if(table&&table[m.name])c.color.set(table[m.name]);
        if(tex){c.map=tex;c.color.set(0xffffff);}
        if(/window/i.test(m.name)){c.roughness=.2;c.metalness=0;}
        if(/headlight|^lights$/i.test(m.name)){c.emissive=new THREE.Color(0xffe9a0);c.emissiveIntensity=.7;}
        if(/taillight/i.test(m.name)){c.emissive=new THREE.Color(0xff2020);c.emissiveIntensity=.8;}
        return c;});
      if(o.material.length===1)o.material=o.material[0];});
    // orientation: find the obj-space direction of the front
    obj.updateMatrixWorld(true);
    const bb0=new THREE.Box3().setFromObject(obj),size0=bb0.getSize(new THREE.Vector3()),cen0=bb0.getCenter(new THREE.Vector3());
    let front=d.front;
    if(!front){const hc=centroid(obj,/headlight/i);front=hc?(hc.z>cen0.z?'+z':'-z'):'+z';}
    const theta={'+z':0,'-z':Math.PI,'+x':-Math.PI/2,'-x':Math.PI/2}[front];
    const fix=new THREE.Group();fix.add(obj);fix.rotation.y=theta;
    const longSize=front.endsWith('x')?size0.x:size0.z;
    fix.scale.setScalar(d.len/longSize);
    const veh=new THREE.Group();veh.add(fix);veh.updateMatrixWorld(true);
    const bb=new THREE.Box3().setFromObject(veh),c=bb.getCenter(new THREE.Vector3());
    fix.position.set(-c.x,-bb.min.y,-c.z);veh.updateMatrixWorld(true);
    const bb2=new THREE.Box3().setFromObject(veh),sz=bb2.getSize(new THREE.Vector3());
    // wheels: wrap each wheel mesh in steer->spin groups pivoting at its own centre
    const axle=new THREE.Vector3(1,0,0).applyAxisAngle(Y,-theta); // lateral axis expressed in obj space
    const wheels=[];
    obj.children.slice().forEach(m=>{
      if(!m.isMesh||!/wheel/i.test(m.name))return;
      m.geometry.computeBoundingBox();const wc=m.geometry.boundingBox.getCenter(new THREE.Vector3());
      const steer=new THREE.Group(),spin=new THREE.Group();steer.position.copy(wc);m.position.sub(wc);
      obj.add(steer);steer.add(spin);spin.add(m);steer.name='W_steer';spin.name='W_spin';
      steer.userData.front=/front/i.test(m.name)&&!/wheels/i.test(m.name); // separate left/right fronts can steer
      steer.userData.r=Math.max(.1,(m.geometry.boundingBox.max.y-m.geometry.boundingBox.min.y)/2*fix.scale.x);
      wheels.push(steer);
    });
    models[keyOf(d)]={d,veh,axle,len:d.len,wid:Math.min(sz.x,sz.z),height:sz.y,nWheels:wheels.length};
  }
  const ready=Promise.all(DEFS.map(d=>loadModel(d).catch(e=>console.warn('vehicle',d.k,e))));

  // ---------------------------------------------------------------- traffic signals (instanced)
  const CYC=35;
  function sig(i,j,axis,T){ // 0 green, 1 yellow, 2 red for traffic travelling along `axis`
    const ph=(T+((i*7+j*13)%CYC))%CYC;
    if(axis==='z')return ph<14?0:ph<16.5?1:2;
    return (ph>=17.5&&ph<31.5)?0:(ph>=31.5&&ph<34)?1:2;
  }
  const APP=[['z',1],['z',-1],['x',1],['x',-1]];
  const lights=(()=>{
    const NI=N*N,dm=new THREE.Object3D();
    const poles=new THREE.InstancedMesh(new THREE.BoxGeometry(.22,5,.22),new THREE.MeshStandardMaterial({color:0x3a3d42}),NI*4);
    const heads=new THREE.InstancedMesh(new THREE.BoxGeometry(.52,1.35,.42),new THREE.MeshStandardMaterial({color:0x17191c}),NI*4);
    const lamps=new THREE.InstancedMesh(new THREE.SphereGeometry(.17,8,6),new THREE.MeshBasicMaterial({color:0xffffff}),NI*12);
    for(const m of [poles,heads,lamps])m.frustumCulled=false;
    let n=0;
    for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<4;k++,n++){
      const cx=C(i),cz=C(j),[ax,sg]=APP[k],d=8.4;
      let px,pz,fx,fz; // pole at the driver's near-right corner, lamp face towards the approaching driver
      if(ax==='z'&&sg>0){px=cx-d;pz=cz-d;fx=0;fz=-1;} else if(ax==='z'){px=cx+d;pz=cz+d;fx=0;fz=1;}
      else if(sg>0){px=cx-d;pz=cz+d;fx=-1;fz=0;} else {px=cx+d;pz=cz-d;fx=1;fz=0;}
      solids.push({x:px,z:pz,r:.35,h:5});
      dm.rotation.set(0,0,0);dm.position.set(px,2.5,pz);dm.updateMatrix();poles.setMatrixAt(n,dm.matrix);
      dm.rotation.set(0,Math.atan2(fx,fz),0);dm.position.set(px+fx*.15,4.3,pz+fz*.15);dm.updateMatrix();heads.setMatrixAt(n,dm.matrix);
      for(let c=0;c<3;c++){dm.position.set(px+fx*.4,4.7-c*.4,pz+fz*.4);dm.rotation.set(0,0,0);dm.updateMatrix();lamps.setMatrixAt(n*3+c,dm.matrix);lamps.setColorAt(n*3+c,new THREE.Color(0x202020));}
    }
    scene.add(poles,heads,lamps);
    return {lamps,last:new Int8Array(NI*4).fill(-1)};
  })();
  const LAMP_ON=[new THREE.Color(0x30ff60),new THREE.Color(0xffc21a),new THREE.Color(0xff2a2a)],LAMP_OFF=new THREE.Color(0x242424);
  const tmpC=new THREE.Color();
  function updateLamps(T){
    let dirty=false;
    for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<4;k++){
      const n=(i*N+j)*4+k,s=sig(i,j,APP[k][0],T);
      if(lights.last[n]===s)continue;lights.last[n]=s;dirty=true;
      // lamp 0 = top (red), 1 = amber, 2 = green
      lights.lamps.setColorAt(n*3,s===2?LAMP_ON[2]:LAMP_OFF);lights.lamps.setColorAt(n*3+1,s===1?LAMP_ON[1]:LAMP_OFF);lights.lamps.setColorAt(n*3+2,s===0?LAMP_ON[0]:LAMP_OFF);
    }
    if(dirty)lights.lamps.instanceColor.needsUpdate=true;
  }

  // ---------------------------------------------------------------- lane geometry helpers
  const off=(axis,sgn)=>axis==='z'?-sgn*LANE:sgn*LANE;
  const lanePt=(axis,sgn,line,t)=>axis==='z'?[C(line)+off(axis,sgn),t]:[t,C(line)+off(axis,sgn)];
  const boxes=new Map(); // intersection key -> Set of vehicles holding a claim
  const boxKey=(axis,line,nextN)=>axis==='z'?line*N+nextN:nextN*N+line;
  const getBox=k=>{let b=boxes.get(k);if(!b){b=new Set();boxes.set(k,b);}return b;};
  const vehicles=[];
  const total=()=>vehicles.length;

  function exitsFor(v){ // possible exits at the intersection ahead: [{turn,axis,sgn,line,nextN}]
    const i=v.axis==='z'?v.line:v.nextN,j=v.axis==='z'?v.nextN:v.line,out=[],s=v.sgn;
    const ok=n=>n>=0&&n<N;
    // straight
    if(ok(v.nextN+s))out.push({turn:'S',axis:v.axis,sgn:s,line:v.line,nextN:v.nextN+s});
    // right/left: new axis, new sign; the new street is the one running through the intersection along the other axis
    const r=v.axis==='z'?{axis:'x',sgn:-s}:{axis:'z',sgn:s}, l=v.axis==='z'?{axis:'x',sgn:s}:{axis:'z',sgn:-s};
    for(const [t,o] of [['R',r],['L',l]]){
      const line=o.axis==='x'?j:i, from=o.axis==='x'?i:j, nn=from+o.sgn;
      if(ok(nn))out.push({turn:t,axis:o.axis,sgn:o.sgn,line,nextN:nn});
    }
    return out;
  }
  function choosePlan(v){
    const ex=exitsFor(v);if(!ex.length){return null;}
    if(v.route){ // cop: head for the target node
      const [ti,tj]=v.route;let best=null,bs=1e9;
      for(const e of ex){const ni=e.axis==='z'?e.line:e.nextN,nj=e.axis==='z'?e.nextN:e.line;const s=Math.abs(ni-ti)+Math.abs(nj-tj)+Math.random()*.1;if(s<bs){bs=s;best=e;}}
      return best;
    }
    const wsum=ex.reduce((a,e)=>a+(e.turn==='S'?6:2),0);let r=Math.random()*wsum;
    for(const e of ex){r-=(e.turn==='S'?6:2);if(r<=0)return e;}
    return ex[0];
  }
  function exitPath(v,plan){
    const i=v.axis==='z'?v.line:v.nextN,j=v.axis==='z'?v.nextN:v.line;
    const cn=C(v.nextN);
    const p0=lanePt(v.axis,v.sgn,v.line,cn-v.sgn*BOX);
    let p1,p2;
    if(plan.turn==='S'){p2=lanePt(plan.axis,plan.sgn,plan.line,cn+v.sgn*BOX);p1=[(p0[0]+p2[0])/2,(p0[1]+p2[1])/2];}
    else{
      const t0=(plan.axis==='x'?C(i):C(j))+plan.sgn*BOX;
      p2=lanePt(plan.axis,plan.sgn,plan.line,t0);
      p1=v.axis==='z'?[C(i)-v.sgn*LANE,C(j)+plan.sgn*LANE]:[C(i)-plan.sgn*LANE,C(j)+v.sgn*LANE];
    }
    const len=plan.turn==='S'?Math.hypot(p2[0]-p0[0],p2[1]-p0[1]):(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])+Math.hypot(p2[0]-p1[0],p2[1]-p1[1]))*.92;
    return {p0,p1,p2,len};
  }
  const bez=(p,u)=>{const a=(1-u)*(1-u),b=2*(1-u)*u,c=u*u;return [a*p.p0[0]+b*p.p1[0]+c*p.p2[0],a*p.p0[1]+b*p.p1[1]+c*p.p2[1]];};
  const bezT=(p,u)=>{const dx=2*(1-u)*(p.p1[0]-p.p0[0])+2*u*(p.p2[0]-p.p1[0]),dz=2*(1-u)*(p.p1[1]-p.p0[1])+2*u*(p.p2[1]-p.p1[1]);const l=Math.hypot(dx,dz)||1;return [dx/l,dz/l];};

  // ---------------------------------------------------------------- spawning
  let seq=0;
  function pickDef(){const cands=DEFS.filter(d=>d.w>0&&models[keyOf(d)]);let sum=cands.reduce((a,d)=>a+d.w,0),r=Math.random()*sum;for(const d of cands){r-=d.w;if(r<=0)return d;}return cands[0];}
  function makeVisual(d,forceCop){
    const m=models[keyOf(d)];if(!m)return null;
    const g=m.veh.clone(true);
    const wheels=[];let bodyMats=null;
    g.traverse(o=>{if(o.name==='W_steer')wheels.push({steer:o,spin:o.children[0],front:o.userData.front,r:o.userData.r});});
    // per-vehicle paint
    const paint=d.body?PALETTE[Math.floor(Math.random()*PALETTE.length)]:null;
    const cops=[];
    g.traverse(o=>{if(!o.isMesh)return;
      const own=[].concat(o.material).map(mm=>{
        if(paint!==null&&d.body.includes(mm.name)){const c=mm.clone();c.color.setHex(paint);if(mm.name==='DarkOrange')c.color.multiplyScalar(.7);return c;}
        if(d.cop&&/BlueLights|WhiteLights/.test(mm.name)){const c=mm.clone();c.emissive=new THREE.Color(0x0000ff);c.emissiveIntensity=1.2;cops.push({c,kind:mm.name});return c;}
        return mm;});
      o.material=own.length===1?own[0]:own;});
    scene.add(g);
    return {g,wheels,cops,model:m};
  }
  function addVehicle(d,axis,sgn,line,t,opts={}){
    const vis=makeVisual(d,opts.cop);if(!vis)return null;
    const m=vis.model;
    const nextN=sgn>0?Math.min(N-1,Math.max(0,Math.ceil((t+260+8+m.len/2)/40-1e-6))):Math.max(0,Math.min(N-1,Math.floor((t+260-8-m.len/2)/40+1e-6)));
    const v={id:++seq,def:d,...vis,len:m.len,wid:m.wid,height:m.height,axis,sgn,line,t,nextN,mode:'lane',speed:opts.speed??R(5,9),cruise:R(9,13),
      x:0,z:0,hx:0,hz:1,plan:null,claimed:null,path:null,u:0,stuck:0,ghost:0,age:0,cop:!!opts.cop,route:opts.route||null,parked:false,steerAng:0,siren:0};
    if(v.cop)v.cruise=17;
    if(m.d.k==='Bus'||m.d.k==='SchoolBus')v.cruise*=.8;
    placeLane(v);syncVisual(v,0);vehicles.push(v);return v; // position it now, or it is drawn at the world origin for a frame
  }
  function placeLane(v){
    const p=lanePt(v.axis,v.sgn,v.line,v.t);v.x=p[0];v.z=p[1];
    v.hx=v.axis==='x'?v.sgn:0;v.hz=v.axis==='z'?v.sgn:0;
  }
  const _v=new THREE.Vector3();
  function inView(x,z){ // is this ground point (roughly) on screen right now?
    _v.set(x,1.5,z).project(cam);return _v.z<1&&Math.abs(_v.x)<1.15&&Math.abs(_v.y)<1.15;
  }
  function trySpawn(){
    const d=pickDef();if(!d)return false;
    for(let k=0;k<25;k++){
      const axis=Math.random()<.5?'z':'x',sgn=Math.random()<.5?1:-1,line=Math.floor(R(0,N)),t=R(-250,250);
      const p=lanePt(axis,sgn,line,t);
      const dist=Math.hypot(p[0]-P.pos.x,p[1]-P.pos.z);
      if(dist<50||dist>125||(dist<100&&inView(p[0],p[1])))continue;
      // not inside an intersection box, not on top of another vehicle
      const along=((t+260)%40+40)%40; if(along<9.5||along>30.5-0)continue;
      if(vehicles.some(o=>Math.hypot(o.x-p[0],o.z-p[1])<14))continue;
      return !!addVehicle(d,axis,sgn,line,t);
    }
    return false;
  }

  // ---------------------------------------------------------------- obstacles / pedestrians
  function pedestrians(){
    const out=[];
    if(P.pos.y<2.6)out.push({x:P.pos.x,z:P.pos.z,r:.55});
    for(const e of E)if(e.alive&&e.g.visible)out.push({x:e.g.position.x,z:e.g.position.z,r:.5});
    for(const o of police.officers)if(o.alive)out.push({x:o.g.position.x,z:o.g.position.z,r:.5});
    if(ctx.extraPeds)for(const q of ctx.extraPeds())out.push(q); // civilians
    return out;
  }
  function gapAhead(v,peds){ // distance from v's bumper to the nearest obstacle in its path, or Infinity
    let best=Infinity;const hx=v.hx,hz=v.hz,rx=-hz,rz=hx; // right-hand perpendicular irrelevant for |l|
    const look=v.len/2+3+v.speed*1.1;
    for(const o of vehicles){
      if(o===v||(v.ghost>0))continue;
      const dx=o.x-v.x,dz=o.z-v.z,f=dx*hx+dz*hz;if(f<=0)continue;
      const cp=Math.abs(o.hx*hx+o.hz*hz),sp=Math.sqrt(Math.max(0,1-cp*cp));        // relative heading -> extent of the other vehicle
      const fExt=o.len/2*cp+o.wid/2*sp,lExt=o.wid/2*cp+o.len/2*sp;
      if(Math.abs(dx*rx+dz*rz)-lExt>v.wid/2*.9+.15)continue;
      const g=f-v.len/2-fExt;if(g<look&&g<best)best=g;
    }
    for(const p of peds){
      const dx=p.x-v.x,dz=p.z-v.z,f=dx*hx+dz*hz;if(f<=0||f>look)continue;
      const l=Math.abs(dx*rx+dz*rz);if(l>v.wid/2+p.r+.5)continue;
      const g=f-v.len/2-p.r;if(g<best)best=g;
    }
    return best;
  }

  // ---------------------------------------------------------------- per-vehicle update
  const DEC=8,ACC=4;
  let T=0;
  function conflict(box,v,plan){
    for(const o of box){if(o===v)continue;
      if(o.axis===v.axis&&o.sgn===v.sgn)continue;                  // same direction: follow the leader
      if(o.axis===v.axis&&plan.turn!=='L'&&(!o.plan||o.plan.turn!=='L'))continue; // oncoming straight/right turns do not cross
      return true;}
    return false;
  }
  function exitClear(v,plan){
    const i=v.axis==='z'?v.line:v.nextN,j=v.axis==='z'?v.nextN:v.line;
    const t0=plan.turn==='S'?C(v.nextN)+v.sgn*BOX:(plan.axis==='x'?C(i):C(j))+plan.sgn*BOX;
    for(const o of vehicles){if(o===v)continue;
      if(o.mode==='lane'&&o.axis===plan.axis&&o.sgn===plan.sgn&&o.line===plan.line){
        const ahead=(o.t-t0)*plan.sgn; if(ahead>-2&&ahead<v.len+o.len/2+4)return false;}
    }
    return true;
  }
  function updateVehicle(v,dt,peds){
    v.age+=dt;
    if(v.parked){v.speed=0;return;}
    let limit=v.mode==='box'?(v.plan&&v.plan.turn!=='S'?5.5:9):v.cruise;
    const g=gapAhead(v,peds);
    if(g<Infinity)limit=Math.min(limit,Math.sqrt(2*DEC*Math.max(0,g-1.6))*.95);
    if(v.mode==='lane'){
      const cn=C(v.nextN),stopT=cn-v.sgn*(BOX+.9+v.len/2),dist=(stopT-v.t)*v.sgn;
      const edgeDist=(cn-v.sgn*BOX-v.t)*v.sgn;
      if(!v.plan&&dist<45)v.plan=choosePlan(v)||{turn:'S',axis:v.axis,sgn:-v.sgn,line:v.line,nextN:v.nextN-v.sgn,uturn:true};
      const key=boxKey(v.axis,v.line,v.nextN),box=getBox(key);
      if(v.plan&&v.plan.uturn){ // dead end: should not happen on a closed grid; turn around in place
        v.sgn=-v.sgn;v.nextN=Math.max(0,Math.min(N-1,v.nextN+v.sgn));v.plan=null;placeLane(v);return;}
      if(!v.claimed&&dist<16&&v.plan){
        const state=v.cop?0:sig(v.axis==='z'?v.line:v.nextN,v.axis==='z'?v.nextN:v.line,v.axis,T);
        const brake=v.speed*v.speed/(2*5)+1;
        const sigOk=state===0||(state===1&&dist<brake)||(dist<-.6);
        const free=!conflict(box,v,v.plan)&&exitClear(v,v.plan);
        if((sigOk&&free)||v.stuck>50){v.claimed=box;box.add(v);}
      }
      if(!v.claimed&&v.plan)limit=Math.min(limit,Math.sqrt(2*DEC*Math.max(0,dist)));
      // cop cars park at the stop line of their target node
      if(v.cop&&v.route&&v.plan){const i=v.axis==='z'?v.line:v.nextN,j=v.axis==='z'?v.nextN:v.line;
        if(i===v.route[0]&&j===v.route[1]){limit=Math.min(limit,Math.sqrt(2*DEC*Math.max(0,dist)));
          if(dist<.7&&v.speed<1.2){v.parked=true;v.speed=0;return;}}}
      // speed control
      if(v.speed<limit)v.speed=Math.min(limit,v.speed+ACC*dt);else v.speed=Math.max(limit,v.speed-DEC*1.4*dt);
      v.t+=v.sgn*v.speed*dt;placeLane(v);
      if((cn-v.sgn*BOX-v.t)*v.sgn<=0){ // reached the box edge: commit to the path
        if(!v.claimed){v.claimed=box;box.add(v);}
        v.path=exitPath(v,v.plan);v.u=0;v.mode='box';
      }
    }else{ // inside the intersection, following the bezier path
      if(v.speed<limit)v.speed=Math.min(limit,v.speed+ACC*dt);else v.speed=Math.max(limit,v.speed-DEC*1.4*dt);
      v.u+=v.speed*dt/Math.max(1,v.path.len);
      if(v.u>=1){
        const pl=v.plan;
        if(v.claimed){v.claimed.delete(v);v.claimed=null;}
        v.axis=pl.axis;v.sgn=pl.sgn;v.line=pl.line;v.nextN=pl.nextN;
        const i=v.axis==='z'?v.line:v.nextN; // exit start coordinate along the new axis
        v.t=(v.path.p2[v.axis==='x'?0:1]);v.plan=null;v.path=null;v.mode='lane';v.u=0;placeLane(v);
      }else{const p=bez(v.path,v.u),tg=bezT(v.path,v.u);const prev=Math.atan2(v.hx,v.hz);v.x=p[0];v.z=p[1];v.hx=tg[0];v.hz=tg[1];
        let da=Math.atan2(v.hx,v.hz)-prev;da=Math.atan2(Math.sin(da),Math.cos(da));v.steerAng=clamp(da/Math.max(dt,1e-3)*.25,-.6,.6);}
    }
    // gridlock breaker: a vehicle stopped for a long time ignores other vehicles for a while
    if(v.speed<.2&&!v.parked){v.stuck+=dt;if(v.stuck>45&&v.ghost<=0){v.ghost=7;}}else v.stuck=Math.max(0,v.stuck-dt*2);
    if(v.ghost>0)v.ghost-=dt;
  }
  function syncVisual(v,dt){
    const g=v.g;g.position.set(v.x,0,v.z);g.rotation.y=Math.atan2(v.hx,v.hz);
    const ax=v.model.axle,spinA=v.speed*dt;
    for(const w of v.wheels){
      w.spin.rotateOnAxis(ax,spinA/Math.max(.1,w.r));
      if(w.front)w.steer.rotation.y=v.mode==='box'?v.steerAng:0;
    }
    if(v.cop&&v.cops.length){v.siren+=dt;const ph=Math.floor(v.siren*5)%2;for(const c of v.cops){
      const blue=c.kind==='BlueLights';c.c.emissive.setHex(v.sirenOn?((blue?ph===0:ph===1)?(ph===0?0x2222ff:0xff2222):0x000000):0x000000);}}
  }
  function removeVehicle(v){
    if(v.claimed){v.claimed.delete(v);}
    scene.remove(v.g);
    const i=vehicles.indexOf(v);if(i>=0)vehicles.splice(i,1);
  }

  // ---------------------------------------------------------------- hero vs. vehicles (solid body, roof is standable)
  function collidePlayer(pos,gy){
    let ground=gy;
    for(const v of vehicles){
      const dx=pos.x-v.x,dz=pos.z-v.z;if(dx*dx+dz*dz>64)continue;
      const f=dx*v.hx+dz*v.hz,l=dx*(-v.hz)+dz*v.hx,hl=v.len/2+.35,hw=v.wid/2+.35;
      if(Math.abs(f)<hl&&Math.abs(l)<hw){
        if(pos.y>=v.height-.5){ground=Math.max(ground,v.height);}
        else{ // push out along the shallower axis
          const pf=hl-Math.abs(f),pl=hw-Math.abs(l);
          if(pf<pl){const s=Math.sign(f||1)*pf;pos.x+=v.hx*s;pos.z+=v.hz*s;}
          else{const s=Math.sign(l||1)*pl;pos.x+=-v.hz*s;pos.z+=v.hx*s;}
        }
      }
    }
    return ground;
  }

  // ---------------------------------------------------------------- police response
  const police={officers:[],resp:null,cool:0,down:0,arrests:0};
  const COPTINT=new THREE.Color(0x5577dd);
  function makeOfficer(pos){
    const gun=['Pistol_1','Pistol_3','Pistol_4'][Math.floor(Math.random()*3)];
    const f=npcFigure('men_Suit',1.8,gun);
    f.g.traverse(o=>{if(o.isMesh||o.isSkinnedMesh){o.material=[].concat(o.material).map(m=>{const c=m.clone();if(c.color)c.color.multiply(COPTINT);return c;});if(o.material.length===1)o.material=o.material[0];}});
    f.g.add(label('Police',2.35));
    f.g.position.copy(pos);
    const o={g:f.g,anim:f.anim,gun:f.gun,hp:80,alive:true,hideAt:0,cd:R(.3,1),state:'engage',car:null,tgt:null,shot:-1};
    police.officers.push(o);return o;
  }
  const tracers=[];
  const trGeo=new THREE.CylinderGeometry(.025,.025,1,5),trMat=new THREE.MeshBasicMaterial({color:0xaee0ff});
  function tracer(a,b){const m=new THREE.Mesh(trGeo,trMat);const d=b.clone().sub(a),len=d.length();m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(1,len,1);m.quaternion.setFromUnitVectors(Y,d.normalize());scene.add(m);tracers.push({m,life:.08});}
  function dispatch(pos){
    const ti=clamp(Math.round((pos.x+260)/40),0,N-1),tj=clamp(Math.round((pos.z+260)/40),0,N-1);
    const cars=[],cop=DEFS.find(d=>d.k==='Cop');if(!models.Cop)return;
    for(let n=0;n<2;n++){
      for(let k=0;k<60;k++){
        const axis=Math.random()<.5?'z':'x',sgn=Math.random()<.5?1:-1,line=Math.floor(R(0,N)),t=R(-250,250);
        const p=lanePt(axis,sgn,line,t);
        const along=((t+260)%40+40)%40;if(along<9.5||along>30.5)continue;
        const dS=Math.hypot(p[0]-pos.x,p[1]-pos.z),dH=Math.hypot(p[0]-P.pos.x,p[1]-P.pos.z);
        if(dS<70||dS>170||dH<45||inView(p[0],p[1]))continue;
        if(vehicles.some(o=>Math.hypot(o.x-p[0],o.z-p[1])<12))continue;
        const v=addVehicle(cop,axis,sgn,line,t,{cop:true,route:[ti,tj],speed:8});
        if(v){v.sirenOn=true;v.keep=true;cars.push(v);break;}
      }
    }
    if(!cars.length)return;
    police.resp={pos:pos.clone(),cars,age:0,clear:0,deployed:false,recall:false,recallT:0};
    msg('Police are responding to gunfire! Disable the shooters before the officers get hurt.',5500);
  }
  function alert(pos){
    if(police.resp||police.cool>0)return;
    dispatch(pos);
  }
  function updatePolice(dt,now){
    if(police.cool>0)police.cool-=dt;
    police.chk=(police.chk||0)-dt;
    if(!police.resp&&police.cool<=0&&police.chk<=0){police.chk=2;const d=E.find(e=>e.down&&!e.loaded);if(d)dispatch(d.g.position);} // a downed suspect still needs picking up
    for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0){scene.remove(tracers[i].m);tracers.splice(i,1);}}
    const r=police.resp;
    if(r){
      r.age+=dt;
      for(const c of r.cars){
        if(!c.parked||c.officersOut)continue;
        c.officersOut=true;
        for(let k=0;k<2;k++){
          const rx=-c.hz,rz=c.hx,sd=(k?1:-1)*2.2;
          const pos=new THREE.Vector3(c.x+rx*sd-c.hx*(1+k),0,c.z+rz*sd-c.hz*(1+k));
          const o=makeOfficer(pos);o.car=c;
        }
        if(!r.deployed){r.deployed=true;msg('Officers on scene — cover them!',3500);}
      }
      // end of response: no live shooters nearby for a while (or it has dragged on)
      const live=E.some(e=>e.alive&&Math.hypot(e.g.position.x-r.pos.x,e.g.position.z-r.pos.z)<55);
      const pending=E.some(e=>e.down&&!e.loaded&&Math.hypot(e.g.position.x-r.pos.x,e.g.position.z-r.pos.z)<90); // suspects still waiting for custody
      r.clear=(live||pending)?0:r.clear+dt;
      if(r.deployed&&police.officers.length&&police.officers.every(o=>!o.alive))r.allDown=(r.allDown||0)+dt;
      if(!r.recall&&r.deployed&&(r.clear>7||r.age>230||(r.allDown||0)>8)){r.recall=true;r.recallT=0;msg('Scene secured. Officers are standing down.',3500);}
      if(!r.recall&&!r.deployed&&r.age>90){ // cars never made it: let them go
        r.recall=true;r.recallT=99;}
      if(r.recall){
        r.recallT+=dt;
        for(const o of police.officers){if(o.arrest)releaseArrest(o);if(o.alive&&o.state!=='return')o.state='return';}
        const allGone=police.officers.every(o=>!o.alive||!o.g.visible);
        if(allGone||r.recallT>14){
          for(const o of police.officers){o.g.visible=false;o.gone=true;}
          for(const c of r.cars){c.parked=false;c.route=null;c.sirenOn=false;c.keep=false;c.plan=null;c.cruise=11;c.cop=false;}
          police.officers=police.officers.filter(o=>{if(o.gone){scene.remove(o.g);return false;}return true;});
          police.resp=null;police.cool=25;
        }
      }
    }
    // officers
    for(const o of police.officers){
      const A=o.anim;
      if(!o.alive){if(A)A.update(dt);if(o.g.visible&&now>=o.hideAt)o.g.visible=false;continue;}
      o.cd-=dt;let st='Idle';
      if(o.state==='return'&&o.car){
        const dx=o.car.x-o.g.position.x,dz=o.car.z-o.g.position.z,h=Math.hypot(dx,dz);
        if(h<1.6){o.g.visible=false;}else{stepOfficer(o,dx/h,dz/h,5.5*dt);o.g.rotation.y=Math.atan2(dx,dz);st='Run';}
      }else{
        // nearest live enemy
        let tgt=null,bd=45;for(const e of E){if(!e.alive)continue;const d=Math.hypot(e.g.position.x-o.g.position.x,e.g.position.z-o.g.position.z);if(d<bd){bd=d;tgt=e;}}
        if(o.arrest&&(!o.arrest.down||(tgt&&bd<22)))releaseArrest(o);   // suspect gone, or a shooter is close: back to defence
        if(!o.arrest&&!tgt){ // nobody shooting: go and take the nearest downed suspect into custody
          let best=null,bb=80;
          for(const e of E){if(!e.down||e.loaded||(e.claimedBy&&e.claimedBy.alive))continue;const d=Math.hypot(e.g.position.x-o.g.position.x,e.g.position.z-o.g.position.z);if(d<bb){bb=d;best=e;}}
          if(best){best.claimedBy=o;o.arrest=best;o.phase='go';o.atime=0;}
        }
        if(o.arrest)st=arrestStep(o,dt,now);
        else if(tgt){
          const dx=tgt.g.position.x-o.g.position.x,dz=tgt.g.position.z-o.g.position.z;
          o.g.rotation.y=Math.atan2(dx,dz);
          if(bd>11){stepOfficer(o,dx/bd,dz/bd,5.5*dt);st='Run';}
          else{st='Idle_Gun_Pointing';if(o.cd<=0){
            o.cd=R(1.0,1.6);if(A)A.once('Idle_Gun_Shoot',{dur:.4,fade:.05});
            const from=o.gun?o.gun.localToWorld(o.gun.userData.tip.clone()):o.g.position.clone().setY(1.3);
            const to=tgt.g.position.clone();to.y+=1.1*tgt.t.s;tracer(from,to);if(ctx.onShot)ctx.onShot(o.g.position,'pistol');
            // officers wound but never finish a suspect: the hero has to do that
            const floor=tgt.t.hp*.12;tgt.hp=Math.max(floor,tgt.hp-4);tgt.bar.scale.x=2*Math.max(.05,tgt.hp/tgt.t.hp);
          }}
        }
      }
      if(A){A.play(st,{fade:.2});A.update(dt);}
    }
  }
  // ---- arrests: walk to the downed suspect, cuff, escort to the police car, load
  function carFor(o){
    if(o.car&&o.car.parked)return o.car;
    const r=police.resp;return r?(r.cars.find(c=>c.parked)||null):null;
  }
  function releaseArrest(o){
    const e=o.arrest;
    if(e){e.claimedBy=null;if(e.cuffed&&e.anim&&e.down){e.anim.stop();e.anim.play('Idle',{fade:.2});}}
    o.arrest=null;o.phase=null;
  }
  function loadSuspect(o,now){
    const e=o.arrest;
    e.g.visible=false;e.down=false;e.loaded=true;e.cuffed=false;e.claimedBy=null;e.respawnAt=now+e.t.ar;
    police.arrests++;msg('Suspect in custody — loaded into the police car.',3200);
    o.arrest=null;o.phase=null;
  }
  function arrestStep(o,dt,now){
    const e=o.arrest,p=o.g.position,sp=e.g.position;
    o.atime=(o.atime||0)+dt;
    if(o.atime>50){if(o.phase==='escort')loadSuspect(o,now);else releaseArrest(o);return 'Idle';} // stuck: don't loop forever
    if(o.phase==='go'){
      const dx=sp.x-p.x,dz=sp.z-p.z,h=Math.hypot(dx,dz);
      o.g.rotation.y=Math.atan2(dx,dz);
      if(h>1.7){stepOfficer(o,dx/h,dz/h,5.5*dt);return 'Run';}
      if(e.cuffed){o.phase='escort';o.esc=0;o.sw=false;return 'Idle';} // already in cuffs (another officer let go): just walk them
      o.phase='cuff';o.ct=3;return 'Idle';
    }
    if(o.phase==='cuff'){
      o.ct-=dt;
      if(o.ct<=0){e.cuffed=true;if(e.anim){e.anim.stop();e.anim.play('Idle',{fade:.2});}o.phase='escort';o.esc=0;o.sw=false;} // cuffed: gets up, hands behind the back
      return 'Idle';
    }
    const car=carFor(o);
    if(!car){releaseArrest(o);return 'Idle';}
    // the suspect walks in front, towards the car; the officer follows a step behind
    const dx=car.x-sp.x,dz=car.z-sp.z,h=Math.hypot(dx,dz);
    if(h<=2.8){loadSuspect(o,now);return 'Idle';}
    const fx=dx/h,fz=dz/h;
    o.esc=(o.esc||0)+dt;
    const bx=sp.x-fx*1.6,bz=sp.z-fz*1.6,ox=bx-p.x,oz=bz-p.z,oh=Math.hypot(ox,oz);
    // the officer eases into his spot behind the suspect (speed scales with the gap: no stop-start, no flicker)
    if(oh>.02)stepOfficer(o,ox/oh,oz/oh,Math.min(4.4,oh*6)*dt);
    o.g.rotation.y=Math.atan2(sp.x-p.x,sp.z-p.z);
    // the suspect waits only if the officer falls well behind (hysteresis so it doesn't toggle)
    if(!o.sw&&o.esc>1.0&&oh<2.2)o.sw=true;else if(o.sw&&oh>3.5)o.sw=false;
    if(o.sw){stepOfficer(e,fx,fz,3*dt);e.g.rotation.y=Math.atan2(fx,fz);if(e.anim)e.anim.play('Walk',{fade:.2});}
    else if(e.anim)e.anim.play('Idle',{fade:.2});
    return (o.sw||oh>.6)?'Walk':'Idle'; // one steady walk while the escort is under way
  }
  function stepOfficer(o,dx,dz,s){ // walk, sliding along building walls
    const p=o.g.position,hit=(x,z)=>B.some(b=>Math.abs(x-b.x)<b.w/2+.6&&Math.abs(z-b.z)<b.d/2+.6);
    if(ctx.eject)ctx.eject(p,.6);   // if somehow inside a wall / tree / pole, get pushed out first
    if(!hit(p.x+dx*s,p.z))p.x+=dx*s;
    if(!hit(p.x,p.z+dz*s))p.z+=dz*s;
    if(ctx.eject)ctx.eject(p,.6);   // trees, rocks and signal poles are solid too
  }
  function hitOfficer(pt,dmg){
    for(const o of police.officers){
      if(!o.alive||!o.g.visible)continue;
      if(Math.hypot(pt.x-o.g.position.x,pt.z-o.g.position.z)<.8&&pt.y>0&&pt.y<2.1){
        o.hp-=dmg;
        if(o.hp<=0){o.alive=false;police.down++;
          if(o.anim){o.anim.stop();o.anim.once('Death',{dur:1.4,hold:true});}
          o.hideAt=ctx.now()+9;
          msg('OFFICER DOWN! Take out the shooters faster!',4000);}
        else if(o.anim)o.anim.once('HitRecieve',{dur:.3});
        return true;
      }
    }
    return false;
  }
  function noteDefeat(e){ // called when the hero (or anyone) takes a suspect out: nearby officers make the arrest
    if(!police.resp&&police.cool<=0)dispatch(e.g.position); // officers will come and collect the suspect
  }

  // ---------------------------------------------------------------- main update
  let lampT=0,spawnT=0;
  function update(dt,now){
    T+=dt;
    lampT-=dt;if(lampT<=0){lampT=.2;updateLamps(T);}
    const peds=pedestrians();
    for(const v of vehicles)updateVehicle(v,dt,peds);
    for(const v of vehicles)syncVisual(v,dt);
    // despawn far or stranded vehicles; keep traffic near the hero topped up
    for(let i=vehicles.length-1;i>=0;i--){const v=vehicles[i];
      if(v.keep)continue;
      const d=Math.hypot(v.x-P.pos.x,v.z-P.pos.z);
      if(d>160||(v.stuck>60&&d>60))removeVehicle(v);}
    spawnT-=dt;
    if(spawnT<=0&&vehicles.filter(v=>!v.keep).length<TARGET){spawnT=.25;trySpawn();}
    updatePolice(dt,now);
  }
  return {ready,update,alert,collidePlayer,hitOfficer,noteDefeat,vehicles,police,models,sig,solids,get T(){return T;},addVehicle,DEFS,
    get stats(){return {down:police.down,arrests:police.arrests,active:!!police.resp,cars:vehicles.length};}};
}
