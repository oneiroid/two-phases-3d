/* Two Phases 3D: rendering, sound, controls and the frame loop. The simulation itself is in sim.js. */
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {AfterimagePass} from 'three/addons/postprocessing/AfterimagePass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createSim} from './sim.js';

const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const SLOW=1/3;
const cl=(v,a,b)=>v<a?a:v>b?b:v,rnd=Math.random,sstep=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const $=id=>document.getElementById(id);
const cv=$('c');

/* ---------- renderer ---------- */
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'})}
catch(e){$('fail').hidden=false;throw e}
window.__tp3d=1;
renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));
renderer.setClearColor(0x000000,1);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,1,8000);
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const after=new AfterimagePass(.5);composer.addPass(after);
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.6,.38,.14);composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- sound (starts on first touch) ---------- */
let AC=null,mg,dg,o1,o2,lp,muted=false,lastTick=0,lastPop=0,lastCreak=0,lastPluck=0,lastGlide=0,NB=null,ts=1;
function audio(){
  if(AC){if(AC.state==='suspended'&&!document.hidden)AC.resume();return}
  try{
    AC=new(window.AudioContext||window.webkitAudioContext)();
    mg=AC.createGain();mg.gain.value=muted?0:1;mg.connect(AC.destination);
    o1=AC.createOscillator();o2=AC.createOscillator();o1.type='sine';o2.type='triangle';o1.frequency.value=55;o2.frequency.value=82.5;
    lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=260;
    dg=AC.createGain();dg.gain.value=0;
    o1.connect(lp);o2.connect(lp);lp.connect(dg);dg.connect(mg);o1.start();o2.start();
  }catch(e){AC=null}
}
function out(pan){if(pan==null||!AC.createStereoPanner)return mg;const p=AC.createStereoPanner();p.pan.value=cl(pan,-.9,.9);p.connect(mg);return p}
function tone(f,gain,dur,type,att,delay,pan){
  if(!AC||muted)return;const t=AC.currentTime+(delay||0),o=AC.createOscillator(),v=AC.createGain();att=att||.004;
  o.type=type||'sine';o.frequency.value=f;v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(gain,t+att);
  v.gain.exponentialRampToValueAtTime(.0001,t+att+dur);o.connect(v);v.connect(out(pan));o.start(t);o.stop(t+att+dur+.05);
}
function noise(dur,f,gain,q){if(!AC||muted)return;if(!NB){NB=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=NB.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=rnd()*2-1}
  const t=AC.currentTime,s=AC.createBufferSource(),bf=AC.createBiquadFilter(),v=AC.createGain();s.buffer=NB;bf.type='bandpass';bf.frequency.value=f;bf.Q.value=q||8;
  v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(gain,t+.01);v.gain.exponentialRampToValueAtTime(.0001,t+dur);
  s.connect(bf);bf.connect(v);v.connect(mg);s.start(t,rnd()*.5);s.stop(t+dur+.05)}
function glide(f0,f1,dur,gain){if(!AC||muted)return;const t=AC.currentTime,o=AC.createOscillator(),v=AC.createGain();o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);
  v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(gain,t+.03);v.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(v);v.connect(mg);o.start(t);o.stop(t+dur+.05)}
document.addEventListener('visibilitychange',()=>{if(!AC)return;document.hidden?AC.suspend():AC.resume()});
for(const ev of ['pointerdown','touchstart','keydown'])addEventListener(ev,audio,{passive:true});
const _pv=new THREE.Vector3();
const panOf=(x,y,z)=>{_pv.set(x,y,z).project(camera);return _pv.x*.8};
let shake=0;
const pt=()=>Math.pow(ts,.7),sl=()=>Math.min(1,ts),now=()=>performance.now();
const hooks={
  pluck(L){if(AC&&now()-lastPluck>60){lastPluck=now();tone(cl(9000/Math.max(20,L),180,900)*pt(),.018,.25,'sine')}},
  tick(state,x,y,z){if(AC&&now()-lastTick>(state===1?14:30)){lastTick=now();tone((state===1?700+rnd()*1600:1400+rnd()*1800)*pt(),state===1?.02:.012,.04/sl(),'triangle',0,0,panOf(x,y,z))}},
  glide(r){if(AC&&now()-lastGlide>70){lastGlide=now();glide(500*pt(),cl(1600/r,90,400)*pt(),.35/sl(),.02)}},
  pop(x,y,z){if(!RM)shake=Math.min(1.2,shake+.45);if(AC&&now()-lastPop>25){lastPop=now();const p=panOf(x,y,z);tone(150*pt(),.05,.25/sl(),'sine',0,0,p);tone(900*pt(),.02,.06,'triangle',0,0,p)}},
  bif(){tone(110*pt(),.04,1.6,'sine',.3);tone(165*pt(),.03,1.6,'sine',.3)},
  hubs(){tone(196*pt(),.03,2.4,'sine',.4);tone(294*pt(),.025,2.4,'sine',.4);tone(392*pt(),.02,2.6,'sine',.5,.3)},
  creak(hot){if(AC&&now()-lastCreak>cl(900/hot,40,900)/sl()){lastCreak=now();noise(.09/sl(),(260+rnd()*500)*pt(),.025,6)}}
};

