/* Two Phases, 3D simulation core. No rendering here: the page reads the arrays and draws them.
   states: 0 slow growth, 1 collapse (fission chain), 2 dispersal, 3 consolidation (bifurcation) */
export function createSim(N, hooks, opt){
  opt=opt||{};
  const H=hooks||{};const call=(k,...a)=>{if(H[k])H[k](...a)};
  const NM=N*3,K0=.1,SP=100,GS=opt.gs??.42,MAXDEG=opt.maxdeg??6;
  // self-regulation with a delayed load signal (Deus ex Futuro, "the two-phase law"): the delay grows with the structure's
  // complexity, and a new level runs faster and regulates with a proportionally shorter delay
  const TAU0=opt.tau0??.45,GAM=opt.gam??1.3,KG=opt.kg??15,SIG0=.5;
  const R=Math.cbrt(N*SP*SP*SP*3/(4*Math.PI))*(opt.rs??.8);
  const rnd=Math.random,cl=(v,a,b)=>v<a?a:v>b?b:v,sstep=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
  const F=()=>new Float32Array(NM);
  const px=F(),py=F(),pz=F(),vx=F(),vy=F(),vz=F(),fx=F(),fy=F(),fz=F(),m=F(),mT=F(),sig=F(),fat=F(),zap=F(),frag=F(),fis=F(),
    absT=F(),absD=F(),offx=F(),offy=F(),offz=F(),born=F();
  const nb=new Uint8Array(NM),act=new Uint8Array(NM),arr=new Uint8Array(NM),lv=new Uint8Array(NM),abs=new Int16Array(NM).fill(-1);
  let A=[],bonds=[],pend=[];const bset=new Set();
  let state=2,D=0,heat=.8,level=0,fT=0,T=0,gT=0,Mth0=N*.3,Mth=Mth0,quiet=0,bifEnd=-1,sigma=0,
    bcx=0,bcy=0,bcz=0,nBound=0,lastAbs=0,ev=null,
    brake=0,Deff=0,sigQ=0,tauD=0,kG=0,sigHat=0,col0=0,colBroken=0,hm0=0,depth=0;
  const hist=[],hitTried=new Set();
  const snaps=[],shocks=[],cool=new Map(),nextEat=new Map();
  const key=(a,b)=>a<b?a*4096+b:b*4096+a;
  const rad=i=>3.5+3.6*Math.sqrt(m[i]);
  const gap=(i,j)=>rad(i)+rad(j)+SP*.38;
  const reach=i=>rad(i)+SP*(.6+.5*Math.min(2,m[i]/Mth));
  function ru(){let x,y,z,d;do{x=rnd()*2-1;y=rnd()*2-1;z=rnd()*2-1;d=x*x+y*y+z*z}while(d>1||d<1e-4);d=Math.sqrt(d);return[x/d,y/d,z/d]}

  for(let i=0;i<N;i++){act[i]=1;const u=ru(),r=R*.9*Math.cbrt(rnd());px[i]=u[0]*r;py[i]=u[1]*r;pz[i]=u[2]*r;
    const v=ru(),s=.4+rnd()*1.2;vx[i]=v[0]*s;vy[i]=v[1]*s;vz[i]=v[2]*s;m[i]=.7+6.5*Math.pow(rnd(),3)}

  /* ---------- nodes ---------- */
  function spawn(mass,x,y,z,ux,uy,uz){for(let i=0;i<NM;i++)if(!act[i]){act[i]=1;m[i]=mass;px[i]=x;py[i]=y;pz[i]=z;vx[i]=ux;vy[i]=uy;vz[i]=uz;
    nb[i]=0;fat[i]=0;zap[i]=0;frag[i]=0;fis[i]=0;abs[i]=-1;sig[i]=0;arr[i]=0;lv[i]=0;mT[i]=0;born[i]=T;return i}return -1}
  function spawnEdge(){
    const u=ru(),t=ru(),mass=.6+.8*rnd(),s=.5+.3*rnd();
    const i=spawn(mass,u[0]*(R+8),u[1]*(R+8),u[2]*(R+8),-u[0]*s+t[0]*.15,-u[1]*s+t[1]*.15,-u[2]*s+t[2]*.15);if(i>=0)arr[i]=1;
  }
  function kill(i){for(const o of bonds)if(!o.dead&&(o.a===i||o.b===i))unlink(o);act[i]=0;abs[i]=-1;fis[i]=0}

  /* ---------- links ----------
     the 3D counterpart of the planar rule: a new link may not pass through another node,
     and may not run closer than a node's width to an existing link */
  function segDist(a,b,c,d){
    const ux=px[b]-px[a],uy=py[b]-py[a],uz=pz[b]-pz[a],vx_=px[d]-px[c],vy_=py[d]-py[c],vz_=pz[d]-pz[c],wx=px[a]-px[c],wy=py[a]-py[c],wz=pz[a]-pz[c];
    const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx_+uy*vy_+uz*vz_,cc=vx_*vx_+vy_*vy_+vz_*vz_,dd=ux*wx+uy*wy+uz*wz,ee=vx_*wx+vy_*wy+vz_*wz,den=aa*cc-bb*bb;
    let s=den>1e-6?cl((bb*ee-cc*dd)/den,0,1):0,t=(bb*s+ee)/(cc||1);
    if(t<0){t=0;s=cl(-dd/(aa||1),0,1)}else if(t>1){t=1;s=cl((bb-dd)/(aa||1),0,1)}
    const qx=wx+ux*s-vx_*t,qy=wy+uy*s-vy_*t,qz=wz+uz*s-vz_*t;return Math.sqrt(qx*qx+qy*qy+qz*qz);
  }
  function crossesAny(i,j){
    const ex=px[j]-px[i],ey=py[j]-py[i],ez=pz[j]-pz[i],l2=ex*ex+ey*ey+ez*ez||1;
    for(const k of A){if(k===i||k===j||abs[k]>=0)continue;const t=((px[k]-px[i])*ex+(py[k]-py[i])*ey+(pz[k]-pz[i])*ez)/l2;if(t<=0||t>=1)continue;
      const qx=px[i]+ex*t-px[k],qy=py[i]+ey*t-py[k],qz=pz[i]+ez*t-pz[k];if(qx*qx+qy*qy+qz*qz<(rad(k)+SP*.1)**2)return true}
    for(const o of bonds){if(o.dead||o.a===i||o.a===j||o.b===i||o.b===j)continue;if(segDist(i,j,o.a,o.b)<SP*.16)return true}
    return false;
  }
  function strength(a,b,L){return K0*L*.22*(.6+.8*rnd())*(1+.06*(Math.min(m[a],m[b])-1))}
  function addBond(i,j,L){
    const q=ru();
    const bd={a:i,b:j,L,L0:L,k:K0,s:strength(i,j,L),age:0,u:0,T:0,su:0,sw:0,qx:q[0],qy:q[1],qz:q[2],dead:0,pend:0,gr:1,yt:-9};
    if(state===0)call('pluck',L);
    bonds.push(bd);bset.add(key(i,j));nb[i]++;nb[j]++;return bd;
  }
  function unlink(bd){if(bd.dead)return;bd.dead=1;cool.set(key(bd.a,bd.b),T+4);bset.delete(key(bd.a,bd.b));nb[bd.a]--;nb[bd.b]--}
  function brk(bd,kick){
    unlink(bd);const a=bd.a,b=bd.b,dx=px[b]-px[a],dy=py[b]-py[a],dz=pz[b]-pz[a],d=Math.hypot(dx,dy,dz)||1,ux=dx/d,uy=dy/d,uz=dz/d;
    const e=(.4+Math.min(2,Math.abs(bd.u)))*kick,sgn=bd.u>=0?1:-1,ia=e*sgn/Math.sqrt(m[a]),ib=e*sgn/Math.sqrt(m[b]);
    vx[a]-=ux*ia;vy[a]-=uy*ia;vz[a]-=uz*ia;vx[b]+=ux*ib;vy[b]+=uy*ib;vz[b]+=uz*ib;
    snaps.push({a,b,l:d,life:1,w:.9+6.5*Math.min(1.3,Math.abs(bd.u))});
    fat[a]+=.3;fat[b]+=.3;zap[a]=Math.max(zap[a],.7);zap[b]=Math.max(zap[b],.7);
    if(state===1){heat+=.01;colBroken++;
      for(const o of bonds)if(!o.dead&&!o.pend&&(o.a===a||o.b===a||o.a===b||o.b===b)&&rnd()<.04+.9*Math.min(1,o.su*o.su*1.2)){o.pend=T+.1+.18*rnd();pend.push(o)}}
    call('tick',state,(px[a]+px[b])/2,(py[a]+py[b])/2,(pz[a]+pz[b])/2);
  }

  /* a heavier node takes in a lighter one; the lighter one's links swing over to the absorber */
  function absorb(b,a,dur){
    if(abs[b]>=0||abs[a]>=0||!act[a]||!act[b])return;
    const nbrs=[];for(const o of bonds)if(!o.dead&&(o.a===b||o.b===b)){const c=o.a===b?o.b:o.a;if(c!==a)nbrs.push(c);unlink(o)}
    abs[b]=a;absT[b]=0;absD[b]=dur||.4;call('glide',rad(a));
    offx[b]=px[b]-px[a];offy[b]=py[b]-py[a];offz[b]=pz[b]-pz[a];
    for(const c of nbrs){if(abs[c]>=0||bset.has(key(a,c))||nb[a]>=MAXDEG+2||crossesAny(a,c))continue;
      const d=Math.hypot(px[c]-px[a],py[c]-py[a],pz[c]-pz[a]);if(d<SP*2.2)addBond(a,c,Math.max(d,gap(a,c)))}
  }

  /* a heavy node splits into fragments that fly out and can split other heavy nodes */
  function fission(i){
    fis[i]=0;const M=m[i];let k=cl(Math.round(M/2),2,12);
    shocks.push({x:px[i],y:py[i],z:pz[i],t:0,r0:rad(i),M});
    for(const o of bonds)if(!o.dead&&(o.a===i||o.b===i)){o.u=Math.sign(o.u||1)*Math.max(1,Math.abs(o.u));brk(o,2.4)}
    // fragments leave along evenly spread directions (a Fibonacci sphere in a random orientation)
    const u=ru();let w=ru();let vv=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];const vl=Math.hypot(...vv)||1;vv=vv.map(c=>c/vl);
    w=[u[1]*vv[2]-u[2]*vv[1],u[2]*vv[0]-u[0]*vv[2],u[0]*vv[1]-u[1]*vv[0]];
    const sp=1.5+.9*rnd(),v0x=vx[i],v0y=vy[i],v0z=vz[i],r0=rad(i);
    m[i]=M/k;frag[i]=1;zap[i]=1;lv[i]=0;
    for(let q=0;q<k;q++){
      const zz=1-2*(q+.5)/k,rr=Math.sqrt(1-zz*zz),an=q*2.39996+(rnd()-.5)*.3,a1=Math.cos(an)*rr,a2=Math.sin(an)*rr;
      const dx=u[0]*zz+vv[0]*a1+w[0]*a2,dy=u[1]*zz+vv[1]*a1+w[1]*a2,dz=u[2]*zz+vv[2]*a1+w[2]*a2;
      const s=sp/Math.sqrt(M/k)*(.8+.4*rnd()),ux=dx*s,uy=dy*s,uz=dz*s;
      if(q===0){vx[i]=v0x+ux;vy[i]=v0y+uy;vz[i]=v0z+uz;continue}
      const j=spawn(M/k,px[i]+dx*r0*1.5,py[i]+dy*r0*1.5,pz[i]+dz*r0*1.5,v0x+ux,v0y+uy,v0z+uz);
      if(j>=0){frag[j]=1;zap[j]=1;if(M/k>3)fis[j]=T+.2+.25*rnd()}else m[i]+=M/k}
    if(m[i]>3)fis[i]=T+.2+.25*rnd();
    call('pop',px[i],py[i],pz[i]);
  }

  /* ---------- fast phases ---------- */
  function heavyCut(){const ms=A.filter(i=>nb[i]>0).map(i=>m[i]).sort((p,q)=>q-p);return ms.length?ms[Math.min(ms.length-1,Math.max(2,Math.round(ms.length*.08)))]:99}
  function trigger(over){
    // the outcome follows from where the structure fails: an overloaded hub explodes
    const hubM=Math.max(3.5,heavyCut());let hit=-1;
    for(const b of over)for(const i of [b.a,b.b])if(act[i]&&m[i]>=hubM&&(hit<0||m[i]>m[hit]))hit=i;
    if(hit>=0)collapse(hit)
  }
  const heavyMass=()=>{let s=0;for(const i of A)if(act[i]&&m[i]>=2.5)s+=m[i];return s};
  function collapse(hit){state=1;fT=0;pend=[];col0=bonds.length;colBroken=0;hm0=heavyMass();hitTried.clear();ev={k:'collapse',t:T,x:px[hit]||0,y:py[hit]||0,z:pz[hit]||0};if(hit>=0)fission(hit)}
  // a revolution falls back to the start of its own slow phase; a deep one, which splits most of the heavy structure, also loses levels
  function disperse(){
    depth=hm0?cl(1-heavyMass()/hm0,0,1):1;const lost=depth>.75?level:depth>.45?1:0;
    state=2;heat=Math.max(heat,.6);level=Math.max(0,level-lost);Mth=Mth0;for(const i of A)lv[i]=Math.min(lv[i],level);ev={k:'disperse',t:T,depth,lost};
    for(const o of bonds)o.pend=0;pend=[];for(const i of A)fis[i]=0;
  }
  function bifurcate(){state=3;fT=0;quiet=0;bifEnd=-1;ev={k:'bifurcate',t:T};call('bif')}
  function linkHubs(){
    call('hubs');
    const hubs=A.filter(i=>act[i]&&abs[i]<0);
    for(const a of hubs){if(!act[a])continue;
      const o=hubs.filter(b=>b!==a&&act[b]).sort((p,q)=>Math.hypot(px[p]-px[a],py[p]-py[a],pz[p]-pz[a])-Math.hypot(px[q]-px[a],py[q]-py[a],pz[q]-pz[a]));
      for(let q=0;q<Math.min(4,o.length);q++){const b=o[q];if(bset.has(key(a,b))||crossesAny(a,b))continue;
        const d=Math.hypot(px[b]-px[a],py[b]-py[a],pz[b]-pz[a]),bd=addBond(a,b,Math.max(gap(a,b),Math.min(d,SP*1.6+rad(a)+rad(b))));bd.gr=0;bd.s*=2}}
  }

  /* ---------- physics ---------- */
  function forces(h){
    for(const i of A){fx[i]=0;fy[i]=0;fz[i]=0}
    const amp=.012+heat*.35,famp=state===2?.1*heat:.01,G=(state===1?.3+(2+70*Deff*Deff)*Math.max(0,1-1.6*colBroken/(col0||1)):state===2?.4:2+70*Deff*Deff)*GS,Rg=SP*2.4,s2=SP*SP*.3;
    const leak=(state===1||state===2)&&A.length>N,M=30;
    for(const i of A){if(abs[i]>=0)continue;
      const sm=Math.sqrt(m[i]);
      fx[i]+=(rnd()-.5)*amp*sm;fy[i]+=(rnd()-.5)*amp*sm;fz[i]+=(rnd()-.5)*amp*sm;
      if(nb[i]===0||state===2){const k=famp*m[i];
        fx[i]+=(Math.sin(py[i]*.009+T*.4)+Math.sin(pz[i]*.023-T*.7)*.5)*k;
        fy[i]+=(Math.cos(pz[i]*.008-T*.35)+Math.cos(px[i]*.021+T*.6)*.5)*k;
        fz[i]+=(Math.sin(px[i]*.0085+T*.3)+Math.cos(py[i]*.019-T*.5)*.5)*k}
      if(state===0||state===3){
        if(nb[i]>0){fx[i]-=px[i]*6e-5*m[i];fy[i]-=py[i]*6e-5*m[i];fz[i]-=pz[i]*6e-5*m[i]}
        else if(nBound>0){const dx=bcx-px[i],dy=bcy-py[i],dz=bcz-pz[i],d=Math.hypot(dx,dy,dz)||1;fx[i]+=dx/d*.012*m[i];fy[i]+=dy/d*.012*m[i];fz[i]+=dz/d*.012*m[i]}
      }
      if(!leak){const r=Math.hypot(px[i],py[i],pz[i]);if(r>R-M){const f=(r-R+M)*.01*m[i]/r;fx[i]-=px[i]*f;fy[i]-=py[i]*f;fz[i]-=pz[i]*f}}
    }
    for(let p=0;p<A.length;p++){const i=A[p];if(abs[i]>=0)continue;
      for(let q=p+1;q<A.length;q++){const j=A[q];if(abs[j]>=0)continue;
        const dx=px[j]-px[i],dy=py[j]-py[i],dz=pz[j]-pz[i],d2=dx*dx+dy*dy+dz*dz;if(d2>Rg*Rg)continue;
        const d=Math.sqrt(d2)||.01,rr=gap(i,j);let f=0;
        if(d<rr)f-=(rr-d)*.25*(m[i]*m[j])/(m[i]+m[j]);
        f+=G*m[i]*m[j]/(d2+s2)*(1-d/Rg)*1.5;f/=d;
        fx[i]+=dx*f;fy[i]+=dy*f;fz[i]+=dz*f;fx[j]-=dx*f;fy[j]-=dy*f;fz[j]-=dz*f;
      }}
    // links push nodes out of their way, so a link never runs through a node
    if(state===0||state===3)for(const o of bonds){if(o.dead)continue;const a=o.a,b=o.b,ex=px[b]-px[a],ey=py[b]-py[a],ez=pz[b]-pz[a],l2=ex*ex+ey*ey+ez*ez||1;
      for(const i of A){if(i===a||i===b||abs[i]>=0)continue;const t=((px[i]-px[a])*ex+(py[i]-py[a])*ey+(pz[i]-pz[a])*ez)/l2;if(t<=0||t>=1)continue;
        const qx=px[a]+ex*t-px[i],qy=py[a]+ey*t-py[i],qz=pz[a]+ez*t-pz[i],d=Math.hypot(qx,qy,qz)||.01,lim=rad(i)+SP*.16;if(d>=lim)continue;
        const f=(lim-d)*.08*m[i],nx=qx/d*f,ny=qy/d*f,nz=qz/d*f;fx[i]-=nx;fy[i]-=ny;fz[i]-=nz;
        fx[a]+=nx*(1-t);fy[a]+=ny*(1-t);fz[a]+=nz*(1-t);fx[b]+=nx*t;fy[b]+=ny*t;fz[b]+=nz*t}}
    for(const bd of bonds){if(bd.dead)continue;const a=bd.a,b=bd.b;
      const dx=px[b]-px[a],dy=py[b]-py[a],dz=pz[b]-pz[a],d=Math.hypot(dx,dy,dz)||.01,Tn=bd.k*(d-bd.L)*bd.gr,f=Tn/d;
      bd.T=Tn;bd.u=Tn/bd.s;fx[a]+=dx*f;fy[a]+=dy*f;fz[a]+=dz*f;fx[b]-=dx*f;fy[b]-=dy*f;fz[b]-=dz*f}
    for(const i of A){
      if(abs[i]>=0){const a=abs[i],e=1-sstep(absT[i]/absD[i]);px[i]=px[a]+offx[i]*e;py[i]=py[a]+offy[i]*e;pz[i]=pz[a]+offz[i]*e;vx[i]=vx[a];vy[i]=vy[a];vz[i]=vz[a];continue}
      const dm=Math.pow(state===2?.975+.015*Math.min(1,heat):state===1?(nb[i]>0?.93:.99):(nb[i]>0?.93:.975),h);
      vx[i]=(vx[i]+fx[i]/m[i]*h)*dm;vy[i]=(vy[i]+fy[i]/m[i]*h)*dm;vz[i]=(vz[i]+fz[i]/m[i]*h)*dm;
      const sp=vx[i]*vx[i]+vy[i]*vy[i]+vz[i]*vz[i];if(sp>324){const s=18/Math.sqrt(sp);vx[i]*=s;vy[i]*=s;vz[i]*=s}
      px[i]+=vx[i]*h;py[i]+=vy[i]*h;pz[i]+=vz[i]*h;
      if(!leak){const r=Math.hypot(px[i],py[i],pz[i]);if(r>R-2){const ux=px[i]/r,uy=py[i]/r,uz=pz[i]/r,s=(R-2)/r;px[i]*=s;py[i]*=s;pz[i]*=s;
        const vr=vx[i]*ux+vy[i]*uy+vz[i]*uz;if(vr>0){vx[i]-=1.5*vr*ux;vy[i]-=1.5*vr*uy;vz[i]-=1.5*vr*uz}}}
    }
  }

  function step(dt){
    const K=dt*60;T+=dt;
    A=[];for(let i=0;i<NM;i++)if(act[i])A.push(i);
    bcx=0;bcy=0;bcz=0;let mw=0;for(const i of A)if(nb[i]>0){bcx+=px[i]*m[i];bcy+=py[i]*m[i];bcz+=pz[i]*m[i];mw+=m[i]}
    nBound=mw;if(mw){bcx/=mw;bcy/=mw;bcz/=mw}
    const sub=Math.min(24,Math.max(2,Math.ceil(K/.4)));for(let q=0;q<sub;q++)forces(K/sub);
    for(const i of A)if(arr[i]){if(Math.hypot(px[i],py[i],pz[i])<R-rad(i)-6)arr[i]=0}
    // absorptions in progress
    for(const i of A)if(abs[i]>=0){const a=abs[i];absT[i]+=dt;
      if(!act[a]){abs[i]=-1;continue}
      if(absT[i]>=absD[i]){m[a]+=m[i];zap[a]=Math.max(zap[a],.5);kill(i)}}
    // nodes lost beyond the boundary during the catastrophe
    if(state===1||state===2)for(const i of A)if(act[i]&&A.length>N&&Math.hypot(px[i],py[i],pz[i])>R+50)kill(i);
    // link life
    sig.fill(0);let su=0,nu=0;
    for(const bd of bonds){if(bd.dead)continue;const a=bd.a,b=bd.b,u=bd.u;
      if(state===0){
        bd.age+=dt;bd.k=K0*(1+Math.min(1.4,bd.age/12));
        const Lm=gap(a,b)*.75,c=.18*D*(1-2*brake);
        bd.L=c>=0?Math.max(Lm,bd.L-(bd.L-Lm)*c*dt):bd.L+(Math.max(bd.L0,Lm)-bd.L)*Math.min(1,-c*dt);
        // links never break while the structure grows: an overloaded link yields (its rest length gives way so the load holds at the limit),
        // and the stress it carries waits for the collapse
        if(u>1||u<-1.4){const d=Math.hypot(px[b]-px[a],py[b]-py[a],pz[b]-pz[a]),kg=bd.k*bd.gr||K0;
          bd.L=u>1?d-bd.s/kg:d+1.4*bd.s/kg;bd.u=u>1?1:-1.4;bd.yt=T}
        // slow consumption: a much heavier node occasionally takes in a light neighbour
        const hv=m[a]>m[b]?a:b,lt=hv===a?b:a;
        if(m[hv]>1.8*m[lt]&&T-lastAbs>.25&&rnd()<dt*(.1+.8*bd.su*bd.su)){lastAbs=T;absorb(lt,hv,.35);continue}
      }else if(state===1){
        if(bd.pend&&T>=bd.pend){bd.u=Math.sign(u||1)*Math.max(.8,Math.abs(u));brk(bd,2.4);continue}
        const ue=u/Math.max(.15,1-.45*Math.min(1,fat[a]+fat[b]));if(ue>1.12||ue<-1.55){brk(bd,1.5);continue}
      }else if(state===3){
        const d=Math.hypot(px[b]-px[a],py[b]-py[a],pz[b]-pz[a]);
        if(bd.gr<1)bd.gr=Math.min(1,bd.gr+dt/.5);else bd.L+=(Math.max(Math.min(d,SP*1.6+rad(a)+rad(b)),gap(a,b)*.9)-bd.L)*Math.min(1,dt*2.5);bd.age=0;bd.k=K0;
      }else{bd.s*=Math.exp(-dt*.5);if(u>1||u<-1.4||rnd()<.015*K){brk(bd,1);continue}}
      const au=Math.abs(bd.u);sig[a]=Math.max(sig[a],au);sig[b]=Math.max(sig[b],au);su+=au;nu++;
      bd.su+=(au-bd.su)*Math.min(1,dt*6);bd.sw+=(Math.abs(bd.T)-bd.sw)*Math.min(1,dt*6);
    }
    {const seen=new Set();bonds=bonds.filter(b=>{if(b.dead)return false;
      if(!act[b.a]||!act[b.b]||abs[b.a]>=0||abs[b.b]>=0||b.a===b.b){unlink(b);return false}
      const k=key(b.a,b.b);if(seen.has(k)){b.dead=1;nb[b.a]--;nb[b.b]--;return false}seen.add(k);return true})}
    sigma=nu?su/nu:0;
    // the load signal the structure regulates on: the load its most stressed links carry (97th percentile)
    if(bonds.length){const q=bonds.map(o=>o.su).sort((p,q)=>p-q);sigQ=q[Math.floor(q.length*.97)]}else sigQ=0;
    // new links: two nodes in contact link, unless the link would run through a node or graze another link (a pair that just broke waits 4 s)
    if(state===0&&heat<.35){
      for(let p=0;p<A.length;p++){const i=A[p];if(abs[i]>=0||arr[i]||nb[i]>=MAXDEG)continue;
        for(let q=p+1;q<A.length;q++){const j=A[q];if(abs[j]>=0||arr[j]||nb[j]>=MAXDEG)continue;
          const dx=px[j]-px[i],dy=py[j]-py[i],dz=pz[j]-pz[i],d=Math.hypot(dx,dy,dz);if(d>gap(i,j)*1.35)continue;
          const kk=key(i,j);if(bset.has(kk)||(cool.get(kk)||0)>T||crossesAny(i,j))continue;
          addBond(i,j,Math.max(d*.97,gap(i,j)));if(nb[i]>=MAXDEG)break}}
    }
    // fresh small elements keep arriving while the body grows
    if(state===0&&A.length<N&&rnd()<dt*(A.length<N*.6?6:1.6))spawnEdge();
    // phases
    if(state===0){
      // might grows superlinearly, so its relative growth rate rises through the phase
      const sp=1+.4*level,gr=.083*sp*Math.pow(.35+D,1.5);D=Math.min(3+.3*level,D+gr*dt);heat-=heat*dt/1.2;
      // the structure brakes its own contraction from the load of its most stressed links, seen tauD late; the regulator's rate k keeps pace with growth,
      // so D = k·tauD rises with complexity and the loop loses stability near π/2 (Hayes)
      // complexity = total link stiffness per node: links multiply and harden as they age
      {let ks=0;for(const o of bonds)ks+=o.k;tauD=TAU0*Math.pow(Math.max(.2,ks/(K0*N*2)),GAM)/sp}
      kG=KG*gr/(.35+D);
      hist.push(T,sigQ);while(hist.length>2&&hist[0]<T-12)hist.splice(0,2);
      {let j=0;while(j+2<hist.length&&hist[j+2]<=T-tauD)j+=2;sigHat=hist[j+1]}
      brake=cl(brake+dt*kG*(sigHat-SIG0)/SIG0,0,1);
      {let big=-1;for(const i of A)if(abs[i]<0&&m[i]>=Mth&&(big<0||m[i]>m[big]))big=i;if(big>=0)bifurcate()}
      if(state===0&&D>.45){const over=bonds.filter(o=>T-o.yt<.5);if(over.length>=Math.max(3,bonds.length*.1))trigger(over)}
      // safety net: a slow phase that neither tears nor consolidates within 80 s ends at its heaviest node (does not happen in normal runs)
      else if(state===0&&T-gT>80){let mi=-1;for(const i of A)if(abs[i]<0&&(mi<0||m[i]>m[mi]))mi=i;if(mi>=0)collapse(mi)}
    }else if(state===1){
      fT+=dt;pend=pend.filter(o=>!o.dead);
      // a fragment that reaches a heavy node can split it too: surely if the node is loaded, rarely if it is relaxed (one try per pair)
      for(const f of A){if(frag[f]<.5||abs[f]>=0)continue;
        for(const j of A){if(j===f||m[j]<2.2||fis[j]||frag[j]>.2||abs[j]>=0)continue;
          if(Math.hypot(px[j]-px[f],py[j]-py[f],pz[j]-pz[f])<gap(f,j)*1.05){const kk=key(f,j);if(hitTried.has(kk))continue;hitTried.add(kk);
            if(rnd()<.04+.9*sig[j]*sig[j])fis[j]=T+.08+.14*rnd()}}}
      for(const i of A)if(fis[i]&&T>=fis[i]&&act[i])fission(i);
      let live=pend.length>0;for(const i of A)if(fis[i])live=true;
      if(!live&&fT>1.5||fT>8)disperse();
    }else if(state===3){
      fT+=dt;heat-=heat*dt/1.2;
      if(bifEnd<0){
        let ate=false;const dev=A.filter(i=>abs[i]<0&&m[i]>=Mth*.5).sort((p,q)=>m[q]-m[p]);
        for(const d of dev){if((nextEat.get(d)||0)>T||abs[d]>=0||m[d]>Mth*2)continue;
          let best=-1,bd=1e9;const r=reach(d);
          for(const j of A){if(j===d||abs[j]>=0||arr[j]||m[j]*1.5>m[d]||m[j]>Mth*.35)continue;let busy=false;for(const k of A)if(abs[k]===j){busy=true;break}if(busy)continue;
            const dd=Math.hypot(px[j]-px[d],py[j]-py[d],pz[j]-pz[d]);if(dd<r&&dd<bd){bd=dd;best=j}}
          if(best>=0){absorb(best,d,.15+bd/SP*.08);nextEat.set(d,T+.1);ate=true}}
        quiet=ate?0:quiet+dt;
        if(quiet>.4&&A.every(i=>abs[i]<0)){linkHubs();bifEnd=fT;
          // rescale: the new hubs become the units of the next level, so masses are compressed back toward the starting range
          let mx=0;for(const i of A)mx=Math.max(mx,m[i]);const tgt=Mth*.45,pw=mx>tgt?Math.log(tgt)/Math.log(mx):1;
          for(const i of A){mT[i]=m[i]>1?Math.pow(m[i],pw):m[i];if(m[i]>2)lv[i]=Math.min(3,lv[i]+1)}}
      }else{const q=Math.min(1,dt*4);for(const i of A)if(mT[i]>0)m[i]+=(mT[i]-m[i])*q;
        if(fT-bifEnd>.8){for(const i of A){if(mT[i]>0)m[i]=mT[i];mT[i]=0}state=0;D=.15;brake=0;hist.length=0;gT=T;level++;ev={k:'level',t:T}}}
    }else{
      heat-=heat*dt/3.2;
      if(heat<.3&&!bonds.length){state=0;D=0;brake=0;hist.length=0;gT=T;ev={k:'grow',t:T}}
    }
    if(state===0)Deff=D*(1-brake);else if(state===3)Deff=D;   // held through a collapse: the intact part stays bound
    if(state===0){let hot=0;for(const b of bonds)if(Math.abs(b.u)>.75)hot++;if(hot)call('creak',hot)}
    for(const i of A){fat[i]*=Math.exp(-dt*1.5);zap[i]*=Math.exp(-dt*6);frag[i]*=Math.exp(-dt*.6)}
    for(let i=snaps.length-1;i>=0;i--){snaps[i].life-=dt*2.2;if(snaps[i].life<=0||!act[snaps[i].a]||!act[snaps[i].b])snaps.splice(i,1)}
    for(let i=shocks.length-1;i>=0;i--){shocks[i].t+=dt;if(shocks[i].t>1.1)shocks.splice(i,1)}
  }

  return {N,NM,SP,R,K0,px,py,pz,vx,vy,vz,m,sig,fat,zap,frag,abs,absT,absD,nb,act,arr,lv,born,snaps,shocks,rad,reach,step,
    view:()=>({A,bonds,state,D,heat,level,Mth,T,sigma,bcx,bcy,bcz,nBound,ev,pend:pend.length,
      brake,Deff,tauD,kG,Dk:kG*tauD,sigHat,sigQ,depth})};
}