/* ---------- simulation ---------- */
const N=cl(Math.round(innerWidth*innerHeight/9000),45,90);
const S=createSim(N,hooks);
const NM=S.NM,R=S.R,SP=S.SP;

/* ---------- colour: one scale for everything, how close a part is to breaking ---------- */
const lin=c=>Math.pow(c/255,2.2),L3=a=>a.map(lin);
const C0=L3([120,145,175]),C1=L3([245,180,60]),C2=L3([255,64,48]);
const WARM=L3([255,214,150]),FRAG=L3([255,179,102]),STREAK=L3([242,186,138]),HALO=L3([150,170,200]),REACH=L3([200,220,255]),RING=L3([200,215,240]),
  HOT=L3([255,240,200]),TIP=L3([230,240,255]),IDLE=L3([110,120,140]),SHOCK=L3([255,170,90]);
const sc=[0,0,0];
function scol(x){x=cl(x,0,1);const p=x<.5?C0:C1,q=x<.5?C1:C2,t=x<.5?x*2:(x-.5)*2;sc[0]=p[0]+(q[0]-p[0])*t;sc[1]=p[1]+(q[1]-p[1])*t;sc[2]=p[2]+(q[2]-p[2])*t;return sc}

const fogU={value:new THREE.Vector2(400,1400)};
const FOG=`uniform vec2 uFog;float fogK(float d){return mix(1.,.26,smoothstep(uFog.x,uFog.y,d));}`;
const inst=(n,k)=>{const a=new THREE.InstancedBufferAttribute(new Float32Array(n*k),k);a.setUsage(THREE.DynamicDrawUsage);return a};

/* nodes: dark bodies, the rim shows load, a core lights up when the node is close to failing */
const nodeGeo=new THREE.SphereGeometry(1,28,20);
const nRim=inst(NM,3),nCore=inst(NM,4),nMisc=inst(NM,2);
nodeGeo.setAttribute('aRim',nRim);nodeGeo.setAttribute('aCore',nCore);nodeGeo.setAttribute('aMisc',nMisc);
const nodeMat=new THREE.ShaderMaterial({uniforms:{uFog:fogU},transparent:true,
  vertexShader:`attribute vec3 aRim;attribute vec4 aCore;attribute vec2 aMisc;varying vec3 vN,vV,vRim;varying vec4 vCore;varying vec2 vMisc;varying float vD;
  void main(){vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vN=normalize(normalMatrix*mat3(instanceMatrix)*normal);vV=-mv.xyz;
  vRim=aRim;vCore=aCore;vMisc=aMisc;vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`${FOG}varying vec3 vN,vV,vRim;varying vec4 vCore;varying vec2 vMisc;varying float vD;
  void main(){vec3 n=normalize(vN);float nv=clamp(dot(n,normalize(vV)),0.,1.),rim=pow(1.-nv,3.);
  vec3 c=vec3(.003,.004,.007)+vec3(.0025,.0032,.005)*max(dot(n,normalize(vec3(.35,.8,.5))),0.);
  c+=vRim*(rim*1.5+.015);c+=vCore.rgb*vCore.a*pow(nv,1.4)*1.3;c+=vec3(1.,.82,.55)*vMisc.y*(.25+.9*pow(nv,2.));
  gl_FragColor=vec4(c*fogK(vD),vMisc.x);}`});
const nodes=new THREE.InstancedMesh(nodeGeo,nodeMat,NM);nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);nodes.frustumCulled=false;nodes.renderOrder=1;scene.add(nodes);

/* shells: the reach of a heavy node, and the shock front of a fission */
const shellGeo=new THREE.SphereGeometry(1,40,28),shCol=inst(NM*2,4);shellGeo.setAttribute('aC',shCol);
const shellMat=new THREE.ShaderMaterial({uniforms:{uFog:fogU},transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
  vertexShader:`attribute vec4 aC;varying vec3 vN,vV;varying vec4 vC;varying float vD;void main(){vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vN=normalize(normalMatrix*mat3(instanceMatrix)*normal);vV=-mv.xyz;vC=aC;vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`${FOG}varying vec3 vN,vV;varying vec4 vC;varying float vD;void main(){float nv=abs(dot(normalize(vN),normalize(vV)));float a=pow(1.-nv,4.)*1.4+.015;gl_FragColor=vec4(vC.rgb*vC.a*a*fogK(vD),1.);}`});
const shells=new THREE.InstancedMesh(shellGeo,shellMat,NM*2);shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);shells.frustumCulled=false;shells.renderOrder=3;scene.add(shells);

/* billboards: halos, flashes, level rings, growing-link tips */
const BB=NM*8,bbGeo=new THREE.InstancedBufferGeometry();
bbGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3));bbGeo.setIndex([0,1,2,0,2,3]);
const bP=inst(BB,3),bS=inst(BB,1),bC=inst(BB,4),bK=inst(BB,2);bbGeo.setAttribute('iP',bP);bbGeo.setAttribute('iS',bS);bbGeo.setAttribute('iC',bC);bbGeo.setAttribute('iK',bK);
const bbMat=new THREE.ShaderMaterial({uniforms:{uFog:fogU},transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
  vertexShader:`${FOG}attribute vec3 iP;attribute float iS;attribute vec4 iC;attribute vec2 iK;varying vec2 vUv,vK;varying vec4 vC;
  void main(){vec4 mv=modelViewMatrix*vec4(iP,1.);mv.xy+=position.xy*iS;vUv=position.xy;vK=iK;vC=iC;vC.a*=fogK(-mv.z);gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`varying vec2 vUv,vK;varying vec4 vC;void main(){float r=length(vUv);if(r>1.)discard;float a;
  if(vK.x<.5)a=pow(1.-r,2.);else if(vK.x<1.5)a=1.-smoothstep(.7,1.,r);else{float w=vK.y;a=1.-smoothstep(0.,w,abs(r-(1.-w)));}
  gl_FragColor=vec4(vC.rgb*vC.a*a,1.);}`});
const bbs=new THREE.Mesh(bbGeo,bbMat);bbs.frustumCulled=false;bbs.renderOrder=4;scene.add(bbs);

/* ribbons: links (thickness = force carried, a bowed link is compressed, a sagging one is slack), snapped halves, fragment tracks */
const SEG=12,RB=4096,rbGeo=new THREE.InstancedBufferGeometry();
{const t=[],p=[],ix=[];for(let s=0;s<=SEG;s++){t.push(s/SEG,-1,s/SEG,1);p.push(0,0,0,0,0,0)}
  for(let s=0;s<SEG;s++){const a=2*s;ix.push(a,a+1,a+2,a+1,a+3,a+2)}
  rbGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(p),3));rbGeo.setAttribute('aT',new THREE.BufferAttribute(new Float32Array(t),2));rbGeo.setIndex(ix)}
const rA=inst(RB,3),rB=inst(RB,3),rC=inst(RB,3),rW=inst(RB,1),rK=inst(RB,4);
rbGeo.setAttribute('iA',rA);rbGeo.setAttribute('iB',rB);rbGeo.setAttribute('iC',rC);rbGeo.setAttribute('iW',rW);rbGeo.setAttribute('iCol',rK);
const pxU={value:.002};
const rbMat=new THREE.ShaderMaterial({uniforms:{uFog:fogU,uPx:pxU},transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
  vertexShader:`${FOG}uniform float uPx;attribute vec2 aT;attribute vec3 iA,iB,iC;attribute float iW;attribute vec4 iCol;varying vec4 vC;varying float vS;
  void main(){float t=aT.x,u=1.-t;vec3 P=u*u*iA+2.*u*t*iC+t*t*iB,Tg=2.*u*(iC-iA)+2.*t*(iB-iC);
  vec4 mv=modelViewMatrix*vec4(P,1.);vec3 tv=(modelViewMatrix*vec4(Tg,0.)).xyz,sd=cross(tv,mv.xyz);float l=length(sd);sd=l>1e-6?sd/l:vec3(1.,0.,0.);
  float w=max(iW,uPx*(-mv.z)*1.4);mv.xyz+=sd*w*.5*aT.y;vC=iCol;vC.a*=iW/w*fogK(-mv.z);vS=aT.y;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`varying vec4 vC;varying float vS;void main(){float a=1.-smoothstep(.45,1.,abs(vS));gl_FragColor=vec4(vC.rgb*vC.a*a,1.);}`});
const ribbons=new THREE.Mesh(rbGeo,rbMat);ribbons.frustumCulled=false;ribbons.renderOrder=2;scene.add(ribbons);

/* backdrop: a faint gradient around the viewer, written in linear light like everything else */
const sky=new THREE.Mesh(new THREE.SphereGeometry(7000,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,
  vertexShader:`varying vec3 vW;void main(){vW=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec3 vW;void main(){float h=vW.y*.5+.5;vec3 lo=vec3(.0010,.0015,.0030),hi=vec3(.0024,.0032,.0060);gl_FragColor=vec4(mix(lo,hi,smoothstep(.15,.95,h)),1.);}`}));
sky.renderOrder=-1;sky.frustumCulled=false;scene.add(sky);

/* depth cues: distant dust, and faint motes inside the working volume */
function dust(n,r0,r1,size,col,op){const p=new Float32Array(n*3);for(let i=0;i<n;i++){let x,y,z,d;do{x=rnd()*2-1;y=rnd()*2-1;z=rnd()*2-1;d=Math.hypot(x,y,z)}while(d>1||d<.01);
  const r=r0+(r1-r0)*Math.cbrt(rnd());p[i*3]=x/d*r;p[i*3+1]=y/d*r;p[i*3+2]=z/d*r}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
  const pts=new THREE.Points(g,new THREE.PointsMaterial({size,sizeAttenuation:false,color:col,transparent:true,opacity:op,depthWrite:false}));scene.add(pts);return pts}
dust(1400,R*4,R*11,1.5,0x4a5870,.8);dust(260,R*.2,R*1.5,1.2,0x2a3546,.9);

/* ---------- camera: free 3D orbit (trackball) around the bound body ----------
   the camera's orientation is one quaternion; drags rotate it about the camera's own axes, so there is no fixed "up" and no pole */
let zoom=1,tReal=0,idle=99;const tgt=new THREE.Vector3(),tgtGoal=new THREE.Vector3();
const camQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3,.7,0,'YXZ'));
const angV=new THREE.Vector3();   // angular velocity in camera space (x pitch, y yaw, z roll), rad per frame at 60 fps
const _q=new THREE.Quaternion(),_ax=new THREE.Vector3(),_off=new THREE.Vector3();
function turn(ax,ay,az){const a=Math.hypot(ax,ay,az);if(a<1e-7)return;_ax.set(ax/a,ay/a,az/a);camQ.multiply(_q.setFromAxisAngle(_ax,a)).normalize()}
function resize(){const W=innerWidth,H=innerHeight;renderer.setSize(W,H,false);composer.setSize(W,H);bloom.resolution.set(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();
  pxU.value=2*Math.tan(camera.fov*Math.PI/360)/H}
addEventListener('resize',resize);resize();

/* ---------- controls ----------
   left drag: rotate · right drag (or shift + left drag): roll · wheel or pinch: zoom
   middle button held (or Space): slow motion; drag up or down while holding to change how slow
   slider: base time rate, ×0.05 to ×1.5, default ×1 */
const RMIN=.05,RMAX=1.5,RSTEPS=1000;
const rateIn=$('rateIn'),rateOut=$('rate'),rate1=$('rate1');
const toSlider=r=>Math.round(RSTEPS*Math.log(r/RMIN)/Math.log(RMAX/RMIN)),fromSlider=v=>RMIN*Math.pow(RMAX/RMIN,v/RSTEPS);
let base=1;
function setBase(r){base=cl(r,RMIN,RMAX);rateIn.value=String(toSlider(base));rateIn.setAttribute('aria-valuetext','×'+base.toFixed(2))}
rateIn.addEventListener('input',()=>{let r=fromSlider(+rateIn.value);if(Math.abs(r-1)<.03)r=1;base=r;rateIn.setAttribute('aria-valuetext','×'+r.toFixed(2))});
rate1.addEventListener('click',()=>setBase(1));
setBase(1);

let ctl=null,drag=null,pinch=null;const pts=new Map();
const hint=$('hint');let hintT=0,hintGone=false;
function hideHint(){if(!hintGone){hintGone=true;setTimeout(()=>hint.style.opacity=0,4000)}}
const ROT=.006;
function twoPts(){const [a,b]=[...pts.values()];return {d:Math.hypot(a.x-b.x,a.y-b.y)||1,ang:Math.atan2(b.y-a.y,b.x-a.x),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2}}
cv.addEventListener('pointerdown',e=>{e.preventDefault();cv.focus({preventScroll:true});hideHint();
  if(e.pointerType==='mouse'){
    if(e.button===1){if(!ctl){ctl={id:e.pointerId,y0:e.clientY,y:e.clientY};try{cv.setPointerCapture(e.pointerId)}catch(_){}}return}
    if(drag)return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,roll:e.button===2||(e.button===0&&e.shiftKey)};try{cv.setPointerCapture(e.pointerId)}catch(_){}return}
  // touch and pen: one finger rotates, two fingers pinch to zoom and twist to roll
  try{cv.setPointerCapture(e.pointerId)}catch(_){}
  pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===1)drag={id:e.pointerId,x:e.clientX,y:e.clientY,roll:false};
  else if(pts.size===2){drag=null;const t=twoPts();pinch={d:t.d,z:zoom,ang:t.ang,cx:t.cx,cy:t.cy}}});
cv.addEventListener('pointermove',e=>{
  if(ctl&&ctl.id===e.pointerId){ctl.y=e.clientY;return}
  const p=pts.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY}
  if(pinch&&pts.size>=2){const t=twoPts();zoom=cl(pinch.z*pinch.d/t.d,.35,2.6);
    let da=t.ang-pinch.ang;da=Math.atan2(Math.sin(da),Math.cos(da));pinch.ang=t.ang;
    const dx=t.cx-pinch.cx,dy=t.cy-pinch.cy;pinch.cx=t.cx;pinch.cy=t.cy;
    angV.set(-dy*ROT,-dx*ROT,da);turn(angV.x,angV.y,angV.z);idle=0;pinch.t=performance.now();return}
  if(drag&&drag.id===e.pointerId){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;drag.t=performance.now();
    if(drag.roll){// roll follows the angle swept around the screen centre
      const cx=innerWidth/2,cy=innerHeight/2,a0=Math.atan2(e.clientY-dy-cy,e.clientX-dx-cx),a1=Math.atan2(e.clientY-cy,e.clientX-cx);
      let da=a1-a0;da=Math.atan2(Math.sin(da),Math.cos(da));angV.set(0,0,da)}
    else angV.set(-dy*ROT,-dx*ROT,0);
    turn(angV.x,angV.y,angV.z);idle=0}});
const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch=null;
  if(ctl&&ctl.id===e.pointerId)ctl=null;
  if(drag&&drag.id===e.pointerId){if(performance.now()-(drag.t||0)>80)angV.set(0,0,0);drag=null}
  if(e.pointerType!=='mouse'&&pts.size===1&&!drag){const [id,p]=[...pts.entries()][0];drag={id,x:p.x,y:p.y,roll:false}}};
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('auxclick',e=>e.preventDefault());
cv.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault()});   // no autoscroll on middle click
cv.addEventListener('wheel',e=>{e.preventDefault();zoom=cl(zoom*Math.exp(e.deltaY*.0012),.35,2.6)},{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
const KR=.05;
addEventListener('keydown',e=>{
  const tg=e.target.tagName;if(tg==='BUTTON'||tg==='INPUT')return;
  if(e.code==='Space'){e.preventDefault();if(!ctl)ctl={id:'key',y0:0,y:0};hideHint()}
  else if(e.code==='ArrowUp'&&ctl){e.preventDefault();ctl.y-=14}
  else if(e.code==='ArrowDown'&&ctl){e.preventDefault();ctl.y+=14}
  else if(e.code==='ArrowUp'){e.preventDefault();turn(KR,0,0);idle=0}
  else if(e.code==='ArrowDown'){e.preventDefault();turn(-KR,0,0);idle=0}
  else if(e.code==='ArrowLeft'){e.preventDefault();turn(0,KR,0);idle=0}
  else if(e.code==='ArrowRight'){e.preventDefault();turn(0,-KR,0);idle=0}
  else if(e.key==='q'||e.key==='Q'){turn(0,0,KR);idle=0}
  else if(e.key==='e'||e.key==='E'){turn(0,0,-KR);idle=0}
  else if(e.key==='r'||e.key==='R'){camQ.setFromEuler(new THREE.Euler(-.3,.7,0,'YXZ'));angV.set(0,0,0);zoom=1}
  else if(e.key==='m'||e.key==='M')setMute(!muted)});
addEventListener('keyup',e=>{if(e.code==='Space'&&ctl&&ctl.id==='key')ctl=null});
addEventListener('blur',()=>{ctl=null;drag=null;pinch=null;pts.clear()});
const snd=$('snd');
function setMute(v){muted=v;snd.textContent=v?'Sound off':'Sound on';snd.setAttribute('aria-pressed',String(!v));if(mg)mg.gain.setTargetAtTime(v?0:1,AC.currentTime,.05)}
snd.addEventListener('click',()=>{audio();setMute(!muted)});

/* ---------- per-frame fill of the GPU buffers ---------- */
const M4=nodes.instanceMatrix.array,SM=shells.instanceMatrix.array;
function setM(arr,k,x,y,z,s){const o=k*16;arr[o]=s;arr[o+1]=0;arr[o+2]=0;arr[o+3]=0;arr[o+4]=0;arr[o+5]=s;arr[o+6]=0;arr[o+7]=0;arr[o+8]=0;arr[o+9]=0;arr[o+10]=s;arr[o+11]=0;arr[o+12]=x;arr[o+13]=y;arr[o+14]=z;arr[o+15]=1}
let nb_=0,nr=0,ns=0;
function bb(x,y,z,s,c,a,kind,w){if(nb_>=BB)return;const k=nb_++;bP.array[k*3]=x;bP.array[k*3+1]=y;bP.array[k*3+2]=z;bS.array[k]=s;
  bC.array[k*4]=c[0];bC.array[k*4+1]=c[1];bC.array[k*4+2]=c[2];bC.array[k*4+3]=a;bK.array[k*2]=kind;bK.array[k*2+1]=w||0}
function rb(ax,ay,az,bx,by,bz,cx,cy,cz,w,c,a){if(nr>=RB)return;const k=nr++,o=k*3;rA.array[o]=ax;rA.array[o+1]=ay;rA.array[o+2]=az;rB.array[o]=bx;rB.array[o+1]=by;rB.array[o+2]=bz;
  rC.array[o]=cx;rC.array[o+1]=cy;rC.array[o+2]=cz;rW.array[k]=w;rK.array[k*4]=c[0];rK.array[k*4+1]=c[1];rK.array[k*4+2]=c[2];rK.array[k*4+3]=a}
function line(ax,ay,az,bx,by,bz,w,c,a){rb(ax,ay,az,bx,by,bz,(ax+bx)/2,(ay+by)/2,(az+bz)/2,w,c,a)}
function shell(x,y,z,r,c,a){if(ns>=NM*2)return;setM(SM,ns,x,y,z,r);const o=ns*4;shCol.array[o]=c[0];shCol.array[o+1]=c[1];shCol.array[o+2]=c[2];shCol.array[o+3]=a;ns++}

function fill(es){
  const v=S.view(),A=v.A,{px,py,pz,vx,vy,vz,m,nb,abs,absT,absD,sig,zap,frag,lv,born}=S,D=v.D,T=v.T,st=v.state;
  nb_=0;nr=0;ns=0;let n=0;
  const gw=st===0||st===3?1+1.6*D:.6;
  for(const i of A){
    let r=S.rad(i),al=Math.min(1,(T-born[i])/.6+(born[i]===0?1:0));
    if(abs[i]>=0){const p=cl(absT[i]/absD[i],0,1);r*=1-.7*p;al*=1-p}
    const s=Math.min(1,sig[i]);
    setM(M4,n,px[i],py[i],pz[i],r);
    const rim=nb[i]?scol(s):IDLE,rk=nb[i]?1:.45;
    nRim.array[n*3]=rim[0]*rk;nRim.array[n*3+1]=rim[1]*rk;nRim.array[n*3+2]=rim[2]*rk;
    if(s>.5&&nb[i]){const c=scol(s);nCore.array[n*4]=c[0];nCore.array[n*4+1]=c[1];nCore.array[n*4+2]=c[2];nCore.array[n*4+3]=(s-.5)*1.6}else nCore.array[n*4+3]=0;
    nMisc.array[n*2]=al;nMisc.array[n*2+1]=zap[i];n++;
    if(abs[i]>=0)continue;
    if(m[i]>=2.5)bb(px[i],py[i],pz[i],Math.min(120,(r*2+12)*gw),HALO,.006+.004*D,0);
    if(zap[i]>.05)bb(px[i],py[i],pz[i],r*(1.6+2.2*zap[i]),WARM,.55*zap[i],0);
    if(nb[i])for(let q=1;q<=lv[i];q++){const rr=r+3.2*q+1.5;bb(px[i],py[i],pz[i],rr,RING,(.55-.1*q)*al,2,1.3/rr)}
    // reach of heavy nodes: appears as a node approaches the threshold, bright while it devours
    const q=m[i]/v.Mth;if(q>=.6){const a=st===3&&q>=.5?(.12+.38*Math.min(1,(q-.5)*2))*(.85+.15*Math.sin(T*12)):Math.pow((Math.min(1,q)-.6)/.4,2)*.4;
      if(a>.02)shell(px[i],py[i],pz[i],S.reach(i),REACH,a*.16)}
    // fragment tracks during the chain reaction
    if(frag[i]>=.15)line(px[i],py[i],pz[i],px[i]-vx[i]*3,py[i]-vy[i]*3,pz[i]-vz[i]*3,r*.5,FRAG,.3*frag[i]);
    // motion streaks in slow motion
    if(es>.02&&vx[i]*vx[i]+vy[i]*vy[i]+vz[i]*vz[i]>.3){const Ls=3+10*es;line(px[i],py[i],pz[i],px[i]-vx[i]*Ls,py[i]-vy[i]*Ls,pz[i]-vz[i]*Ls,2,STREAK,.35*es)}
  }
  nodes.count=n;
  for(const sh of S.shocks){const p=sh.t/1.1,e=1-Math.pow(1-p,3);shell(sh.x,sh.y,sh.z,sh.r0+SP*2.6*e,SHOCK,.7*(1-p)*(1-p)*Math.min(1,sh.M/5))}
  shells.count=ns;
  const F0=S.K0*SP*.25;
  for(const bd of v.bonds){
    const a=bd.a,b=bd.b,gr=bd.gr,ax=px[a],ay=py[a],az=pz[a],bx=ax+(px[b]-ax)*gr,by=ay+(py[b]-ay)*gr,bz=az+(pz[b]-az)*gr;
    const dx=bx-ax,dy=by-ay,dz=bz-az,d=Math.hypot(dx,dy,dz)||1,ut=bd.su,hot=bd.pend?1:0;
    const w=.9+4.5*Math.min(1.6,bd.sw/F0)+hot*2.5;
    const bow=hot?0:bd.T<0&&ut>.12?d*.18*Math.min(1,ut):ut<.1?d*.05:0;
    let cx=(ax+bx)/2,cy=(ay+by)/2,cz=(az+bz)/2;
    if(bow){const ux=dx/d,uy=dy/d,uz=dz/d,dt=bd.qx*ux+bd.qy*uy+bd.qz*uz;let qx=bd.qx-dt*ux,qy=bd.qy-dt*uy,qz=bd.qz-dt*uz;const ql=Math.hypot(qx,qy,qz)||1;
      cx+=qx/ql*bow*2;cy+=qy/ql*bow*2;cz+=qz/ql*bow*2}
    if(hot)rb(ax,ay,az,bx,by,bz,cx,cy,cz,w,HOT,.95);else rb(ax,ay,az,bx,by,bz,cx,cy,cz,w,scol(ut),.45+.5*Math.min(1,ut));
    if(gr<1)bb(bx,by,bz,3.2,TIP,.9,1);
  }
  for(const s of S.snaps){const e=s.life*s.life,dx=px[s.b]-px[s.a],dy=py[s.b]-py[s.a],dz=pz[s.b]-pz[s.a],d=Math.hypot(dx,dy,dz)||1,q=Math.min(d/2,s.l/2*e)/d,w=s.w*(.4+.6*e);
    line(px[s.a],py[s.a],pz[s.a],px[s.a]+dx*q,py[s.a]+dy*q,pz[s.a]+dz*q,w,C2,.85*e);
    line(px[s.b],py[s.b],pz[s.b],px[s.b]-dx*q,py[s.b]-dy*q,pz[s.b]-dz*q,w,C2,.85*e)}
  bbGeo.instanceCount=nb_;rbGeo.instanceCount=nr;
  for(const a of [nRim,nCore,nMisc,shCol,bP,bS,bC,bK,rA,rB,rC,rW,rK])a.needsUpdate=true;
  nodes.instanceMatrix.needsUpdate=true;shells.instanceMatrix.needsUpdate=true;
  return v;
}

/* ---------- HUD ---------- */
const PH=['growth','collapse','dispersal','consolidation'],PC=['var(--safe)','var(--fail)','var(--ink-dim)','var(--hub)'];
const phEl=$('ph'),dotEl=$('dot'),cntEl=$('cnt'),vig=$('vig'),barT=$('barT'),barB=$('barB');
let hudKey='',rateKey='';
function hud(v,es){
  const k=v.state+'|'+v.level+'|'+v.A.length+'|'+v.bonds.length;
  if(k!==hudKey){hudKey=k;phEl.textContent=PH[v.state]+((v.state===0||v.state===3)&&v.level?` · level ${v.level+1}`:'');
    dotEl.style.background=PC[v.state];dotEl.style.color=PC[v.state];cntEl.textContent=`${v.A.length} nodes · ${v.bonds.length} links`}
  const rk=ts.toFixed(2)+(ctl?'h':'');if(rk!==rateKey){rateKey=rk;rateOut.textContent='×'+ts.toFixed(2);rateOut.classList.toggle('held',!!ctl)}
  vig.style.opacity=es.toFixed(3);barT.style.transform=barB.style.transform=`scaleY(${es.toFixed(3)})`;
}

/* ---------- loop ---------- */
let last=performance.now(),tsT=1;
function frame(t){
  const dtR=Math.min(.05,Math.max(.001,(t-last)/1000));last=t;tReal+=dtR;
  if(!hintGone){hintT+=dtR;if(hintT>14)hideHint()}
  tsT=ctl?cl(base*SLOW*Math.pow(2,(ctl.y0-ctl.y)/70),.02,4):base;
  ts+=(tsT-ts)*Math.min(1,dtR*5);
  S.step(dtR*ts);
  const es=sstep(cl((1-ts)/(1-SLOW),0,1));
  const v=fill(es);
  // camera: inertia after a drag, then a slow tumble about a drifting axis once the view has been left alone for a few seconds
  idle+=dtR;
  if(!drag&&!pinch){const k=Math.pow(.03,dtR);angV.multiplyScalar(k);turn(angV.x*dtR*60,angV.y*dtR*60,angV.z*dtR*60)}
  if(!RM&&idle>4){const w=Math.min(1,(idle-4)/3)*dtR*Math.min(1,ts);turn(.018*Math.sin(tReal*.051)*w,-.05*w,.012*Math.sin(tReal*.033+1)*w)}
  if(v.nBound>0)tgtGoal.set(v.bcx*.7,v.bcy*.7,v.bcz*.7);else tgtGoal.set(0,0,0);
  tgt.lerp(tgtGoal,1-Math.exp(-dtR*.8));
  const fit=R*1.02/(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect)),dist=fit*zoom;
  _off.set(0,0,dist).applyQuaternion(camQ);camera.position.copy(tgt).add(_off);camera.quaternion.copy(camQ);
  if(shake>.01){camera.position.x+=(rnd()-.5)*shake*7;camera.position.y+=(rnd()-.5)*shake*7;camera.position.z+=(rnd()-.5)*shake*7}
  shake*=Math.exp(-dtR*5);
  sky.position.copy(camera.position);
  fogU.value.set(dist-R*.5,dist+R*1.4);
  // trails stay for slow motion but are cut while the view turns quickly, where they would only smear the whole frame
  after.uniforms.damp.value=RM?0:(.3+.35*es)*(1-Math.min(1,Math.hypot(angV.x,angV.y,angV.z)*25));
  bloom.strength=.6+.2*Math.min(1,v.heat)+(v.state===1?.25:0);
  // drone follows the average load
  if(AC&&dg){const at=AC.currentTime,p=Math.pow(ts,.6),s=cl(v.sigma,0,1.2),stt=v.state;
    dg.gain.setTargetAtTime(stt===1?.07:stt===2?.012+.02*v.heat:.015+.05*s,at,.25);lp.frequency.setTargetAtTime(Math.min(4000,(stt===2?160:220+900*s*s)*p),at,.15);
    o2.frequency.setTargetAtTime(82.5*(1+(stt===0||stt===1?.05*s:0))*p,at,.15);o1.frequency.setTargetAtTime((stt===2?49:55)*p,at,.15)}
  hud(v,es);
  composer.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(t=>{last=t;frame(t)});
// keep the screen awake while watching, where the browser allows it
const wake=()=>{try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(_){}};wake();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake()});
