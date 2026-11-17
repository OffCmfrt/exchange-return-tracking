
'use strict';
/* ============ constants ============ */
const STAGES=['Idea','Research','Concept Development','Design','Tech Pack','Sampling','Fit & Quality Review','Costing & Approval','Production Ready','In Production','Quality Inspection','Launch Ready','Launched','Archived / Cancelled'];
const S_LAUNCHED=12,S_ARCHIVED=13;
const DEPTS=['Comfort Dept','Training Dept','Raw Dept'];
const PRIORITIES=['P1','P2','P3'];
const MS_TYPES=[
  ['concept','Concept approval'],['design','Design completion'],['firstSample','First sample'],['sampleApproval','Sample approval'],
  ['techFreeze','Tech-pack freeze'],['costApproval','Cost approval'],['handover','Production handover'],['bulk','Bulk completion'],
  ['finalQC','Final QC'],['release','Target release']];
const MS_LABEL=Object.fromEntries(MS_TYPES);
const MS_ORDER=MS_TYPES.map(m=>m[0]);
const AP_TYPES=[
  ['technical','Technical approval','Product Lead',['lead']],
  ['creative','Creative approval','Founder / Creative Director',['founder']],
  ['commercial','Cost / commercial approval','Finance or Operations',['ops','founder']],
  ['handover','Manufacturing handover','COO / Operations',['ops']],
  ['bulkqc','Bulk QC approval','Authorised QC owner',['ops','lead']]];
const AP=Object.fromEntries(AP_TYPES.map(a=>[a[0],{label:a[1],who:a[2],roles:a[3]}]));
const GATES={8:['technical','creative','commercial'],9:['handover'],11:['bulkqc']};
const ROLES={founder:'Founder / Creative Director',lead:'Product Lead',member:'Product Team Member',ops:'COO / Operations',marketing:'CMO / Marketing'};
const LOCKED_FIELDS=['fabric','colorways','gsm','composition','washCare','construction','estCost','mrp'];
const COLLS=['products','milestones','tasks','approvals','activity','config','samples','fabrics','trims','suppliers','ideas','costsheets','qc','hires','expenses','experiments'];
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ============ helpers ============ */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clone=o=>JSON.parse(JSON.stringify(o));
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const TODAY=iso(new Date());
const addDays=(s,n)=>{const d=parseD(s);d.setDate(d.getDate()+n);return iso(d)};
const diffD=(a,b)=>Math.round((parseD(b)-parseD(a))/864e5);
const fmtD=s=>{if(!s)return '—';const d=parseD(s);return `${d.getDate()} ${MON[d.getMonth()]}`+(d.getFullYear()!==parseD(TODAY).getFullYear()?` ’${String(d.getFullYear()).slice(2)}`:'')};
const fmtTs=ts=>{const d=new Date(ts);return `${d.getDate()} ${MON[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`};
const inr=n=>(n===''||n==null||isNaN(n))?'—':'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
const num=v=>(v===''||v==null)?null:Number(v);
const relDays=s=>{const n=diffD(TODAY,s);if(n===0)return 'today';if(n===1)return 'tomorrow';if(n===-1)return 'yesterday';return n>0?`in ${n} days`:`${-n} days late`};
const monthStart=s=>s.slice(0,8)+'01';
const addMonths=(s,n)=>{const d=parseD(monthStart(s));d.setMonth(d.getMonth()+n);return iso(d)};
const weekStart=s=>{const d=parseD(s);const k=(d.getDay()+6)%7;d.setDate(d.getDate()-k);return iso(d)};
const initials=n=>String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();

/* ============ app state ============ */
const D={};COLLS.forEach(c=>D[c]={});
const S={
  route:'overview',param:null,
  pipeView:localStorage.getItem('ofc-pipeview')||'kanban',
  f:{q:'',dept:'',coll:'',stage:'',owner:'',month:'',pri:''},
  sort:{k:'updatedAt',d:-1},
  tab:'overview',
  rm:{view:'90',start:'2026-11-01',month:monthStart(TODAY),dept:'',coll:''},
  tasks:{scope:'mine',status:'open',who:'',q:''},
  lib:{q:'',dept:'',status:''},
  pulse:{week:weekStart(TODAY),founder:false},
  me:localStorage.getItem('ofc-me')||'p-lead',
  readOnly:false
};
const Lab={token:localStorage.getItem('ofc-lab-token')||'',since:null,timer:null,offline:false,loginMsg:'',mock:new URLSearchParams(location.search).has('mock')};
if(Lab.mock){try{localStorage.setItem('ofc-mode','demo')}catch(e){}}
const Store={mode:localStorage.getItem('ofc-mode')||'live',backend:null,ready:false,chains:{},pending:{}};
if(Lab.mock)Store.mode='demo';

/* ============ storage ============ */
function defaultConfig(){return {id:'main',people:[{id:'p-founder',name:'Founder',role:'founder'},{id:'p-lead',name:'Product Lead',role:'lead'}],collections:[],company:'OFFCOMFRT',currency:'INR'}}
function cfg(){return D.config.main||defaultConfig()}
function localKey(){return 'ofc-ws-'+Store.mode}
function loadLocal(){
  let raw=null;try{raw=JSON.parse(localStorage.getItem(localKey())||'null')}catch(e){}
  COLLS.forEach(c=>D[c]=(raw&&raw[c])||{});
  if(Store.mode==='demo'&&(!raw||!Object.keys(D.products).length||raw.v!==DATA_V)){COLLS.forEach(c=>D[c]={});seedDemo();saveLocal()}
}
let saveT=null;
function saveLocal(){clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem(localKey(),JSON.stringify(Object.assign({v:DATA_V},D)))}catch(e){toast('This browser’s storage is full. Remove large images or export a backup.')}},120)}
/* ---- live workspace: REST snapshot + delta polling against /api/product-lab ---- */
function labErr(status,msg){const e=new Error(msg||('HTTP '+status));e.status=status;return e}
async function labApi(path,opts){
  opts=opts||{};
  const r=await fetch('/api/product-lab'+path,Object.assign({},opts,{headers:Object.assign({'Content-Type':'application/json'},Lab.token?{Authorization:'Bearer '+Lab.token}:{})}));
  if(r.status===401){
    Lab.token='';try{localStorage.removeItem('ofc-lab-token')}catch(e){}
    if(Lab.timer){clearInterval(Lab.timer);Lab.timer=null}
    Store.backend='login';Store.ready=true;Lab.loginMsg='Your sign-in expired. Sign in again to sync.';render();
    throw labErr(401,'unauthorized');
  }
  if(!r.ok){let msg='';try{msg=(await r.json()).error||''}catch(e){}throw labErr(r.status,msg)}
  return r.json();
}
function showLabLogin(){Store.backend='login';Store.ready=true;Lab.loginMsg='';render()}
function renderLabLogin(){
  $('#main').innerHTML=`<div class="loading"><div style="width:min(340px,90vw);text-align:left">
    <div class="wordmark" style="margin-bottom:6px">OFFCOMFRT</div>
    <div class="tiny muted" style="margin-bottom:14px">Product Lab — this workspace is password-protected.</div>
    <form id="lablogin"><div class="field"><input class="inp" type="password" id="labpw" placeholder="Workspace password" autocomplete="current-password"></div>${Lab.loginMsg?`<div class="err" style="margin-top:6px">${esc(Lab.loginMsg)}</div>`:''}
    <div class="qa" style="margin-top:12px"><button class="btn pri" type="submit">Sign in</button><button class="btn" type="button" data-act="setmode" data-mode="demo">Open demo instead</button></div></form>
  </div></div>`;
  const f=$('#lablogin');
  f.addEventListener('submit',async e=>{
    e.preventDefault();const pw=$('#labpw').value;const b=f.querySelector('button[type=submit]');
    if(b){b.disabled=true;b.textContent='Signing in…'}
    try{
      const r=await fetch('/api/product-lab/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
      let d={};try{d=await r.json()}catch(x){}
      if(!r.ok||!d.token){Lab.loginMsg=d.error||'That password doesn’t match.';renderLabLogin();return}
      Lab.token=d.token;try{localStorage.setItem('ofc-lab-token',Lab.token)}catch(x){}
      Store.backend=null;initStore();
    }catch(err){Lab.loginMsg='Cannot reach the server. Try again.';renderLabLogin()}
  });
  const i=$('#labpw');if(i)i.focus();
}
async function initStore(){
  Store.ready=false;
  if(Lab.timer){clearInterval(Lab.timer);Lab.timer=null}
  COLLS.forEach(c=>D[c]={});
  if(Store.mode==='demo'){Store.backend='local';loadLocal();Store.ready=true;render();return}
  if(!Lab.token){showLabLogin();return}
  Store.backend=null;render();
  try{
    const snap=await labApi('/snapshot');
    COLLS.forEach(c=>{D[c]=snap.collections[c]||{}});
    Lab.since=snap.since||new Date().toISOString();Lab.offline=false;
    Store.backend='db';Store.ready=true;render();
    if(Lab.timer)clearInterval(Lab.timer);
    Lab.timer=setInterval(labPoll,10000);
  }catch(e){
    Store.ready=true;
    if(e.status!==401){Lab.offline=true;Store.backend='local';render();toast('Live workspace unreachable ('+(e.message||'error')+'). Changes are kept in this browser until it responds.')}
  }
}
async function labPoll(){
  if(Store.mode!=='live'||Store.backend!=='db'||!Lab.since)return;
  try{
    const ch=await labApi('/changes?since='+encodeURIComponent(Lab.since));
    let touched=false;const skip=k=>(Store.pending[k]||0)>0;
    Object.entries(ch.upserts||{}).forEach(([c,m])=>Object.entries(m).forEach(([id,rec])=>{if(!skip(c+'/'+id)){D[c][id]=rec;touched=true}}));
    Object.entries(ch.deletes||{}).forEach(([c,ids])=>ids.forEach(id=>{if(!skip(c+'/'+id)){delete D[c][id];touched=true}}));
    Lab.since=ch.since||Lab.since;Lab.offline=false;
    if(touched)scheduleRender();
  }catch(e){
    if(e.status===401)return;
    Lab.offline=true;scheduleRender();
  }
}
function labWriteErr(e){
  if(e&&e.status===401)return;
  if(e&&e.status===503)toast('The server has no workspace password configured yet, so this change stayed in this browser.');
  else if(e&&e.status===429)toast('Too many changes at once. Wait a moment and try again.');
  else toast('Couldn’t save that change ('+(e&&e.message||'error')+').');
}
function put(c,rec){
  if(S.readOnly){toast('This workspace is read-only for you.');return}
  rec=clone(rec);D[c][rec.id]=rec;scheduleRender();
  if(Store.backend==='db'){
    const key=c+'/'+rec.id;
    Store.pending[key]=(Store.pending[key]||0)+1;
    Store.chains[key]=(Store.chains[key]||Promise.resolve()).then(()=>labApi('/record',{method:'PUT',body:JSON.stringify({collection:c,record:rec})})).catch(labWriteErr).finally(()=>{Store.pending[key]--});
  }else saveLocal();
}
function del(c,id){
  if(S.readOnly){toast('This workspace is read-only for you.');return}
  delete D[c][id];scheduleRender();
  if(Store.backend==='db'){
    const key=c+'/'+id;
    Store.pending[key]=(Store.pending[key]||0)+1;
    Store.chains[key]=(Store.chains[key]||Promise.resolve()).then(()=>labApi('/record',{method:'DELETE',body:JSON.stringify({collection:c,id})})).catch(labWriteErr).finally(()=>{Store.pending[key]--});
  }else saveLocal();
}
function putConfig(c){c.id='main';put('config',c)}
function log(text,pid,kind,extra){const a=Object.assign({id:uid(),ts:new Date().toISOString(),pid:pid||null,by:S.me,text,kind:kind||'note'},extra||{});put('activity',a)}

/* ============ people & roles ============ */
const people=()=>cfg().people||[];
const person=id=>people().find(p=>p.id===id);
const pname=id=>(person(id)||{}).name||'Unassigned';
const me=()=>person(S.me)||people()[0]||{id:'',name:'—',role:'lead'};
const myRole=()=>me().role;
function canEdit(){if(S.readOnly)return false;return ['founder','lead','member'].includes(myRole())}
function guardEdit(){if(canEdit())return true;toast(S.readOnly?'This workspace is read-only for you.':`Acting as ${ROLES[myRole()]}: you can view this, but editing products belongs to the product team.`);return false}

/* ============ derived data ============ */
const products=()=>Object.values(D.products);
const prod=id=>D.products[id];
const isActive=p=>p.stage<S_LAUNCHED;
const msFor=pid=>Object.values(D.milestones).filter(m=>m.pid===pid).sort((a,b)=>MS_ORDER.indexOf(a.type)-MS_ORDER.indexOf(b.type));
const msOf=(pid,type)=>Object.values(D.milestones).find(m=>m.pid===pid&&m.type===type);
const releaseDate=pid=>{const m=msOf(pid,'release');return m&&m.target||''};
const tasksFor=pid=>Object.values(D.tasks).filter(t=>t.pid===pid);
const apFor=(pid,type)=>D.approvals[pid+'--'+type]||{id:pid+'--'+type,pid,type,status:'none',history:[]};
function requiredFor(stage){let r=[];Object.keys(GATES).forEach(k=>{if(stage>=+k&&stage!==S_ARCHIVED)r=r.concat(GATES[k])});return r}
function missingApprovals(pid,stage){return requiredFor(stage).filter(t=>apFor(pid,t).status!=='approved')}
function msState(m,risk){if(m.done)return 'done';if(!m.target)return 'unset';if(m.target<TODAY)return 'overdue';if(risk&&risk[m.id])return 'risk';return 'planned'}
function riskFor(pid){
  const ms=msFor(pid);const risk={},conflicts=[];let trigger=null,prev=null;
  ms.forEach(m=>{
    if(m.done){prev=m.target||prev;return}
    if(trigger&&m.target)risk[m.id]=trigger;
    const slipped=m.baseline&&m.target&&m.target>m.baseline;
    if(!trigger&&m.target&&(m.target<TODAY||slipped))trigger={id:m.id,type:m.type,label:MS_LABEL[m.type],late:m.target<TODAY,slip:slipped?diffD(m.baseline,m.target):0};
    if(m.target&&prev&&m.target<prev)conflicts.push(m);
    if(m.target)prev=m.target;
  });
  return {risk,conflicts,trigger};
}
function nextMs(pid){return msFor(pid).filter(m=>!m.done&&m.target).sort((a,b)=>a.target<b.target?-1:1)[0]}
function progress(pid){const ms=msFor(pid);return {done:ms.filter(m=>m.done).length,total:ms.length}}
function margin(p){const m=num(p.mrp),c=num(p.estCost);if(!m||c==null)return null;return (m-c)/m*100}
function commitment(p){
  const nm=nextMs(p.id);
  const req=requiredFor(Math.max(p.stage,8));
  const path=req.map(t=>apFor(p.id,t).status);
  return {owner:!!p.owner&&!!person(p.owner),stage:true,next:!!(p.nextAction||'').trim(),ms:!!nm,approval:path.some(s=>s!=='none')||p.stage<5};
}
const committed=p=>p.stage>=2&&p.stage<S_LAUNCHED;
function allOverdue(){return Object.values(D.milestones).filter(m=>!m.done&&m.target&&m.target<TODAY&&prod(m.pid)&&isActive(prod(m.pid)))}
function pendingApprovals(){return Object.values(D.approvals).filter(a=>a.status==='pending'&&prod(a.pid))}

/* ============ KPIs (every value derived from records) ============ */
function kpis(){
  const ps=products(),act=ps.filter(isActive);
  const in90=addDays(TODAY,60);
  return [
    {k:'active',v:act.length,l:'Active products',f:'All stages before Launched',go:{}},
    {k:'research',v:ps.filter(p=>p.stage<=1).length,l:'Idea & research',f:'Stages 01–02',go:{stage:'0-1'}},
    {k:'design',v:ps.filter(p=>p.stage>=2&&p.stage<=4).length,l:'In design',f:'Concept, Design, Tech Pack',go:{stage:'2-4'}},
    {k:'sampling',v:ps.filter(p=>p.stage===5||p.stage===6).length,l:'Under sampling',f:'Sampling and Fit & Quality',go:{stage:'5-6'}},
    {k:'approved',v:ps.filter(p=>p.stage>=8&&p.stage<=11&&!missingApprovals(p.id,p.stage).length).length,l:'Approved for production',f:'Stages 09–12 with all gate approvals valid',go:{stage:'8-11'}},
    {k:'releases',v:act.filter(p=>{const r=releaseDate(p.id);return r&&r>=TODAY&&r<=in90}).length,l:'Releases in 60 days',f:'Target release within 60 days',go:{route:'roadmap'}},
    {k:'overdue',v:allOverdue().length,l:'Overdue milestones',f:'Open milestones past target date',go:{route:'roadmap'},alert:true},
    {k:'pending',v:pendingApprovals().length,l:'Pending approvals',f:'Requested, not yet decided',go:{anchor:'decisions'},alert:true}];
}

/* ============ mutations ============ */
function newProduct(data){
  const now=new Date().toISOString();
  const p=Object.assign({id:uid(),code:'',name:'',dept:DEPTS[0],category:'',collection:'',season:'',owner:'p-lead',priority:'P2',stage:0,image:'',fabric:'',colorways:'',gsm:'',composition:'',washCare:'',construction:'',mrp:'',estCost:'',targetMargin:'',nextAction:'',blockers:'',notes:'',refs:[],rev:1,revisions:[],createdAt:now,updatedAt:now},data);
  return p;
}
function ensureMilestones(pid){MS_ORDER.forEach(t=>{if(!msOf(pid,t))put('milestones',{id:uid(),pid,type:t,target:'',baseline:'',done:'',note:''})})}
function setMsDate(pid,type,date){
  ensureMilestones(pid);const m=clone(msOf(pid,type));const old=m.target;
  m.target=date||'';if(!m.baseline&&date)m.baseline=date;
  put('milestones',m);
  if(old!==m.target)log(`${MS_LABEL[type]} ${old?`moved from ${fmtD(old)} to ${fmtD(date)}`:`set for ${fmtD(date)}`}`,pid,'milestone');
  return m;
}
function moveStage(pid,to,silent){
  const p=prod(pid);if(!p||p.stage===to)return true;
  if(!guardEdit())return false;
  const miss=missingApprovals(pid,to);
  if(miss.length&&to>p.stage){openModal({kind:'gate',pid,to,miss});return false}
  const q=clone(p);const from=q.stage;q.stage=to;q.updatedAt=new Date().toISOString();put('products',q);
  log(`Moved from ${STAGES[from]} to ${STAGES[to]}`,pid,'stage',{from,to});
  if(!silent)toast(`${p.code} moved to ${STAGES[to]}`);
  return true;
}
function decideApproval(pid,type,action,note){
  const a=clone(apFor(pid,type));const now=new Date().toISOString();
  if(action==='request'){a.status='pending';a.requestedAt=now;a.requestedBy=S.me}
  else{
    if(!AP[type].roles.includes(myRole())){toast(`Only ${AP[type].who} can decide ${AP[type].label.toLowerCase()}.`);return}
    a.status=action;a.decidedAt=now;a.decidedBy=S.me;a.note=note||''}
  a.history=(a.history||[]).concat([{ts:now,by:S.me,action,note:note||''}]);
  put('approvals',a);
  const p=prod(pid);const word={request:'requested',approved:'approved',rejected:'returned with changes'}[action];
  log(`${AP[type].label} ${word}${note?`: “${note}”`:''}`,pid,'approval',{atype:type,action});
  toast(`${AP[type].label} ${word} for ${p?p.code:''}`);
}

/* ============ demo seed (fictional; lives only in the demo workspace) ============ */
function seedDemo(){
  const T=TODAY,d=n=>addDays(T,n);
  D.config.main=Object.assign(defaultConfig(),{collections:[
    {id:'c-w26',name:'Winter Layers',season:'Winter 2026',start:'2026-11-01',end:'2027-01-31',note:'Demo collection'},
    {id:'c-ss27',name:'Spring Movement',season:'Spring 2027',start:'2027-02-01',end:'2027-04-30',note:'Demo collection'}]});
  const mk=(o,ms,ap)=>{const p=newProduct(o);p.updatedAt=new Date(Date.now()-Math.random()*6*864e5).toISOString();D.products[p.id]=p;
    MS_ORDER.forEach((t,i)=>{const v=ms[i];const m={id:uid(),pid:p.id,type:t,target:'',baseline:'',done:'',note:''};
      if(v!=null){if(Array.isArray(v)){m.target=d(v[0]);m.baseline=d(v[1]);}else{m.target=d(v);m.baseline=d(v)}}
      D.milestones[m.id]=m});
    (ap||[]).forEach(([t,s])=>{D.approvals[p.id+'--'+t]={id:p.id+'--'+t,pid:p.id,type:t,status:s,requestedAt:new Date().toISOString(),requestedBy:'p-lead',decidedAt:s!=='pending'?new Date().toISOString():'',decidedBy:s==='approved'?(AP[t].roles[0]==='founder'?'p-founder':'p-lead'):'',note:'',history:[{ts:new Date().toISOString(),by:'p-lead',action:'request',note:''}]}});
    return p};
  const doneUpTo=(p,n)=>msFor(p.id).forEach((m,i)=>{if(i<n){m.done=m.target||T}});
  const a=mk({code:'SWEATSHIRT-001',name:'Crew sweatshirt (demo)',dept:'Comfort Dept',category:'Sweatshirt',collection:'Winter Layers',season:'Winter 2026',priority:'P1',stage:7,fabric:'Loopback fleece (demo)',colorways:'Black, Ash grey',gsm:'360',composition:'100% cotton (demo)',mrp:'2999',estCost:'980',targetMargin:'65',nextAction:'Founder to review final sample photos for creative sign-off',owner:'p-lead'},
    [-40,-28,-18,-8,-2,3,8,26,30,36],[['technical','approved'],['creative','pending']]);
  doneUpTo(a,5);
  const b=mk({code:'WAFFLE-001',name:'Waffle knit long sleeve (demo)',dept:'Comfort Dept',category:'Long sleeve',collection:'Winter Layers',season:'Winter 2026',priority:'P1',stage:6,fabric:'Cotton waffle (demo)',colorways:'Off-black, Stone',gsm:'240',mrp:'2499',estCost:'760',targetMargin:'65',nextAction:'Review S2 shoulder correction',blockers:'S2 shoulder seam still pulling forward',owner:'p-lead'},
    [-30,-20,-10,[-3,-6],5,12,18,34,40,[45,40]],[['technical','pending']]);
  doneUpTo(b,3);
  const c=mk({code:'LWR-001',name:'LWR-001 (demo)',dept:'Training Dept',category:'Bottoms',collection:'Winter Layers',season:'Winter 2026',priority:'P2',stage:5,fabric:'',colorways:'Black',mrp:'2799',estCost:'',nextAction:'Chase S1 from sampling unit',owner:'p-lead'},
    [-20,-12,-2,10,15,22,30,48,55,62],[]);
  doneUpTo(c,2);
  const e=mk({code:'HENLEY-001',name:'Henley (demo)',dept:'Raw Dept',category:'Top',collection:'Spring Movement',season:'Spring 2027',priority:'P2',stage:3,nextAction:'Finalise placket width and button spec',owner:'p-lead'},
    [-6,12,30,45,50,60,70,95,100,110],[]);
  doneUpTo(e,1);
  mk({code:'HOODIE-001',name:'Washed hoodie concept (demo)',dept:'Comfort Dept',category:'Hoodie',collection:'',season:'Winter 2026',priority:'P3',stage:1,nextAction:'Shortlist two wash units for trial',owner:'p-lead'},[],[]);
  mk({code:'WMN-001',name:'Women’s Comfort Dept concept (demo)',dept:'Comfort Dept',category:'Womenswear',collection:'',season:'',priority:'P3',stage:0,nextAction:'',owner:'p-founder'},[],[]);
  const tk=(title,pid,due,status,who)=>{const t={id:uid(),title,pid,due:d(due),status,who:who||'p-lead',priority:'P2',notes:'',createdAt:new Date().toISOString()};D.tasks[t.id]=t};
  tk('Upload S2 fit photos',b.id,0,'doing');tk('Send shoulder correction to pattern maker',b.id,2,'todo');
  tk('Confirm rib supplier lead time',a.id,-1,'todo');tk('Review final sample photos',a.id,1,'todo','p-founder');
  tk('Follow up S1 dispatch',c.id,1,'blocked');tk('Placket sketch options',e.id,6,'todo');
  const act=(text,pid,h,kind)=>{const x={id:uid(),ts:new Date(Date.now()-h*36e5).toISOString(),pid,by:'p-lead',text,kind:kind||'note'};D.activity[x.id]=x};
  act('Moved from Fit & Quality Review to Costing & Approval',a.id,30,'stage');act('Technical approval approved',a.id,29,'approval');
  act('Creative approval requested',a.id,28,'approval');act('S2 received from sampling unit',b.id,50);
  act('Sample approval moved from '+fmtD(d(-6))+' to '+fmtD(d(-3)),b.id,52,'milestone');act('Product created',e.id,120,'product');
  seedDemo2();
}
/* ============ icons ============ */
const ICONS={
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  board:'<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book:'<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/>',
  check:'<path d="M4 12l5 5L20 6"/>',
  task:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  pulse:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2L10 21h4l.5-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  wall:'<rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/>',
  needle:'<path d="M5 19L19 5"/><circle cx="17.5" cy="6.5" r="1"/><path d="M4 20c2-1 3-3 2-5"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  truck:'<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  rupee:'<path d="M6 4h12M6 9h12M9 4c6 0 6 9 0 9H6l8 7"/>',
  shield:'<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  flask:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  side:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  left:'<path d="M15 5l-7 7 7 7"/>',right:'<path d="M9 5l7 7-7 7"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V4h12"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  archive:'<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  dl:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  ul:'<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  img:'<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};
const ic=(n,cls)=>`<svg class="icon ${cls||''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||''}</svg>`;

const NAV=[
  {g:'Studio'},
  {id:'overview',l:'Studio Home',i:'home'},{id:'pipeline',l:'Product Pipeline',i:'board'},{id:'wall',l:'The Wall',i:'wall'},{id:'roadmap',l:'Collections & Roadmap',i:'cal'},
  {g:'Develop'},
  {id:'fit-room',l:'Fit Room',i:'needle'},{id:'library',l:'Product Library',i:'book'},{id:'fabrics',l:'Fabrics & Trims',i:'layers'},{id:'suppliers',l:'Supplier Network',i:'truck'},{id:'costing',l:'Costing',i:'rupee'},{id:'quality',l:'Quality & Approvals',i:'shield'},
  {g:'Department'},
  {id:'tasks',l:'Tasks & My Workspace',i:'task'},{id:'team',l:'Team & Hiring',i:'users'},{id:'budget',l:'Budget & R&D',i:'flask'},{id:'pulse',l:'Product Pulse',i:'pulse'},
];
const LATER={
  'wall':['The Wall','A visual idea board where concepts live without deadlines, with moodboards, fabric experiments and concept scoring (brand fit, differentiation, customer need, feasibility, cost). Today, ideas live as records in the Idea stage of the pipeline, and promoting one is a stage move.'],
  'fit-room':['Fit Room','Sample rounds (S1, S2, S3…) as their own records with measurements, pattern version, fit and construction feedback, corrections, fitting photos, a fit checklist and side-by-side version comparison. Today, the First sample and Sample approval milestones and the Fit & Quality stage carry this.'],
  'fabrics':['Fabrics & Trims','A fabric database (composition, GSM, construction, shrinkage, colourfastness, MOQ, cost, lead time) and a trims library, each linkable to many products. Today, fabric, GSM and composition sit on the product record.'],
  'suppliers':['Supplier Network','A vendor directory by category with sample history, and delivery and quality performance calculated only from recorded outcomes.'],
  'costing':['Costing & Product Economics','A per-product cost sheet (fabric, rib, trims, labels, print, CMT, washing, packaging, testing, freight) with version comparison, and gross margin kept separate from contribution margin. Today, target MRP and estimated cost give a margin on MRP.'],
  'quality':['Quality & Approvals','The full QC checklist and a cross-product approval queue. The five approval gates and their history already work inside each product’s Approvals tab, and they are enforced on the pipeline.'],
  'team':['Team & Hiring','A team directory with roles and responsibilities, workload view and a hiring plan. Today, people and roles are managed in Workspace setup, and each person has a My Workspace view in Tasks.'],
  'budget':['Budget & R&D','Monthly development budget against actual spend, expenses linked to products and vendors, and an R&D experiment log that records learnings without treating experiments as failed projects.'],
};

/* ============ shell ============ */
function renderShell(){
  const r=S.route==='product'?'pipeline':S.route;
  $('#sb').innerHTML=`<div class="sb-brand"><div class="wordmark">OFFCOMFRT<small>Product Lab</small></div>
    <button class="btn ghost sm" data-act="collapse" title="Collapse sidebar" aria-label="Collapse sidebar">${ic('side')}</button></div>
    <nav class="sb-nav">${NAV.map(n=>n.g?`<div class="sb-group">${n.g}</div>`:
      `<button class="nav ${r===n.id?'on':''} ${n.later?'later':''}" data-act="go" data-to="${n.id}" title="${esc(n.l)}">${ic(n.i)}<span class="lbl">${esc(n.l)}</span>${n.later?`<span class="tag">${n.later}</span>`:''}</button>`).join('')}
      <div class="sb-group">Workspace</div>
      <button class="nav ${r==='setup'?'on':''}" data-act="go" data-to="setup" title="Workspace setup">${ic('gear')}<span class="lbl">Workspace setup</span></button>
    </nav>
    <div class="sb-foot"><span class="txt">From Thought to Form.</span></div>`;
  const demo=Store.mode==='demo';
  const storageNote=Lab.offline?'Live · offline':Store.backend==='db'?'Live · synced':'Live · this browser only';
  $('#top').innerHTML=`${demo?`<div class="banner">Demo workspace: fictional products and dates for trying the Lab. Nothing here touches your live data. <button data-act="setmode" data-mode="live">Back to live workspace</button></div>`:''}
    ${!demo&&Lab.offline&&Store.ready?`<div class="banner soft">Can’t reach the live workspace right now — changes are saved in this browser only. <button data-act="labretry">Retry</button></div>`:''}
    <div class="top">
      <button class="btn ghost sm mob-only" data-act="mobnav" aria-label="Open navigation">${ic('menu')}</button>
      <button class="searchbtn" data-act="palette">${ic('search')}<span>Search products, collections, tasks</span><kbd>Ctrl K</kbd></button>
      <div class="spacer"></div>
      <button class="ws-badge ${demo?'demo':''}" data-act="go" data-to="setup" title="Workspace">${demo?'Demo':esc(storageNote)}</button>
      <select class="inp sm" id="actas" title="Acting as" aria-label="Acting as">${people().map(p=>`<option value="${p.id}" ${p.id===S.me?'selected':''}>${esc(p.name)} · ${esc(ROLES[p.role]||p.role)}</option>`).join('')}</select>
      <button class="btn ghost sm" data-act="theme" title="Light / dark" aria-label="Toggle theme">${ic('moon')}</button>
      <button class="btn pri sm" data-act="newmenu">${ic('plus')}New</button>
    </div>`;
}

/* ============ small components ============ */
const priMark=p=>{const n={P1:3,P2:2,P3:1}[p]||0;return `<span class="pri-mark" title="Priority ${p}">${[0,1,2].map(i=>`<i class="${i<n?'f':''}"></i>`).join('')}</span>`};
const av=id=>`<span class="av" title="${esc(pname(id))}">${esc(initials(pname(id)))}</span>`;
const stagePill=s=>`<span class="pill ${s===S_LAUNCHED?'solid':''} ${s===S_ARCHIVED?'dash':''}">${pad(s+1)} ${esc(STAGES[s])}</span>`;
const empty=(t,body,btn)=>`<div class="empty"><b>${t}</b>${body||''}${btn||''}</div>`;
const thumbStyle=p=>p.image?`style="background-image:url('${p.image}')"`:'';
const thumbTxt=p=>p.image?'':esc((p.code||'').split('-')[0].slice(0,2));
function msPill(m,risk){const st=msState(m,risk);const lbl=MS_LABEL[m.type];
  if(st==='done')return `<span class="pill done">${lbl}</span>`;
  if(st==='overdue')return `<span class="pill solid">${lbl} · ${-diffD(TODAY,m.target)}d late</span>`;
  if(st==='risk')return `<span class="pill hatch" title="At risk: an earlier milestone has slipped">${lbl} · at risk</span>`;
  return `<span class="pill">${lbl}</span>`}

/* ============ overview ============ */
function vOverview(){
  const ps=products();
  const d=parseD(TODAY);
  const ks=kpis();
  const act=ps.filter(isActive);
  if(!ps.length)return `<div class="hero"><div><div class="date">${DOW[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}</div><div class="tagline">The Lab is empty. Every number on this page will come from the products you add.</div></div></div>
    <div class="panel">${empty('Start with your first product','Add a product you’re already developing, or log an idea. Stages, milestones and approvals build from there.',
    `<div class="qa" style="justify-content:center"><button class="btn pri" data-act="newproduct">${ic('plus')}Add product</button><button class="btn" data-act="newidea">Add idea</button><button class="btn" data-act="setmode" data-mode="demo">Explore the demo workspace</button></div>`)}</div>`;
  const byStage=STAGES.slice(0,13).map((s,i)=>({i,s,ps:ps.filter(p=>p.stage===i)}));
  const pri=act.filter(p=>p.priority==='P1').concat(act.filter(p=>p.priority==='P2'&&p.stage>=2)).slice(0,6);
  const up=Object.values(D.milestones).filter(m=>!m.done&&m.target&&m.target>=TODAY&&m.target<=addDays(TODAY,14)&&prod(m.pid)&&isActive(prod(m.pid))).sort((a,b)=>a.target<b.target?-1:1);
  const overdue=allOverdue().sort((a,b)=>a.target<b.target?-1:1);
  const pend=pendingApprovals();
  const blockedTasks=Object.values(D.tasks).filter(t=>t.status==='blocked');
  const actv=Object.values(D.activity).sort((a,b)=>a.ts<b.ts?1:-1).slice(0,9);
  return `<div class="hero"><div><div class="date">${DOW[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}</div>
    <div class="tagline">${act.length} products in development · ${overdue.length?`${overdue.length} milestone${overdue.length>1?'s':''} overdue`:'nothing overdue'} · ${pend.length?`${pend.length} decision${pend.length>1?'s':''} waiting`:'no decisions waiting'}</div></div>
    <div class="qa"><button class="btn pri" data-act="newproduct">${ic('plus')}Add product</button><button class="btn" data-act="newidea">Add idea</button><button class="btn" data-act="newtask">Create task</button><button class="btn" data-act="newsample">Add sample</button><button class="btn" data-act="newrec" data-coll="fabrics">Add fabric</button><button class="btn" data-act="newreview">Schedule review</button><button class="btn" data-act="go" data-to="pulse">Generate report</button></div></div>
  <div class="kpis">${ks.map(k=>`<button class="kpi ${k.alert&&k.v?'alert':''}" data-act="kpi" data-k="${k.k}" title="${esc(k.f)}"><div class="v">${k.v}</div><div class="l">${k.l}</div><div class="f">${k.f}</div></button>`).join('')}</div>
  <div class="panel"><div class="panel-h"><h2 class="h">The rail</h2><span class="muted small">Every product on its stage. Select a stage to open it in the pipeline.</span></div>
    <div class="panel-b rail"><div class="rail-track">${byStage.map(b=>`<button class="stop ${b.ps.length?'has':''}" data-act="stagefilter" data-stage="${b.i}">
      <div class="sn">${pad(b.i+1)}</div><div class="hook"></div><div class="sc">${b.ps.length}</div><div class="st">${esc(b.s)}</div>
      <div class="tags">${b.ps.slice(0,3).map(p=>`<span>${esc(p.code)}</span>`).join('')}${b.ps.length>3?`<span class="faint">+${b.ps.length-3}</span>`:''}</div></button>`).join('')}</div></div></div>
  <div class="ov-grid"><div class="col">
    <div class="panel"><div class="panel-h"><h2 class="h">Priority projects</h2><button class="btn ghost sm" data-act="go" data-to="pipeline">Open pipeline</button></div><div class="panel-b">
      ${pri.length?`<ul class="list">${pri.map(p=>{const nm=nextMs(p.id),pr=progress(p.id);return `<li class="li click" data-act="open" data-id="${p.id}">
        <div class="cover" style="width:44px;aspect-ratio:1;font-size:15px;${p.image?`background-image:url('${p.image}')`:''}">${thumbTxt(p)}</div>
        <div style="flex:1;min-width:0"><div class="li-t">${esc(p.code)} <span class="muted" style="font-weight:400">${esc(p.name)}</span></div>
        <div class="tiny muted">${esc(STAGES[p.stage])} · ${esc(pname(p.owner))} · ${nm?`${MS_LABEL[nm.type]} ${fmtD(nm.target)}`:'no dated milestone'}</div>
        <div class="bar" style="margin-top:6px;max-width:260px" title="${pr.done} of ${pr.total} milestones complete"><i style="width:${pr.total?pr.done/pr.total*100:0}%"></i></div></div>
        <div style="text-align:right">${priMark(p.priority)}<div class="tiny muted" style="margin-top:4px">${pr.done}/${pr.total||0} milestones</div></div></li>`}).join('')}</ul>`:empty('No priority projects','Mark a product P1 to keep it here.')}
    </div></div>
    <div class="panel"><div class="panel-h"><h2 class="h">Upcoming milestones</h2><span class="muted small">Next 14 days${overdue.length?`, plus ${overdue.length} overdue`:''}</span></div><div class="panel-b">
      ${overdue.length+up.length?`<ul class="list">${overdue.concat(up).slice(0,12).map(m=>{const p=prod(m.pid);const rk=riskFor(m.pid).risk;return `<li class="li click" data-act="open" data-id="${p.id}" data-tab="milestones">
        <div style="width:64px" class="small">${fmtD(m.target)}</div><div style="flex:1;min-width:0"><span class="li-t">${esc(p.code)}</span> <span class="muted small">${esc(pname(p.owner))}</span></div>${msPill(m,rk)}<span class="tiny muted" style="width:86px;text-align:right">${relDays(m.target)}</span></li>`}).join('')}</ul>`:empty('Nothing due in the next two weeks','Milestone dates are set inside each product.')}
    </div></div>
    <div class="panel"><div class="panel-h"><h2 class="h">Department activity</h2></div><div class="panel-b">
      ${actv.length?`<ul class="list">${actv.map(a=>{const p=prod(a.pid);return `<li class="li ${p?'click':''}" ${p?`data-act="open" data-id="${p.id}" data-tab="activity"`:''}><div class="tiny muted" style="width:96px;flex:none">${fmtTs(a.ts)}</div><div style="flex:1;min-width:0" class="small">${p?`<b>${esc(p.code)}</b> `:''}${esc(a.text)}</div><div class="tiny faint">${esc(pname(a.by))}</div></li>`}).join('')}</ul>`:empty('No activity yet','Stage moves, approvals and date changes are logged here automatically.')}
    </div></div>
  </div><div class="col">
    <div class="panel" id="decisions"><div class="panel-h"><h2 class="h">Pending decisions</h2><span class="muted small">${pend.length+blockedTasks.length}</span></div><div class="panel-b">
      ${pend.length+blockedTasks.length?`<ul class="list">${pend.sort((a,b)=>(a.requestedAt||'')<(b.requestedAt||'')?-1:1).map(a=>{const p=prod(a.pid);const mine=AP[a.type].roles.includes(myRole());return `<li class="li click" data-act="open" data-id="${p.id}" data-tab="approvals">
        <div style="flex:1;min-width:0"><div class="li-t">${esc(AP[a.type].label)}</div><div class="tiny muted">${esc(p.code)} · decided by ${esc(AP[a.type].who)} · waiting ${Math.max(0,-diffD(TODAY,(a.requestedAt||new Date().toISOString()).slice(0,10)))}d</div></div>${mine?'<span class="pill solid">Yours</span>':''}</li>`}).join('')}
        ${blockedTasks.map(t=>{const p=prod(t.pid);return `<li class="li click" data-act="edittask" data-id="${t.id}"><div style="flex:1;min-width:0"><div class="li-t">${esc(t.title)}</div><div class="tiny muted">Blocked task${p?` · ${esc(p.code)}`:''} · ${esc(pname(t.who))}</div></div><span class="pill hatch">Blocked</span></li>`}).join('')}</ul>`:empty('No decisions waiting','Approvals requested inside a product appear here with the person who decides.')}
    </div></div>
    ${vHealth()}
    ${vFitPanel()}
    <div class="panel"><div class="panel-h"><h2 class="h">Release calendar</h2><button class="btn ghost sm" data-act="go" data-to="roadmap">Roadmap</button></div><div class="panel-b">${[0,1].map(i=>miniCal(addMonths(TODAY,i))).join('')}
      <div class="legend" style="margin:4px 0 0"><span><span class="pill solid" style="padding:0 5px">12</span>Target release</span><span><span style="box-shadow:inset 0 -2px 0 var(--ink);padding:0 4px">12</span>Milestone</span></div></div></div>
  </div></div>`;
}
function miniCal(ms){
  const d0=parseD(ms),y=d0.getFullYear(),mo=d0.getMonth();const days=new Date(y,mo+1,0).getDate();const lead=(d0.getDay()+6)%7;
  const rels=[],mss={};
  products().filter(isActive).forEach(p=>{msFor(p.id).forEach(m=>{if(m.target&&m.target.slice(0,7)===ms.slice(0,7)&&!m.done){if(m.type==='release')rels.push({p,m});else (mss[m.target]=mss[m.target]||[]).push(m)}})});
  const relDaysSet={};rels.forEach(r=>(relDaysSet[r.m.target]=relDaysSet[r.m.target]||[]).push(r.p.code));
  let cells=['M','T','W','T','F','S','S'].map(x=>`<span class="hd">${x}</span>`).join('')+'<span></span>'.repeat(lead);
  for(let i=1;i<=days;i++){const ds=`${y}-${pad(mo+1)}-${pad(i)}`;const r=relDaysSet[ds],m=mss[ds];
    cells+=`<span class="${r?'rel':m?'ms':''} ${ds===TODAY?'td':''}" title="${esc([...(r||[]).map(c=>c+' release'),...(m||[]).map(x=>prod(x.pid).code+' '+MS_LABEL[x.type])].join(', '))}">${i}</span>`}
  return `<div class="cal-month"><h4>${MONTH[mo]} ${y}</h4><div class="minical">${cells}</div>
    ${rels.length?`<ul class="list">${rels.sort((a,b)=>a.m.target<b.m.target?-1:1).map(r=>`<li class="li click small" data-act="open" data-id="${r.p.id}" data-tab="milestones" style="padding:6px 0"><span style="width:52px">${fmtD(r.m.target)}</span><b>${esc(r.p.code)}</b><span class="muted" style="flex:1">${esc(r.p.collection||r.p.dept)}</span></li>`).join('')}</ul>`:`<div class="tiny muted">No releases planned.</div>`}</div>`;
}
function vHealth(){
  const done=Object.values(D.milestones).filter(m=>m.done&&m.target&&prod(m.pid));
  const ontime=done.filter(m=>m.done<=m.target).length;
  const overdue=allOverdue().length;
  const act=products().filter(isActive);
  const blocked=act.filter(p=>(p.blockers||'').trim()||tasksFor(p.id).some(t=>t.status==='blocked'));
  const com=act.filter(committed);
  const gaps=com.filter(p=>{const c=commitment(p);return !c.owner||!c.next||!c.ms});
  const gateBreak=act.filter(p=>p.stage>=8&&missingApprovals(p.id,p.stage).length);
  const allMs=Object.values(D.milestones).filter(m=>prod(m.pid)&&isActive(prod(m.pid))&&m.target);
  const row=(v,t,f,act)=>`<div class="health-row ${act?'click':''}" ${act||''}><div class="hv">${v}</div><div><div class="small" style="font-weight:600">${t}</div><div class="tiny muted">${f}</div></div></div>`;
  return `<div class="panel"><div class="panel-h"><h2 class="h">Lab health</h2><span class="muted small">Counts, not scores</span></div><div class="panel-b">
    ${row(done.length?Math.round(ontime/done.length*100)+'%':'—','Schedule adherence',done.length?`${ontime} of ${done.length} completed milestones finished on or before their target date`:'No completed milestones with target dates yet')}
    ${row(overdue,'Overdue milestones',`${overdue} of ${allMs.length} dated open milestones are past their target date`)}
    ${row(blocked.length,'Products with blockers',blocked.length?blocked.map(p=>esc(p.code)).join(', '):'A blocker note or a blocked task counts')}
    ${row(gaps.length,'Commitment gaps',gaps.length?gaps.map(p=>`${esc(p.code)} (${[!commitment(p).owner&&'owner',!commitment(p).next&&'next action',!commitment(p).ms&&'dated milestone'].filter(Boolean).join(', ')})`).join('; '):`All ${com.length} committed products have an owner, next action and dated milestone`)}
    ${row(gateBreak.length,'Gate integrity',gateBreak.length?gateBreak.map(p=>esc(p.code)).join(', ')+(gateBreak.length===1?' sits':' sit')+' past a gate whose approvals are no longer valid':'Every product past a production gate holds its approvals')}
  </div></div>`;
}

/* ============ pipeline ============ */
function stageMatch(f,s){if(f==='')return true;if(String(f).includes('-')){const [a,b]=f.split('-').map(Number);return s>=a&&s<=b}return s===+f}
function filtered(){
  const f=S.f,q=f.q.trim().toLowerCase();
  return products().filter(p=>(!f.dept||p.dept===f.dept)&&(!f.coll||(f.coll==='__none'?!p.collection:p.collection===f.coll))&&stageMatch(f.stage,p.stage)
    &&(!f.owner||p.owner===f.owner)&&(!f.pri||p.priority===f.pri)&&(!f.month||(releaseDate(p.id)||'').slice(0,7)===f.month)
    &&(!q||[p.code,p.name,p.category,p.collection,p.fabric,p.colorways].join(' ').toLowerCase().includes(q)));
}
function filterBar(){
  const f=S.f;const colls=[...new Set(products().map(p=>p.collection).filter(Boolean))];
  const months=[...new Set(products().map(p=>releaseDate(p.id).slice(0,7)).filter(Boolean))].sort();
  const sel=(k,lbl,opts)=>`<select class="inp sm" data-on="filter" data-k="${k}" aria-label="${lbl}"><option value="">${lbl}</option>${opts.map(([v,t])=>`<option value="${esc(v)}" ${String(f[k])===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
  const any=Object.values(f).some(Boolean);
  return `<div class="toolbar">
    <input class="inp sm" id="pq" data-on="filter" data-k="q" placeholder="Filter by code, name, fabric" value="${esc(f.q)}" style="width:220px">
    ${sel('dept','All departments',DEPTS.map(d=>[d,d]))}
    ${sel('coll','All collections',colls.map(c=>[c,c]).concat([['__none','No collection']]))}
    ${sel('stage','All stages',STAGES.map((s,i)=>[i,pad(i+1)+' '+s]).concat([['0-1','Idea & research'],['2-4','In design'],['5-6','Under sampling'],['8-11','Approved for production']]))}
    ${sel('owner','All owners',people().map(p=>[p.id,p.name]))}
    ${sel('month','Any release month',months.map(m=>[m,MONTH[+m.slice(5)-1]+' '+m.slice(0,4)]))}
    ${sel('pri','Any priority',PRIORITIES.map(p=>[p,p]))}
    ${any?`<button class="btn ghost sm" data-act="clearf">Clear filters</button>`:''}</div>`;
}
function vPipeline(){
  const ps=filtered();
  const v=S.pipeView;
  return `<div class="pagehead"><div><h1 class="title">Product Pipeline</h1><p class="sub">${products().length} products · ${ps.length} shown · drag a card to change its stage. Production gates check approvals first.</p></div>
    <div class="qa"><div class="seg" role="tablist">${[['kanban','Board'],['table','Table'],['timeline','Timeline']].map(([k,l])=>`<button class="${v===k?'on':''}" data-act="pipeview" data-v="${k}">${l}</button>`).join('')}</div>
    <button class="btn" data-act="csvmenu">${ic('dl')}CSV</button><button class="btn pri" data-act="newproduct">${ic('plus')}Add product</button></div></div>
    ${filterBar()}
    ${!products().length?`<div class="panel">${empty('No products yet','Add your first product to start the pipeline.',`<button class="btn pri" data-act="newproduct">${ic('plus')}Add product</button>`)}</div>`:
      v==='kanban'?board(ps):v==='table'?table(ps):`${legend()}${gantt(ps,S.rm.start,90,{group:false})}<p class="tiny muted">Showing ${fmtD(S.rm.start)} to ${fmtD(addDays(S.rm.start,90))}. Change the window in Collections & Roadmap.</p>`}`;
}
function board(ps){
  const showArch=S.f.stage!==''&&stageMatch(S.f.stage,S_ARCHIVED);
  const cols=STAGES.map((s,i)=>i).filter(i=>i!==S_ARCHIVED||showArch||ps.some(p=>p.stage===S_ARCHIVED));
  return `<div class="board">${cols.map(i=>{const cp=ps.filter(p=>p.stage===i).sort((a,b)=>(a.priority>b.priority?1:-1));const g=GATES[i];
    return `<section class="colk" data-drop="${i}" aria-label="${esc(STAGES[i])}"><div class="colk-h"><span class="sn">${pad(i+1)}</span><span class="t">${esc(STAGES[i])}</span>${g?`<span class="gate" title="Gate: ${g.map(t=>AP[t].label).join(', ')}">${ic('lock','')}</span>`:''}<span class="c">${cp.length}</span></div>
    <div class="colk-b">${cp.map(card).join('')||`<div class="tiny faint" style="padding:8px 4px">Drop here</div>`}</div></section>`}).join('')}</div>`;
}
function card(p){
  const nm=nextMs(p.id),pr=progress(p.id),rk=riskFor(p.id);const miss=p.stage>=8?missingApprovals(p.id,p.stage):[];
  return `<article class="card" draggable="true" data-drag="${p.id}" data-act="open" data-id="${p.id}" tabindex="0">
    ${p.image?`<div class="thumb" ${thumbStyle(p)}></div>`:''}
    <div class="row"><span class="code">${esc(p.code)}</span>${priMark(p.priority)}</div>
    <div class="nm">${esc(p.name)}</div>
    <div class="meta"><span>${esc(p.dept.replace(' Dept',''))}</span>${p.collection?`<span>· ${esc(p.collection)}</span>`:''}</div>
    ${(p.blockers||'').trim()?`<div class="blk">${esc(p.blockers)}</div>`:''}
    ${miss.length?`<div class="blk">${ic('lock')} Needs ${miss.map(t=>AP[t].label.toLowerCase()).join(', ')}</div>`:''}
    <div class="row"><span class="tiny ${nm&&nm.target<TODAY?'':'muted'}" style="${nm&&nm.target<TODAY?'font-weight:700':''}">${nm?`${MS_LABEL[nm.type]} · ${fmtD(nm.target)}`:'No dated milestone'}</span>${av(p.owner)}</div>
    ${pr.total?`<div class="bar" title="${pr.done} of ${pr.total} milestones complete"><i style="width:${pr.done/pr.total*100}%"></i></div>`:''}
    ${rk.trigger?`<div class="tiny" style="font-weight:600">${rk.trigger.late?'Overdue':'Slipped'}: ${esc(rk.trigger.label)}</div>`:''}
  </article>`;
}
const COLS_T=[['code','Code'],['name','Product'],['dept','Dept'],['collection','Collection'],['stage','Stage'],['owner','Owner'],['priority','Pri'],['fabric','Fabric'],['mrp','MRP','num'],['estCost','Est. cost','num'],['margin','Margin','num'],['release','Release'],['progress','Milestones'],['nextAction','Next action'],['updatedAt','Updated']];
function sortVal(p,k){if(k==='margin')return margin(p)??-1e9;if(k==='release')return releaseDate(p.id)||'9999';if(k==='progress'){const x=progress(p.id);return x.total?x.done/x.total:-1}if(k==='owner')return pname(p.owner);if(k==='mrp'||k==='estCost')return num(p[k])??-1e9;return p[k]??''}
function table(ps){
  const {k,d}=S.sort;ps=ps.slice().sort((a,b)=>{const x=sortVal(a,k),y=sortVal(b,k);return (x>y?1:x<y?-1:0)*d});
  return `<div class="tablewrap"><table class="t"><thead><tr>${COLS_T.map(([key,l,c])=>`<th class="sortable ${c||''}" data-act="sort" data-k="${key}">${l}${k===key?(d>0?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>
  ${ps.map(p=>{const pr=progress(p.id),mg=margin(p);return `<tr class="click" data-act="open" data-id="${p.id}"><td class="code">${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.dept.replace(' Dept',''))}</td><td>${esc(p.collection||'—')}</td><td>${stagePill(p.stage)}</td><td>${esc(pname(p.owner))}</td><td>${p.priority}</td><td>${esc(p.fabric||'—')}</td><td class="num">${inr(p.mrp)}</td><td class="num">${inr(p.estCost)}</td><td class="num">${mg==null?'—':mg.toFixed(1)+'%'}</td><td>${fmtD(releaseDate(p.id))}</td><td>${pr.done}/${pr.total}</td><td style="max-width:240px" class="small">${esc(p.nextAction||'—')}</td><td class="tiny muted">${fmtTs(p.updatedAt)}</td></tr>`}).join('')||`<tr><td colspan="${COLS_T.length}">${empty('No products match these filters','')}</td></tr>`}
  </tbody></table></div>`;
}
function legend(){return `<div class="legend"><span><i class="g-ms"></i>Planned</span><span><i class="g-ms done"></i>Done</span><span><i class="g-ms overdue"></i>Overdue</span><span><i class="g-ms risk"></i>At risk (earlier milestone slipped)</span><span><i class="g-rel"></i>Target release</span><span><span style="border-left:1.5px solid var(--ink);height:14px;display:inline-block"></span>Today</span></div>`}
function gantt(ps,start,days,opt){
  opt=opt||{};const end=addDays(start,days);
  const pos=s=>diffD(start,s)/days*100;const inR=s=>s&&s>=start&&s<=end;
  let months='';let m=monthStart(start);while(m<=end){const a=Math.max(0,pos(m)),b=Math.min(100,pos(addMonths(m,1)));if(b>a)months+=`<div class="g-month" style="left:${a}%;width:${b-a}%">${MONTH[+m.slice(5,7)-1].slice(0,3)} ${m.slice(2,4)}</div>`;m=addMonths(m,1)}
  let vlines='';m=addMonths(monthStart(start),start.slice(8)==='01'?0:1);while(m<=end){vlines+=`<div class="g-vline" style="left:${pos(m)}%"></div>`;m=addMonths(m,1)}
  const today=inR(TODAY)?`<div class="g-today" style="left:${pos(TODAY)}%"></div>`:'';
  const row=p=>{const ms=msFor(p.id).filter(x=>x.target);const rk=riskFor(p.id);
    const ds=ms.map(x=>x.target).sort();let bar='';
    if(ds.length){const a=Math.max(0,pos(ds[0])),b=Math.min(100,pos(ds[ds.length-1]));if(b>a)bar=`<div class="g-bar" style="left:${a}%;width:${b-a}%"></div>`}
    const marks=ms.filter(x=>inR(x.target)).map(x=>{const st=msState(x,rk.risk);const t=`${p.code} · ${MS_LABEL[x.type]} · ${fmtD(x.target)}${x.baseline&&x.baseline!==x.target?` (planned ${fmtD(x.baseline)})`:''} · ${st}`;
      return x.type==='release'?`<div class="g-rel ${st==='risk'||st==='overdue'?'risk':''}" style="left:${pos(x.target)}%" title="${esc(t)}" data-act="open" data-id="${p.id}" data-tab="milestones"></div>`
      :`<div class="g-ms ${st}" style="left:${pos(x.target)}%" title="${esc(t)}" data-act="open" data-id="${p.id}" data-tab="milestones"></div>`}).join('');
    return `<div class="g-row"><div class="g-label click" data-act="open" data-id="${p.id}" style="cursor:pointer"><span class="code">${esc(p.code)}</span><span class="nm muted">${esc(p.name)}</span></div><div class="g-track">${vlines}${today}${bar}${marks}</div></div>`};
  let body='';
  if(opt.group){const groups={};ps.forEach(p=>{(groups[p.collection||'']=groups[p.collection||'']||[]).push(p)});
    Object.keys(groups).sort((a,b)=>a===''?1:b===''?-1:a.localeCompare(b)).forEach(g=>{body+=`<div class="g-row grp"><div class="g-label"><b class="small">${esc(g||'No collection')}</b></div><div class="g-track">${vlines}</div></div>`+groups[g].map(row).join('')})}
  else body=ps.map(row).join('');
  return `<div class="gantt"><div class="g-inner"><div class="g-row head"><div class="g-label tiny muted">Product</div><div class="g-track">${months}${inR(TODAY)?`<div class="g-today" style="left:${pos(TODAY)}%"><span>Today</span></div>`:''}</div></div>${body||`<div class="empty">No products with dated milestones in this window.</div>`}</div></div>`;
}
/* ============ product workspace ============ */
const TABS=[['overview','Overview'],['notes','Design & references'],['techpack','Tech pack'],['materials','Fabrics & trims'],['sampling','Sampling & fit'],['costing','Costing'],['quality','Quality'],['milestones','Timeline'],['tasks','Tasks'],['approvals','Approvals'],['revisions','Revisions'],['activity','Activity']];
function vProduct(){
  const p=prod(S.param);
  if(!p)return `<div class="panel">${empty('This product no longer exists','It may have been deleted.',`<button class="btn" data-act="go" data-to="pipeline">Back to pipeline</button>`)}</div>`;
  const c=commitment(p),nm=nextMs(p.id);const miss=p.stage>=8?missingApprovals(p.id,p.stage):[];
  const reqPath=requiredFor(11);
  const apSum=reqPath.filter(t=>apFor(p.id,t).status==='approved').length;
  const cell=(k,ok,v)=>`<div><div class="k">${k}</div><div class="vv ${ok?'':'miss'}">${ok?v:'Missing'}</div></div>`;
  return `<button class="btn ghost sm" data-act="back">${ic('back')}Pipeline</button>
  <div class="p-head"><div><div class="qa" style="align-items:center"><span class="code">${esc(p.code)}</span>${stagePill(p.stage)}${priMark(p.priority)}<span class="muted small">${esc(p.dept)}${p.collection?' · '+esc(p.collection):''}${p.season?' · '+esc(p.season):''}</span><span class="pill">Rev ${p.rev||1}</span></div>
    <h1>${esc(p.name)}</h1></div>
    <div class="qa"><select class="inp sm" data-on="stage" data-id="${p.id}" aria-label="Stage">${STAGES.map((s,i)=>`<option value="${i}" ${i===p.stage?'selected':''}>${pad(i+1)} ${esc(s)}${GATES[i]?' (gate)':''}</option>`).join('')}</select>
    <button class="btn" data-act="editproduct" data-id="${p.id}">${ic('edit')}Edit</button><button class="btn" data-act="pmenu" data-id="${p.id}" aria-label="More actions">More</button></div></div>
  ${miss.length?`<div class="notice">${ic('lock')}<div><b>Gate no longer satisfied.</b> This product sits at ${esc(STAGES[p.stage])} but ${miss.map(t=>AP[t].label.toLowerCase()).join(', ')} ${miss.length>1?'are':'is'} not approved, usually after a revision. Re-approve in the Approvals tab or move the product back.</div></div>`:''}
  ${committed(p)?`<div class="commit">${cell('Owner',c.owner,esc(pname(p.owner)))}${cell('Current stage',true,esc(STAGES[p.stage]))}${cell('Next action',c.next,esc(p.nextAction))}${cell('Next milestone',c.ms,nm?`${MS_LABEL[nm.type]} · ${fmtD(nm.target)}`:'')}<div><div class="k">Approval path</div><div class="vv">${apSum} of ${reqPath.length} gates approved</div></div></div>`:
    `<div class="notice soft">This is still ${p.stage===0?'an idea':'in research'}, so it doesn’t need deadlines yet. From Concept Development on, the Lab expects one owner, one next action and one dated milestone.</div>`}
  <div class="tabs" role="tablist">${TABS.map(([k,l])=>`<button class="${S.tab===k?'on':''}" data-act="tab" data-t="${k}">${l}${k==='tasks'?` <span class="faint">${tasksFor(p.id).filter(t=>t.status!=='done').length||''}</span>`:''}${k==='approvals'&&Object.values(D.approvals).some(a=>a.pid===p.id&&a.status==='pending')?' <span class="faint">•</span>':''}</button>`).join('')}</div>
  ${(PTAB[S.tab]||PTAB.overview)(p)}`;
}
function pOverview(p){
  const mg=margin(p);const ms=msFor(p.id);const rk=riskFor(p.id);
  const open=tasksFor(p.id).filter(t=>t.status!=='done');
  const dd=(k,v)=>`<dt>${k}</dt><dd>${v===''||v==null?'<span class="faint">Not set</span>':v}</dd>`;
  return `<div class="p-grid"><div>
    <div class="cover" ${thumbStyle(p)}>${p.image?'':esc((p.code||'').slice(0,2))}</div>
    <div class="qa" style="margin-top:10px"><label class="btn sm">${ic('img')}${p.image?'Replace image':'Add product image'}<input type="file" accept="image/*" data-on="image" data-id="${p.id}" hidden></label>${p.image?`<button class="btn ghost sm" data-act="rmimage" data-id="${p.id}">Remove</button>`:''}</div>
    <p class="tiny muted">One cover image, resized to 640px and stored with the record.</p>
  </div>
  <div class="panel"><div class="panel-b" style="padding-top:12px"><dl class="dl">
    ${dd('Owner',esc(pname(p.owner)))}${dd('Category',esc(p.category))}${dd('Collection',esc(p.collection))}${dd('Season',esc(p.season))}
    ${dd('Fabric',esc(p.fabric))}${dd('Composition',esc(p.composition))}${dd('GSM',esc(p.gsm))}${dd('Colorways',esc(p.colorways))}
    ${dd('Wash care',esc(p.washCare))}${dd('Construction notes',esc(p.construction))}
    ${dd('Target MRP',p.mrp?inr(p.mrp):'')}${dd('Estimated cost',p.estCost?inr(p.estCost):'')}
    ${dd('Margin on MRP',mg==null?'':`${mg.toFixed(1)}% <span class="tiny muted">(MRP − est. cost) ÷ MRP, before GST and discounts${p.targetMargin?` · target ${esc(p.targetMargin)}%`:''}</span>`)}
    ${dd('Blockers',(p.blockers||'').trim()?`<b>${esc(p.blockers)}</b>`:'')}
    ${dd('Next action',esc(p.nextAction))}${dd('Last updated',fmtTs(p.updatedAt))}
  </dl></div></div>
  <div class="col pcol3">
    <div class="panel"><div class="panel-h"><h3 class="h3">Milestones</h3><button class="btn ghost sm" data-act="tab" data-t="milestones">Edit dates</button></div><div class="panel-b">
      ${ms.some(m=>m.target)?`<ul class="list">${ms.filter(m=>m.target).map(m=>`<li class="li small" style="padding:7px 0"><span style="width:56px">${fmtD(m.target)}</span><span style="flex:1">${msPill(m,rk.risk)}</span></li>`).join('')}</ul>`:empty('No dates yet','Set target dates to place this product on the roadmap.')}
    </div></div>
    <div class="panel"><div class="panel-h"><h3 class="h3">Open tasks</h3><button class="btn ghost sm" data-act="newtask" data-pid="${p.id}">Add</button></div><div class="panel-b">
      ${open.length?`<ul class="list">${open.map(t=>`<li class="li click small" data-act="edittask" data-id="${t.id}" style="padding:7px 0"><span style="flex:1" class="li-t">${esc(t.title)}</span>${t.status==='blocked'?'<span class="pill hatch">Blocked</span>':''}<span class="muted">${fmtD(t.due)}</span></li>`).join('')}</ul>`:'<div class="tiny muted">No open tasks.</div>'}
    </div></div>
  </div></div>`;
}
function pMilestones(p){
  const ms=msFor(p.id);const rk=riskFor(p.id);const rel=msOf(p.id,'release');
  if(!ms.length)return `<div class="panel">${empty('No milestone plan yet','Create the ten standard milestones, from concept approval to target release. Leave dates blank until you know them.',`<button class="btn pri" data-act="mkms" data-id="${p.id}">Create milestone plan</button>`)}</div>`;
  const after=rel&&rel.target?ms.filter(m=>m.type!=='release'&&m.target&&m.target>rel.target&&!m.done):[];
  return `${rk.trigger?`<div class="notice">${ic('flag')}<div><b>${esc(rk.trigger.label)} ${rk.trigger.late?'is overdue':`slipped ${rk.trigger.slip} days from plan`}.</b> ${Object.keys(rk.risk).length} later milestone${Object.keys(rk.risk).length===1?'':'s'} may be affected: ${ms.filter(m=>rk.risk[m.id]).map(m=>MS_LABEL[m.type]).join(', ')||'none dated'}. Release dates never move automatically; review and confirm any change here.</div></div>`:''}
  ${after.length?`<div class="notice">${ic('flag')}<div><b>Sequence conflict.</b> ${after.map(m=>MS_LABEL[m.type]).join(', ')} now land${after.length===1?'s':''} after the target release (${fmtD(rel.target)}). The release date has not been changed.</div></div>`:''}
  ${rk.conflicts.length?`<div class="notice soft">Out of order: ${rk.conflicts.map(m=>MS_LABEL[m.type]).join(', ')} ${rk.conflicts.length>1?'are':'is'} dated before an earlier step.</div>`:''}
  <div class="tablewrap"><table class="t"><thead><tr><th></th><th>Milestone</th><th>Target date</th><th>Planned (baseline)</th><th>Status</th><th>Completed</th><th>Note</th><th></th></tr></thead><tbody>
  ${ms.map((m,i)=>{const st=msState(m,rk.risk);const slip=m.baseline&&m.target&&m.target!==m.baseline?diffD(m.baseline,m.target):0;return `<tr>
    <td class="tiny faint">${pad(i+1)}</td><td><b>${MS_LABEL[m.type]}</b></td>
    <td><input type="date" class="inp sm" value="${m.target||''}" data-on="msdate" data-id="${m.id}" aria-label="Target date for ${MS_LABEL[m.type]}"></td>
    <td class="small">${m.baseline?fmtD(m.baseline):'—'}${slip?` <span class="${slip>0?'pill solid':'pill'}" style="margin-left:4px">${slip>0?'+':''}${slip}d</span>`:''}</td>
    <td>${st==='done'?'<span class="pill done">Done</span>':st==='overdue'?`<span class="pill solid">${-diffD(TODAY,m.target)}d overdue</span>`:st==='risk'?'<span class="pill hatch">At risk</span>':st==='unset'?'<span class="pill dash">No date</span>':`<span class="pill">${relDays(m.target)}</span>`}</td>
    <td><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${m.done?'checked':''} data-on="msdone" data-id="${m.id}">${m.done?fmtD(m.done):''}</label></td>
    <td><input class="inp sm" value="${esc(m.note||'')}" data-on="msnote" data-id="${m.id}" placeholder="Add note" style="width:180px"></td>
    <td>${slip?`<button class="btn ghost sm" data-act="rebase" data-id="${m.id}" title="Accept the new date as the plan">Accept as plan</button>`:''}</td></tr>`}).join('')}
  </tbody></table></div>
  <p class="tiny muted">The first date you set becomes the plan (baseline). Later changes show the slip; “Accept as plan” records a confirmed re-plan in the activity history.</p>`;
}
function pTasks(p){
  const ts=tasksFor(p.id).sort((a,b)=>(a.status==='done')-(b.status==='done')||((a.due||'9')<(b.due||'9')?-1:1));
  return `<div class="toolbar"><button class="btn pri" data-act="newtask" data-pid="${p.id}">${ic('plus')}Add task</button></div>${taskTable(ts,false)}`;
}
function pApprovals(p){
  const role=myRole();
  return `<p class="muted small" style="margin-top:-6px">Gates: Production Ready needs technical, creative and commercial approval; In Production also needs manufacturing handover; Launch Ready also needs bulk QC. A progress bar never opens a gate.</p>
  <div class="tablewrap"><table class="t"><thead><tr><th>Approval</th><th>Decided by</th><th>Status</th><th>Last update</th><th>Note</th><th></th></tr></thead><tbody>
  ${AP_TYPES.map(([t,l,who,roles])=>{const a=apFor(p.id,t);const can=roles.includes(role)&&!S.readOnly;
    const st={none:'<span class="pill dash">Not requested</span>',pending:'<span class="pill hatch">Pending</span>',approved:'<span class="pill solid">Approved</span>',rejected:'<span class="pill">Changes required</span>'}[a.status];
    const last=(a.history||[]).slice(-1)[0];
    return `<tr><td><b>${l}</b></td><td class="small">${who}</td><td>${st}</td><td class="tiny muted">${last?`${fmtTs(last.ts)} · ${esc(pname(last.by))}`:'—'}</td><td class="small" style="max-width:220px">${esc(a.note||'')}</td>
    <td style="white-space:nowrap">${a.status!=='pending'&&a.status!=='approved'?`<button class="btn sm" data-act="aprequest" data-id="${p.id}" data-t="${t}">Request</button>`:''}
      ${a.status==='pending'||a.status==='rejected'||a.status==='approved'?`<button class="btn sm ${can?'pri':''}" data-act="apdecide" data-id="${p.id}" data-t="${t}" ${can?'':`disabled title="Only ${who} can decide"`}>Decide</button>`:''}</td></tr>`}).join('')}
  </tbody></table></div>
  <h3 class="h3" style="margin:22px 0 8px">Approval history</h3>
  ${(()=>{const h=[];AP_TYPES.forEach(([t])=>(apFor(p.id,t).history||[]).forEach(x=>h.push(Object.assign({t},x))));h.sort((a,b)=>a.ts<b.ts?1:-1);
    return h.length?`<div class="panel"><div class="panel-b" style="padding-top:8px"><ul class="list">${h.map(x=>`<li class="li small"><span class="tiny muted" style="width:110px">${fmtTs(x.ts)}</span><span style="flex:1">${AP[x.t].label} <b>${{request:'requested',approved:'approved',rejected:'changes required',reset:'reset by revision'}[x.action]||x.action}</b>${x.note?` · “${esc(x.note)}”`:''}</span><span class="muted">${esc(pname(x.by))}</span></li>`).join('')}</ul></div></div>`:'<p class="muted small">No approval activity yet.</p>'})()}`;
}
function pNotes(p){
  return `<div class="grid2"><div class="field"><label for="pnotes">Design notes</label><textarea class="inp" id="pnotes" rows="12" placeholder="Silhouette intent, references, fit thoughts, construction ideas">${esc(p.notes||'')}</textarea><div><button class="btn pri sm" data-act="savenotes" data-id="${p.id}">Save notes</button></div></div>
  <div><div class="field"><label>References</label><div class="hint">Links to moodboards, tech packs or shared folders. File uploads aren’t connected in this build, so store files where your team already does and link them here.</div></div>
    <ul class="list" style="margin:10px 0">${(p.refs||[]).map((r,i)=>`<li class="li small"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(r.title||'Link')}</b> <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="muted">${esc(r.url)}</a></span><button class="btn ghost sm" data-act="rmref" data-id="${p.id}" data-i="${i}" aria-label="Remove">${ic('x')}</button></li>`).join('')||'<li class="li tiny muted">No references yet.</li>'}</ul>
    <div class="grid2"><input class="inp" id="reft" placeholder="Title"><input class="inp" id="refu" placeholder="https://"></div><div style="margin-top:8px"><button class="btn sm" data-act="addref" data-id="${p.id}">Add reference</button></div></div></div>`;
}
function pRevisions(p){
  const r=(p.revisions||[]).slice().reverse();
  return `<p class="muted small" style="margin-top:-6px">Once technical and creative approval are both in place, specification fields (${LOCKED_FIELDS.join(', ').replace('estCost','estimated cost').replace('mrp','MRP').replace('washCare','wash care')}) are protected. Changing them creates a new revision and sends approvals back for review.</p>
  ${r.length?`<div class="panel"><div class="panel-b" style="padding-top:8px"><ul class="list">${r.map(x=>`<li class="li small" style="align-items:flex-start"><span class="pill solid">Rev ${x.rev}</span><div style="flex:1">${x.changes.map(c=>`<div><b>${esc(c.f)}</b>: <span class="muted">${esc(c.from||'—')}</span> → ${esc(c.to||'—')}</div>`).join('')}${x.reason?`<div class="tiny muted">Reason: ${esc(x.reason)}</div>`:''}</div><span class="tiny muted">${fmtTs(x.ts)} · ${esc(pname(x.by))}</span></li>`).join('')}</ul></div></div>`:'<div class="panel">'+empty('Revision 1','No protected changes have been made.')+'</div>'}`;
}
function pActivity(p){
  const a=Object.values(D.activity).filter(x=>x.pid===p.id).sort((a,b)=>a.ts<b.ts?1:-1);
  return a.length?`<div class="panel"><div class="panel-b" style="padding-top:8px"><ul class="list">${a.map(x=>`<li class="li small"><span class="tiny muted" style="width:110px">${fmtTs(x.ts)}</span><span style="flex:1">${esc(x.text)}</span><span class="tiny muted">${esc(pname(x.by))}</span></li>`).join('')}</ul></div></div>`:`<div class="panel">${empty('No activity yet','')}</div>`;
}

/* ============ library ============ */
function vLibrary(){
  const f=S.lib,q=f.q.toLowerCase();
  const ps=products().filter(p=>(!f.dept||p.dept===f.dept)&&(!f.status||(f.status==='active'?isActive(p):f.status==='launched'?p.stage===S_LAUNCHED:p.stage===S_ARCHIVED))
    &&(!q||[p.code,p.name,p.category,p.collection,p.fabric,p.composition,p.colorways,p.season].join(' ').toLowerCase().includes(q))).sort((a,b)=>a.code.localeCompare(b.code));
  return `<div class="pagehead"><div><h1 class="title">Product Library</h1><p class="sub">The permanent record of every OFFCOMFRT garment, active and historical. Duplicating starts a new development and leaves the original untouched.</p></div></div>
  <div class="toolbar"><input class="inp sm" id="lq" data-on="lfilter" data-k="q" placeholder="Search code, name, fabric, composition" value="${esc(f.q)}" style="width:280px">
    <select class="inp sm" data-on="lfilter" data-k="dept"><option value="">All departments</option>${DEPTS.map(d=>`<option ${f.dept===d?'selected':''}>${d}</option>`).join('')}</select>
    <select class="inp sm" data-on="lfilter" data-k="status"><option value="">All records</option>${[['active','In development'],['launched','Launched'],['archived','Archived / cancelled']].map(([k,v])=>`<option value="${k}" ${f.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
  ${ps.length?`<div class="lib">${ps.map(p=>`<div class="lib-card"><div class="img" ${thumbStyle(p)} data-act="open" data-id="${p.id}">${thumbTxt(p)}</div>
    <div class="b"><span class="code">${esc(p.code)}</span><b style="font-weight:600">${esc(p.name)}</b><span class="tiny muted">${esc(p.dept)}${p.collection?' · '+esc(p.collection):''}</span>
    <span class="tiny muted">${[p.fabric,p.gsm&&p.gsm+' GSM',p.composition].filter(Boolean).map(esc).join(' · ')||'No fabric spec yet'}</span><div style="margin-top:6px">${stagePill(p.stage)} <span class="pill">Rev ${p.rev||1}</span></div></div>
    <div class="f"><button class="btn sm" data-act="open" data-id="${p.id}">Open record</button><button class="btn ghost sm" data-act="dup" data-id="${p.id}">${ic('copy')}Duplicate</button></div></div>`).join('')}</div>`
  :`<div class="panel">${empty(products().length?'No records match':'The library is empty','Every product you add is kept here permanently, including launched and archived ones.')}</div>`}`;
}

/* ============ roadmap ============ */
function vRoadmap(){
  const r=S.rm;
  let ps=products().filter(p=>p.stage!==S_ARCHIVED&&(!r.dept||p.dept===r.dept)&&(!r.coll||p.collection===r.coll));
  const days=r.view==='180'?181:91;
  const colls=cfg().collections||[];
  const end=addDays(r.start,days);
  const rels=ps.filter(isActive).map(p=>({p,d:releaseDate(p.id)})).filter(x=>x.d).sort((a,b)=>a.d<b.d?-1:1);
  const conflicts=[];for(let i=0;i<rels.length;i++)for(let j=i+1;j<rels.length;j++){if(diffD(rels[i].d,rels[j].d)<=7&&rels[i].p.dept===rels[j].p.dept)conflicts.push([rels[i],rels[j]])}
  const delays=ps.filter(isActive).map(p=>({p,rk:riskFor(p.id)})).filter(x=>x.rk.trigger);
  const view=r.view==='month'?monthCal(ps):`${legend()}${gantt(ps.filter(p=>msFor(p.id).some(m=>m.target)),r.start,days,{group:true})}`;
  const undated=ps.filter(p=>isActive(p)&&p.stage>=2&&!msFor(p.id).some(m=>m.target));
  return `<div class="pagehead"><div><h1 class="title">Collections & Roadmap</h1><p class="sub">${r.view==='month'?`${MONTH[+r.month.slice(5,7)-1]} ${r.month.slice(0,4)}`:`${fmtD(r.start)} to ${fmtD(end)}`} · current planning period Nov 2026 to Jan 2027</p></div>
    <div class="qa"><div class="seg">${[['90','90 days'],['180','6 months'],['month','Month']].map(([k,l])=>`<button class="${r.view===k?'on':''}" data-act="rmview" data-v="${k}">${l}</button>`).join('')}</div>
    <button class="btn sm" data-act="rmnav" data-d="-1" aria-label="Earlier">${ic('left')}</button><button class="btn sm" data-act="rmnav" data-d="0">Today</button><button class="btn sm" data-act="rmnav" data-d="1" aria-label="Later">${ic('right')}</button>
    <button class="btn sm" data-act="rmpreset" data-p="q">Nov–Jan</button><button class="btn sm" data-act="rmpreset" data-p="h">Feb–Jul ’27</button></div></div>
  <div class="toolbar"><select class="inp sm" data-on="rmf" data-k="dept"><option value="">All departments</option>${DEPTS.map(d=>`<option ${r.dept===d?'selected':''}>${d}</option>`).join('')}</select>
    <select class="inp sm" data-on="rmf" data-k="coll"><option value="">All collections</option>${[...new Set(products().map(p=>p.collection).filter(Boolean))].map(c=>`<option ${r.coll===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
  ${view}
  ${undated.length?`<p class="small muted">Not on the roadmap yet (no dates): ${undated.map(p=>`<a href="#product-${p.id}">${esc(p.code)}</a>`).join(', ')}</p>`:''}
  <div class="grid3" style="margin-top:20px">
    <div class="panel"><div class="panel-h"><h2 class="h">Delays & knock-on</h2></div><div class="panel-b">${delays.length?`<ul class="list">${delays.map(({p,rk})=>`<li class="li click" data-act="open" data-id="${p.id}" data-tab="milestones" style="align-items:flex-start"><div style="flex:1"><b class="code">${esc(p.code)}</b><div class="small">${esc(rk.trigger.label)} ${rk.trigger.late?'overdue':`slipped ${rk.trigger.slip}d`}</div><div class="tiny muted">May affect: ${msFor(p.id).filter(m=>rk.risk[m.id]).map(m=>MS_LABEL[m.type]).join(', ')||'no later dated milestones'}</div></div></li>`).join('')}</ul>`:'<div class="tiny muted">No slipped or overdue milestones.</div>'}</div></div>
    <div class="panel"><div class="panel-h"><h2 class="h">Release conflicts</h2></div><div class="panel-b">${conflicts.length?`<ul class="list">${conflicts.map(([a,b])=>`<li class="li small"><div><b>${esc(a.p.code)}</b> ${fmtD(a.d)} and <b>${esc(b.p.code)}</b> ${fmtD(b.d)}<div class="tiny muted">${esc(a.p.dept)}, within 7 days</div></div></li>`).join('')}</ul>`:'<div class="tiny muted">No two releases in the same department fall within 7 days of each other.</div>'}</div></div>
    <div class="panel"><div class="panel-h"><h2 class="h">Collections</h2><button class="btn ghost sm" data-act="newcoll">${ic('plus')}Add</button></div><div class="panel-b">${colls.length?`<ul class="list">${colls.map(c=>{const n=products().filter(p=>p.collection===c.name);return `<li class="li click" data-act="editcoll" data-id="${c.id}"><div style="flex:1"><b>${esc(c.name)}</b><div class="tiny muted">${esc(c.season||'')}${c.start?` · ${fmtD(c.start)} to ${fmtD(c.end)}`:''} · ${n.length} product${n.length===1?'':'s'}, ${n.filter(p=>p.stage>=8&&p.stage<S_ARCHIVED).length} production ready or later</div></div></li>`}).join('')}</ul>`:'<div class="tiny muted">No collections yet. Add one to group products and set its release window.</div>'}</div></div>
  </div>`;
}
function monthCal(ps){
  const ms=S.rm.month;const d0=parseD(ms);const lead=(d0.getDay()+6)%7;const start=addDays(ms,-lead);
  const ev={};ps.forEach(p=>{const rk=riskFor(p.id);msFor(p.id).forEach(m=>{if(m.target)(ev[m.target]=ev[m.target]||[]).push({p,m,st:msState(m,rk.risk)})})});
  let h=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div class="dh">${x}</div>`).join('');
  for(let i=0;i<42;i++){const ds=addDays(start,i);const out=ds.slice(0,7)!==ms.slice(0,7);const e=(ev[ds]||[]).sort((a,b)=>(b.m.type==='release')-(a.m.type==='release'));
    h+=`<div class="d ${out?'out':''} ${ds===TODAY?'today':''}"><span class="dn">${parseD(ds).getDate()}</span>${e.slice(0,4).map(x=>`<div class="ev ${x.m.type==='release'?'rel':''} ${x.st}" data-act="open" data-id="${x.p.id}" data-tab="milestones" title="${esc(x.p.code+' · '+MS_LABEL[x.m.type])}">${esc(x.p.code)} ${x.m.type==='release'?'release':esc(MS_LABEL[x.m.type].toLowerCase())}</div>`).join('')}${e.length>4?`<span class="tiny muted">+${e.length-4} more</span>`:''}</div>`}
  return `<div style="overflow-x:auto"><div class="mcal" style="min-width:760px">${h}</div></div>`;
}

/* ============ pulse ============ */
function pulseData(ws){
  const we=addDays(ws,6);const inW=ts=>{const d=ts.slice(0,10);return d>=ws&&d<=we};
  const acts=Object.values(D.activity).filter(a=>inW(a.ts));
  const moves=acts.filter(a=>a.kind==='stage');
  const apDone=acts.filter(a=>a.kind==='approval'&&(a.action==='approved'||a.action==='rejected'));
  const msDone=Object.values(D.milestones).filter(m=>m.done&&m.done>=ws&&m.done<=we&&prod(m.pid));
  const nextWs=addDays(we,1),nextWe=addDays(we,7);
  const upcoming=Object.values(D.milestones).filter(m=>!m.done&&m.target&&m.target>=nextWs&&m.target<=nextWe&&prod(m.pid)).sort((a,b)=>a.target<b.target?-1:1);
  const overdue=allOverdue();
  const blockers=products().filter(isActive).filter(p=>(p.blockers||'').trim());
  const blockedT=Object.values(D.tasks).filter(t=>t.status==='blocked');
  const pend=pendingApprovals();
  const founderPend=pend.filter(a=>AP[a.type].roles.includes('founder'));
  const tasksDone=Object.values(D.tasks).filter(t=>t.status==='done'&&t.doneAt&&inW(t.doneAt));
  const prio=products().filter(p=>isActive(p)&&p.priority==='P1');
  const newIn=products().filter(p=>inW(p.createdAt));
  const rel30=products().filter(isActive).map(p=>({p,d:releaseDate(p.id)})).filter(x=>x.d&&x.d>=TODAY&&x.d<=addDays(TODAY,30));
  return {ws,we,acts,moves,apDone,msDone,upcoming,overdue,blockers,blockedT,pend,founderPend,tasksDone,prio,newIn,rel30,active:products().filter(isActive)};
}
function vPulse(){
  const P=pulseData(S.pulse.week);const F=S.pulse.founder;
  const sec=(t,body)=>`<div class="panel"><div class="panel-h"><h2 class="h">${t}</h2></div><div class="panel-b">${body}</div></div>`;
  const ul=(arr,fn,none)=>arr.length?`<ul class="list">${arr.map(fn).join('')}</ul>`:`<div class="tiny muted">${none}</div>`;
  const pl=(pid,txt,tab)=>{const p=prod(pid);return `<li class="li ${p?'click':''} small" ${p?`data-act="open" data-id="${pid}" ${tab?`data-tab="${tab}"`:''}`:''}>${p?`<b class="code" style="width:130px">${esc(p.code)}</b>`:''}<span style="flex:1">${txt}</span></li>`};
  const founderBlock=`<div class="grid2">
    ${sec(`Decisions for the founder (${P.founderPend.length})`,ul(P.founderPend,a=>pl(a.pid,`${AP[a.type].label} · waiting ${Math.max(0,-diffD(TODAY,(a.requestedAt||'').slice(0,10)||TODAY))}d`,'approvals'),'Nothing waiting on the founder.'))}
    ${sec(`Overdue (${P.overdue.length})`,ul(P.overdue,m=>pl(m.pid,`${MS_LABEL[m.type]} · due ${fmtD(m.target)}`,'milestones'),'Nothing overdue.'))}
    ${sec(`Blockers (${P.blockers.length+P.blockedT.length})`,ul(P.blockers.map(p=>({pid:p.id,t:p.blockers})).concat(P.blockedT.map(t=>({pid:t.pid,t:'Task blocked: '+t.title}))),x=>pl(x.pid,esc(x.t)),'No blockers recorded.'))}
    ${sec(`Releases in the next 30 days (${P.rel30.length})`,ul(P.rel30,x=>pl(x.p.id,`${fmtD(x.d)} · ${esc(STAGES[x.p.stage])}${missingApprovals(x.p.id,11).length?` · ${missingApprovals(x.p.id,11).length} gate approvals outstanding`:''}`,'milestones'),'No releases in the next 30 days.'))}</div>`;
  return `<div class="pagehead"><div><h1 class="title">Product Pulse</h1><p class="sub">Week of ${fmtD(P.ws)} to ${fmtD(P.we)} · generated from Lab records, nothing estimated</p></div>
    <div class="qa"><button class="btn sm" data-act="pweek" data-d="-7" aria-label="Previous week">${ic('left')}</button><button class="btn sm" data-act="pweek" data-d="0">This week</button><button class="btn sm" data-act="pweek" data-d="7" aria-label="Next week">${ic('right')}</button>
    <div class="seg"><button class="${!F?'on':''}" data-act="pfounder" data-v="0">Full pulse</button><button class="${F?'on':''}" data-act="pfounder" data-v="1">Founder view</button></div>
    <button class="btn" data-act="pexport">${ic('dl')}Export</button></div></div>
  <div class="kpis" style="grid-template-columns:repeat(6,1fr)">${[[P.active.length,'Active projects'],[P.moves.length,'Stage moves this week'],[P.msDone.length,'Milestones completed'],[P.apDone.length,'Approval decisions'],[P.overdue.length,'Overdue milestones'],[P.pend.length,'Pending approvals']].map(([v,l])=>`<div class="kpi" style="cursor:default"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
  ${F?founderBlock:`${founderBlock}<div class="grid2" style="margin-top:18px">
    ${sec('Progress this week',ul(P.moves,a=>pl(a.pid,esc(a.text)),'No stage moves recorded this week.')+(P.msDone.length?`<h3 class="h3" style="margin:14px 0 4px">Milestones completed</h3>`+ul(P.msDone,m=>pl(m.pid,`${MS_LABEL[m.type]} on ${fmtD(m.done)}`),''):''))}
    ${sec('Approvals decided',ul(P.apDone,a=>pl(a.pid,esc(a.text)),'No approval decisions this week.'))}
    ${sec('Due next week',ul(P.upcoming,m=>pl(m.pid,`${MS_LABEL[m.type]} · ${fmtD(m.target)} · ${esc(pname(prod(m.pid).owner))}`,'milestones'),'Nothing due next week.'))}
    ${sec('Next week’s priorities',ul(P.prio,p=>pl(p.id,esc(p.nextAction||'No next action set')),'No P1 products.'))}
  </div>`}
  <p class="tiny muted" style="margin-top:16px">Samples received and rejected will appear here once the Fit Room (Phase 2) records sample rounds. Cycle times and budget lines arrive with the monthly report in Phase 3.</p>`;
}
function pulseMarkdown(){
  const P=pulseData(S.pulse.week);const c=pid=>(prod(pid)||{}).code||'';
  const L=[`# OFFCOMFRT Product Pulse`,`Week of ${P.ws} to ${P.we}`,'',`Active projects: ${P.active.length} · Stage moves: ${P.moves.length} · Milestones completed: ${P.msDone.length} · Overdue: ${P.overdue.length} · Pending approvals: ${P.pend.length}`,'',
    '## Decisions for the founder',...(P.founderPend.length?P.founderPend.map(a=>`- ${c(a.pid)}: ${AP[a.type].label}`):['- None']),'',
    '## Overdue',...(P.overdue.length?P.overdue.map(m=>`- ${c(m.pid)}: ${MS_LABEL[m.type]} (due ${m.target})`):['- None']),'',
    '## Blockers',...(P.blockers.length+P.blockedT.length?P.blockers.map(p=>`- ${p.code}: ${p.blockers}`).concat(P.blockedT.map(t=>`- ${c(t.pid)}: task blocked, ${t.title}`)):['- None']),'',
    '## Progress this week',...(P.moves.length?P.moves.map(a=>`- ${c(a.pid)}: ${a.text}`):['- None']),'',
    '## Due next week',...(P.upcoming.length?P.upcoming.map(m=>`- ${c(m.pid)}: ${MS_LABEL[m.type]} (${m.target})`):['- None']),'',
    '## Next week’s priorities',...(P.prio.length?P.prio.map(p=>`- ${p.code}: ${p.nextAction||'no next action set'}`):['- None'])];
  return L.join('\n');
}

/* ============ setup ============ */
function vSetup(){
  const c=cfg();const demo=Store.mode==='demo';
  return `<div class="pagehead"><div><h1 class="title">Workspace setup</h1><p class="sub">People, workspace mode and your data.</p></div></div>
  <div class="grid2">
  <div class="panel"><div class="panel-h"><h2 class="h">Workspace</h2></div><div class="panel-b">
    <div class="seg" style="margin-bottom:12px"><button class="${!demo?'on':''}" data-act="setmode" data-mode="live">Live workspace</button><button class="${demo?'on':''}" data-act="setmode" data-mode="demo">Demo workspace</button></div>
    <p class="small">${demo?'You’re in the <b>demo workspace</b>: fictional products stored only in this browser. It never mixes with live data.':Store.backend==='db'?'The <b>live workspace</b> is stored in the team database and syncs to everyone signed in with the workspace password.':'The <b>live workspace</b> is saving in this browser only, because the server was unreachable. Export a backup regularly.'}</p>
    <p class="tiny muted">The live workspace is protected by one shared password. “Acting as” sets whose approvals and permissions you see; it is enforced in the app, not on the server.</p>
    ${demo?`<button class="btn" data-act="resetdemo">Reset demo data</button>`:`<div class="qa" style="margin-top:4px"><button class="btn" data-act="labretry">Re-sync now</button><button class="btn" data-act="labsignout">Sign out of live workspace</button></div>`}
  </div></div>
  <div class="panel"><div class="panel-h"><h2 class="h">People & roles</h2><button class="btn ghost sm" data-act="newperson">${ic('plus')}Add person</button></div><div class="panel-b">
    <ul class="list">${people().map(p=>`<li class="li"><span class="av">${esc(initials(p.name))}</span><div style="flex:1"><b>${esc(p.name)}</b><div class="tiny muted">${esc(ROLES[p.role]||p.role)}</div></div><button class="btn ghost sm" data-act="editperson" data-id="${p.id}">Edit</button></li>`).join('')}</ul>
    <p class="tiny muted">Roles decide which approvals a person can give: technical by Product Lead, creative by Founder, commercial by Operations or Founder, handover by Operations, bulk QC by Operations or Product Lead.</p></div></div>
  <div class="panel span2"><div class="panel-h"><h2 class="h">Data</h2></div><div class="panel-b">
    <div class="qa"><button class="btn" data-act="exportjson">${ic('dl')}Export full backup (JSON)</button><label class="btn">${ic('ul')}Import backup (JSON)<input type="file" accept=".json,application/json" data-on="importjson" hidden></label>
      <button class="btn" data-act="csvproducts">${ic('dl')}Products CSV</button><button class="btn" data-act="csvtasks">${ic('dl')}Tasks CSV</button><button class="btn" data-act="csvms">${ic('dl')}Milestones CSV</button>
      <label class="btn">${ic('ul')}Import products CSV<input type="file" accept=".csv,text/csv" data-on="importcsv" hidden></label></div>
    <p class="tiny muted">Products CSV import adds rows whose code doesn’t exist yet and skips the rest. Use the exported file as the template. Importing a JSON backup replaces the ${demo?'demo':'live'} workspace after confirmation.</p>
    ${!demo?`<button class="btn" data-act="wipe" style="margin-top:6px">${ic('trash')}Clear live workspace</button>`:''}
  </div></div></div>`;
}
function vLater(id){
  const [t,body]=LATER[id];const n=NAV.find(x=>x.id===id);
  return `<div class="pagehead"><div><h1 class="title">${esc(t)}</h1><p class="sub">${n.later} · not built in this MVP</p></div></div>
  <div class="panel"><div class="panel-b" style="padding-top:18px;max-width:720px"><p>${esc(body)}</p><p class="small muted">The product record, milestones, approvals and activity log are already shaped so this module will attach to the same products rather than duplicating them. Nothing on this page pretends to work yet.</p>
  <button class="btn" data-act="go" data-to="pipeline">Open the pipeline</button></div></div>`;
}
/* ===================================================================
   PHASE 2–3 MODULES
   =================================================================== */
const TSTAT={todo:'To do',doing:'In progress',blocked:'Blocked',done:'Done'};
const TASK_TYPES=['Product development','Sampling','Sourcing','Quality','Launch','Department','Admin'];
const SAMPLE_ST=['Awaiting Sample','Received','Under Review','Correction Required','Approved','Rejected'];
const SAMPLE_OPEN=['Awaiting Sample','Received','Under Review','Correction Required'];
const FIT_CHECK=['Overall silhouette','Shoulder','Chest / bust','Waist / hip','Sleeve length','Body length','Hem','Neck / collar','Fabric drape','Stitch quality','Trims & branding placement','Wash result'];
const QC_ITEMS=['Fabric quality','Measurement accuracy','Fitting','Stitching','Shrinkage','Colorfastness','Finishing','Printing / embroidery','Zippers & trims','Wash performance','Packaging','Final sample appearance'];
const COST_LINES=[['mainFabric','Main fabric','m'],['secondary','Rib & secondary fabrics','m'],['trims','Trims & accessories','set'],['labels','Labels','set'],['print','Printing / embroidery','pc'],['cutting','Cutting','pc'],['cmt','Stitching / CMT','pc'],['wash','Washing / finishing','pc'],['packaging','Packaging','pc'],['testing','Quality testing','pc'],['freight','Freight to warehouse','pc'],['other','Other development / landed','pc']];
const SUP_CATS=['Fabric supplier','Knitting mill','Dyeing / washing unit','Trims supplier','Pattern maker','Sampling unit','Manufacturer','Testing laboratory'];
const FAB_CATS=['Knit','Woven','Fleece','Rib','Technical','Other'];
const TRIM_TYPES=['Zipper','Drawcord','Rib','Button','Label','Accessory','Other'];
const BUDGET_CATS=['Sampling','Pattern development','Fabric research','Laboratory testing','Design tools','External specialists','Team costs','Other R&D'];
const IDEA_KINDS=['Idea','Moodboard','Fabric experiment','Silhouette','Sketch','Reference'];
const SCORE_KEYS=[['brand','Brand fit'],['diff','Differentiation'],['need','Customer need'],['feas','Feasibility'],['cost','Cost viability']];
const HIRE_STAGES=['Proposed','Approved','Sourcing','Interviewing','Offer','Hired','On hold'];
const EXP_TYPES=['Construction','Fabric','Wash treatment','Fit','Print / finish','Other'];
const EXP_OUT=['Pending','Adopt','Promising','Not now','Learned'];
const DATA_V=2;

const recs=c=>Object.values(D[c]||{});
const optList=o=>(typeof o==='function'?o():o||[]).map(x=>Array.isArray(x)?x:[x,x]);
const prodOpts=()=>products().filter(p=>p.stage!==S_ARCHIVED).sort((a,b)=>a.code.localeCompare(b.code)).map(p=>[p.id,p.code+' · '+p.name]);
const prodOptsNone=()=>[['','None']].concat(prodOpts());
const supOpts=()=>[['','None']].concat(recs('suppliers').sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(s=>[s.id,s.name]));
const supName=id=>(D.suppliers[id]||{}).name||'';
const pcode=id=>(prod(id)||{}).code||'';
const roundNum=r=>parseInt(String(r||'').replace(/\D/g,''))||0;
const samplesFor=pid=>recs('samples').filter(s=>s.pid===pid).sort((a,b)=>roundNum(a.round)-roundNum(b.round));
const pctTxt=(a,b)=>b?Math.round(a/b*100)+'%':'—';

/* ---------- permissions by area ---------- */
const AREA={products:['founder','lead','member'],tasks:['founder','lead','member','ops'],samples:['founder','lead','member'],fabrics:['founder','lead','member'],trims:['founder','lead','member'],suppliers:['founder','lead','member','ops'],ideas:['founder','lead','member'],costsheets:['founder','lead','ops'],finance:['founder','ops'],qc:['founder','lead','member','ops'],hires:['founder','lead'],budget:['founder','lead'],expenses:['founder','lead','ops'],experiments:['founder','lead','member'],people:['founder','lead']};
function can(area){return !S.readOnly&&(AREA[area]||AREA.products).includes(myRole())}
function guard(area){if(can(area))return true;toast(S.readOnly?'This workspace is read-only for you.':`Acting as ${ROLES[myRole()]}: you can view this, but changing it belongs to another role.`);return false}

/* ---------- module state ---------- */
Object.assign(S,{
  wall:{view:'board',q:'',kind:'',status:''},fit:{pid:'',status:''},fab:{tab:'fabrics',q:'',cat:''},sup:{q:'',cat:''},
  cost:{pid:'',ver:''},qa:{tab:'queue',status:'pending'},team:{tab:'people'},bud:{month:monthStart(TODAY),tab:'budget'}});
S.tasks=Object.assign({view:'list',type:'',due:'',pid:''},S.tasks);
S.pulse.mode='week';S.pulse.month=monthStart(TODAY);

/* ---------- generic record schemas ---------- */
const SC=(n,l,o)=>[n,l,o||{}];
const SCHEMA={
  ideas:{title:'Idea',name:'title',area:'ideas',image:true,fields:[SC('title','Title',{req:1,cls:'span2'}),SC('kind','Type',{type:'select',options:IDEA_KINDS}),
    SC('category','Product category',{ph:'Hoodie, trouser…'}),SC('collection','Collection',{ph:'Optional'}),SC('status','Status',{type:'select',options:['Raw','Shortlisted','Parked']}),
    SC('tags','Tags',{cls:'span2',ph:'Comma separated: winter, fleece, oversized'}),SC('source','Reference link',{ph:'https://'}),SC('notes','Notes',{type:'textarea',cls:'span3',rows:4}),
    ...SCORE_KEYS.map(([k,l])=>SC('sc_'+k,l,{type:'select',options:[['','Not scored'],['1','1 · weak'],['2','2'],['3','3'],['4','4'],['5','5 · strong']]}))],
    sect:{sc_brand:'Concept score, 1 (weak) to 5 (strong). Leave blank until you have a view.'}},
  fabrics:{title:'Fabric',area:'fabrics',image:true,fields:[SC('code','Fabric ID',{req:1,ph:'FAB-001'}),SC('name','Fabric name',{req:1,cls:'span2'}),SC('category','Category',{type:'select',options:FAB_CATS}),
    SC('composition','Composition',{ph:'100% cotton'}),SC('gsm','GSM',{type:'number',min:0}),SC('construction','Knit / weave type',{ph:'Single jersey, loopback…'}),SC('finish','Finish',{ph:'Enzyme, brushed…'}),SC('stretch','Stretch & recovery'),
    SC('shrinkage','Shrinkage result',{ph:'L −3%, W −2% after 3 washes'}),SC('colorfast','Colorfastness result',{ph:'Grade 4 wash'}),SC('hand','Hand feel'),
    SC('applications','Suitable applications',{cls:'span2'}),SC('colorways','Available colorways'),SC('supplierId','Supplier',{type:'select',options:supOpts}),SC('moq','MOQ',{ph:'e.g. 300 kg'}),
    SC('cost','Cost (₹)',{type:'number',min:0,step:'any'}),SC('costUnit','Cost per',{type:'select',options:[['m','metre'],['kg','kg']]}),SC('leadTime','Lead time (days)',{type:'number',min:0}),
    SC('testStatus','Test status',{type:'select',options:['Untested','Testing','Passed','Failed']}),SC('swatch','Swatch location',{ph:'Swatch book A, p.4'}),
    SC('pids','Products using this fabric',{type:'multi',options:prodOpts}),SC('notes','Notes',{type:'textarea',cls:'span3'})]},
  trims:{title:'Trim',area:'trims',image:true,fields:[SC('code','Trim ID',{req:1,ph:'TRM-001'}),SC('name','Name',{req:1,cls:'span2'}),SC('type','Type',{type:'select',options:TRIM_TYPES}),
    SC('spec','Specification',{cls:'span2',ph:'Size, finish, colour, material'}),SC('supplierId','Supplier',{type:'select',options:supOpts}),SC('moq','MOQ'),
    SC('cost','Cost (₹)',{type:'number',min:0,step:'any'}),SC('unit','Per',{ph:'piece, metre, set'}),SC('leadTime','Lead time (days)',{type:'number',min:0}),
    SC('pids','Products using this trim',{type:'multi',options:prodOpts}),SC('notes','Notes',{type:'textarea',cls:'span3'})]},
  suppliers:{title:'Supplier',area:'suppliers',fields:[SC('name','Name',{req:1,cls:'span2'}),SC('category','Category',{type:'select',options:SUP_CATS}),SC('location','Location'),
    SC('contact','Contact person'),SC('phone','Phone'),SC('email','Email'),SC('status','Status',{type:'select',options:['Active','Trial','Paused','Inactive']}),SC('moq','MOQ'),SC('leadTime','Typical lead time (days)',{type:'number',min:0}),
    SC('price','Price information',{cls:'span2',ph:'e.g. CMT ₹180–240 per piece'}),SC('capability','Capability',{type:'textarea',cls:'span3'}),SC('notes','Quality notes',{type:'textarea',cls:'span3'})]},
  hires:{title:'Role',name:'role',area:'hires',fields:[SC('role','Role',{req:1,cls:'span2'}),SC('priority','Priority',{type:'select',options:PRIORITIES}),SC('reason','Reason for hiring',{type:'textarea',cls:'span3'}),
    SC('budget','Budget (₹ / month)',{type:'number',min:0}),SC('stage','Hiring stage',{type:'select',options:HIRE_STAGES}),SC('target','Target start',{type:'date'}),SC('kind','Type',{type:'select',options:['Full-time','Part-time','External / freelance']}),SC('notes','Notes',{type:'textarea',cls:'span3'})]},
  expenses:{title:'Expense',name:'desc',area:'expenses',fields:[SC('date','Date',{type:'date',req:1}),SC('category','Category',{type:'select',options:BUDGET_CATS}),SC('amount','Amount (₹)',{type:'number',req:1,min:0,step:'any'}),
    SC('desc','Description',{req:1,cls:'span3'}),SC('pid','Product',{type:'select',options:prodOptsNone}),SC('supplierId','Vendor',{type:'select',options:supOpts}),
    SC('expId','R&D experiment',{type:'select',options:()=>[['','None']].concat(recs('experiments').map(x=>[x.id,x.title]))})]},
  experiments:{title:'Experiment',name:'title',area:'experiments',image:true,fields:[SC('title','Experiment',{req:1,cls:'span2'}),SC('type','Type',{type:'select',options:EXP_TYPES}),
    SC('status','Status',{type:'select',options:['Planned','Running','Concluded']}),SC('outcome','Outcome',{type:'select',options:EXP_OUT}),SC('date','Date',{type:'date'}),
    SC('pid','Related product',{type:'select',options:prodOptsNone}),SC('fabricId','Related fabric',{type:'select',options:()=>[['','None']].concat(recs('fabrics').map(f=>[f.id,f.code+' · '+f.name]))}),SC('who','Led by',{type:'select',options:()=>people().map(p=>[p.id,p.name])}),
    SC('hypothesis','What we wanted to learn',{type:'textarea',cls:'span3'}),SC('method','What we did',{type:'textarea',cls:'span3'}),SC('result','Result',{type:'textarea',cls:'span3'}),SC('learning','Learning to keep',{type:'textarea',cls:'span3'})]},
};
function sfld(n,l,v,o){
  if(o.type==='multi'){const opts=optList(o.options);const vals=Array.isArray(v)?v:[];
    return `<div class="field span3"><label>${l}</label>${opts.length?`<div class="multi">${opts.map(([k,t])=>`<label class="chk"><input type="checkbox" name="${n}" value="${esc(k)}" ${vals.includes(k)?'checked':''}><span>${esc(t)}</span></label>`).join('')}</div>`:'<div class="hint">No products to link yet.</div>'}</div>`}
  return fld(n,l,v==null?'':v,Object.assign({},o,{options:o.options?optList(o.options):undefined}));
}
function readRecForm(f,sc){const fd=new FormData(f);const v={};sc.fields.forEach(([n,,o])=>{v[n]=o.type==='multi'?fd.getAll(n):String(fd.get(n)??'').trim()});return v}
function recModal(m){
  const sc=SCHEMA[m.coll];const r=Object.assign({},m.id?D[m.coll][m.id]:(m.preset||{}),m.draft||{});
  if(m.img===undefined)m.img=r.image||'';
  return `<div class="modal wide"><form id="recform"><div class="modal-h"><h2 class="h">${m.id?'Edit':'New'} ${sc.title.toLowerCase()}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="modal-b"><div class="grid3">${sc.fields.map(([n,l,o])=>(sc.sect&&sc.sect[n]?`<div class="formsec">${sc.sect[n]}</div>`:'')+sfld(n,l,r[n],o)).join('')}
  ${sc.image?`<div class="field span3"><label>Image</label><div class="qa" style="align-items:center">${m.img?`<img src="${m.img}" alt="" style="height:72px;border-radius:6px;border:1px solid var(--line)">`:''}<label class="btn sm">${ic('img')}${m.img?'Replace image':'Add image'}<input type="file" accept="image/*" data-on="recimg" hidden></label>${m.img?`<button type="button" class="btn ghost sm" data-act="recimgrm">Remove</button>`:''}<span class="tiny muted">Resized to 640px and stored with the record.</span></div></div>`:''}
  </div></div><div class="modal-f">${m.id?`<button type="button" class="btn" data-act="recdel" style="margin-right:auto">${ic('trash')}Delete</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save ${sc.title.toLowerCase()}</button></div></form></div>`;
}
function recCSV(coll){
  const sc=SCHEMA[coll];const cols=sc.fields.map(f=>f[0]);
  return toCSV(cols,recs(coll).map(r=>cols.map(k=>Array.isArray(r[k])?r[k].map(pcode).join(' '):k==='supplierId'?supName(r[k]):k==='pid'?pcode(r[k]):r[k])));
}

/* ---------- product change with revision protection ---------- */
function resetApprovals(p,why){['technical','creative','commercial'].forEach(t=>{const a=clone(apFor(p.id,t));if(a.status==='approved'){a.status='pending';a.requestedAt=new Date().toISOString();a.requestedBy=S.me;a.history=(a.history||[]).concat([{ts:a.requestedAt,by:S.me,action:'reset',note:why}]);put('approvals',a)}})}
function applyProductChange(pid,changes,reason,force){
  const old=prod(pid);if(!old)return;
  const locked=apFor(pid,'technical').status==='approved'&&apFor(pid,'creative').status==='approved';
  const diffs=Object.keys(changes).filter(k=>JSON.stringify(old[k]??'')!==JSON.stringify(changes[k]??'')).map(k=>({f:k,from:typeof old[k]==='object'?'(previous)':String(old[k]??''),to:typeof changes[k]==='object'?'(updated)':String(changes[k]??'')}));
  if(!diffs.length&&!force)return;
  const isLocked=force||(locked&&diffs.some(d=>LOCKED_FIELDS.includes(d.f)));
  const doIt=()=>{const p=Object.assign(clone(old),changes,{updatedAt:new Date().toISOString()});
    if(isLocked){p.rev=(old.rev||1)+1;p.revisions=(old.revisions||[]).concat([{rev:p.rev,ts:p.updatedAt,by:S.me,changes:diffs.length?diffs:[{f:'tech pack',from:'frozen',to:'reopened'}],reason:reason||''}]);resetApprovals(p,`Rev ${p.rev}`);
      log(`Revision ${p.rev} created (${diffs.map(d=>d.f).join(', ')||reason}); approvals returned to pending`,pid,'revision')}
    else log(`Updated ${diffs.map(d=>d.f).join(', ')}`,pid,'product');
    put('products',p);toast(isLocked?`Rev ${p.rev} created`:'Saved')};
  if(isLocked)confirmBox(`Create Rev ${(old.rev||1)+1}?`,`${esc(old.code)} has approved specifications. ${reason?esc(reason)+'. ':''}This records a new revision and returns technical, creative and commercial approval to pending.`,'Create revision',doIt);else doIt();
}

/* =================== THE WALL =================== */
function ideaScore(x){const v=SCORE_KEYS.map(([k])=>num(x['sc_'+k])).filter(n=>n!=null);return {n:v.length,avg:v.length?v.reduce((a,b)=>a+b,0)/v.length:null}}
function vWall(){
  const f=S.wall,q=f.q.toLowerCase();
  let xs=recs('ideas').filter(x=>(!f.kind||x.kind===f.kind)&&(!f.status||(x.status||'Raw')===f.status)&&(!q||[x.title,x.notes,x.tags,x.category,x.collection].join(' ').toLowerCase().includes(q)));
  xs.sort((a,b)=>(a.createdAt<b.createdAt?1:-1));
  const card=x=>{const s=ideaScore(x);const p=x.productId&&prod(x.productId);
    return `<article class="idea" data-act="editrec" data-coll="ideas" data-id="${x.id}">${x.image?`<img src="${x.image}" alt="">`:''}
    <div class="ib"><div class="qa" style="gap:6px"><span class="pill">${esc(x.kind||'Idea')}</span><span class="pill ${x.status==='Shortlisted'?'solid':x.status==='Parked'?'dash':x.status==='Converted'?'done':''}">${esc(x.status||'Raw')}</span></div>
    <h3 class="idea-t">${esc(x.title)}</h3>${x.notes?`<p class="small clamp">${esc(x.notes)}</p>`:''}
    ${x.tags?`<div class="tiny muted">${esc(x.tags).split(',').map(t=>t.trim()).filter(Boolean).map(t=>'#'+t).join(' ')}</div>`:''}
    <div class="tiny" style="margin-top:6px">${s.n?`Score ${s.avg.toFixed(1)} / 5 <span class="muted">from ${s.n} of 5 criteria</span>`:'<span class="muted">Not scored</span>'}</div>
    ${p?`<a class="tiny" href="#product-${p.id}" style="font-weight:600">Became ${esc(p.code)}</a>`:`<button class="btn sm" data-act="convertidea" data-id="${x.id}" style="margin-top:8px;align-self:flex-start">Make it a product</button>`}</div></article>`};
  const body=!xs.length?`<div class="panel">${empty(recs('ideas').length?'No ideas match':'The Wall is empty','Pin raw ideas, moodboards, silhouettes and fabric experiments here. Nothing on the Wall needs a deadline.',`<button class="btn pri" data-act="newrec" data-coll="ideas">${ic('plus')}Pin an idea</button>`)}</div>`
    :f.view==='list'?`<div class="tablewrap"><table class="t"><thead><tr><th>Idea</th><th>Type</th><th>Category</th><th>Status</th>${SCORE_KEYS.map(([,l])=>`<th class="num">${l}</th>`).join('')}<th class="num">Avg</th><th>Product</th></tr></thead><tbody>${xs.map(x=>{const s=ideaScore(x);return `<tr class="click" data-act="editrec" data-coll="ideas" data-id="${x.id}"><td><b>${esc(x.title)}</b></td><td>${esc(x.kind||'Idea')}</td><td>${esc(x.category||'—')}</td><td>${esc(x.status||'Raw')}</td>${SCORE_KEYS.map(([k])=>`<td class="num">${x['sc_'+k]||'—'}</td>`).join('')}<td class="num">${s.n?s.avg.toFixed(1):'—'}</td><td>${x.productId?esc(pcode(x.productId)):'—'}</td></tr>`}).join('')}</tbody></table></div>`
    :`<div class="${f.view==='board'?'masonry':'lib'}">${xs.map(card).join('')}</div>`;
  return `<div class="pagehead"><div><h1 class="title">The Wall</h1><p class="sub">Ideas, references and experiments before they become projects. Promote an idea only when it earns a place in the pipeline.</p></div>
    <div class="qa"><div class="seg">${[['board','Wall'],['grid','Grid'],['list','List']].map(([k,l])=>`<button class="${f.view===k?'on':''}" data-act="wallview" data-v="${k}">${l}</button>`).join('')}</div><button class="btn pri" data-act="newrec" data-coll="ideas">${ic('plus')}Pin idea</button></div></div>
  <div class="toolbar"><input class="inp sm" id="wq" data-on="xfilter" data-o="wall" data-k="q" placeholder="Search ideas and tags" value="${esc(f.q)}" style="width:220px">
    <select class="inp sm" data-on="xfilter" data-o="wall" data-k="kind"><option value="">All types</option>${IDEA_KINDS.map(k=>`<option ${f.kind===k?'selected':''}>${k}</option>`).join('')}</select>
    <select class="inp sm" data-on="xfilter" data-o="wall" data-k="status"><option value="">Any status</option>${['Raw','Shortlisted','Parked','Converted'].map(k=>`<option ${f.status===k?'selected':''}>${k}</option>`).join('')}</select>
    <span class="tiny muted">${recs('ideas').length} pinned · ${recs('ideas').filter(x=>x.status==='Converted').length} became products</span></div>${body}`;
}

/* =================== FIT ROOM =================== */
const stCls=s=>({Approved:'solid',Rejected:'done','Correction Required':'hatch','Awaiting Sample':'dash'}[s]||'');
function dev(x){const s=num(x.spec),a=num(x.act);if(s==null||a==null)return null;const v=Math.round((a-s)*10)/10;const t=num(x.tol);return {v,out:t!=null&&Math.abs(v)>t}}
function openSample(id,pid){
  let r;
  if(id)r=clone(D.samples[id]);
  else{const prev=pid?samplesFor(pid).slice(-1)[0]:null;const n=prev?roundNum(prev.round)+1:1;
    r={pid:pid||'',round:'S'+n,status:'Awaiting Sample',requested:TODAY,due:'',received:'',vendorId:prev?prev.vendorId:'',fabric:prev?prev.fabric:((prod(pid)||{}).fabric||''),patternVer:prev?(prev.patternVer||''):'P1',who:S.me,nextDue:'',
      meas:prev&&prev.meas&&prev.meas.length?prev.meas.map(x=>({pom:x.pom,spec:x.spec,tol:x.tol,act:''})):[{pom:'Chest (½)',spec:'',act:'',tol:'1'},{pom:'Body length (HPS)',spec:'',act:'',tol:'1'},{pom:'Shoulder',spec:'',act:'',tol:'0.5'},{pom:'Sleeve length',spec:'',act:'',tol:'1'}],
      chk:{},fit:'',construction:'',quality:'',corrections:'',decision:'',images:[]}}
  r.meas=r.meas||[];r.chk=r.chk||{};r.images=r.images||[];
  openModal({kind:'sample',id,rec:r});
}
const S_FIELDS=['pid','round','status','vendorId','requested','due','received','fabric','patternVer','who','fit','construction','quality','corrections','decision','nextDue'];
function capSample(){const f=$('#sform');if(!f)return;const r=S.modal.rec;const fd=new FormData(f);
  S_FIELDS.forEach(k=>{if(fd.has(k))r[k]=String(fd.get(k)).trim()});
  r.meas=r.meas.map((x,i)=>({pom:String(fd.get('pom_'+i)??x.pom).trim(),spec:String(fd.get('spec_'+i)??x.spec),act:String(fd.get('act_'+i)??x.act),tol:String(fd.get('tol_'+i)??x.tol)}));
  FIT_CHECK.forEach((c,i)=>{if(fd.has('chk_'+i))r.chk[i]=fd.get('chk_'+i)});}
function sampleModal(m){
  const r=m.rec;
  return `<div class="modal wide"><form id="sform"><div class="modal-h"><div><h2 class="h">${m.id?`${esc(pcode(r.pid))} · ${esc(r.round)}`:'Log a sample round'}</h2><p class="muted small" style="margin:4px 0 0">Each round keeps its own measurements, feedback, photos and decision.</p></div><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="modal-b"><div class="grid3">
    ${m.id?'':sfld('pid','Product',r.pid,{type:'select',req:1,options:[['','Choose a product']].concat(prodOpts())})}
    ${sfld('round','Round',r.round,{req:1,ph:'S1'})}${sfld('status','Status',r.status,{type:'select',options:SAMPLE_ST})}${m.id?'':''}
    ${sfld('vendorId','Sampling vendor',r.vendorId,{type:'select',options:supOpts})}${sfld('requested','Requested on',r.requested,{type:'date'})}${sfld('due','Expected by',r.due,{type:'date'})}
    ${sfld('received','Received on',r.received,{type:'date'})}${sfld('fabric','Fabric used',r.fabric,{})}${sfld('patternVer','Pattern version',r.patternVer,{ph:'P2'})}
    ${sfld('who','Responsible',r.who,{type:'select',options:people().map(x=>[x.id,x.name])})}
    <div class="formsec">Measurements (cm)</div>
    <div class="span3"><div class="tablewrap"><table class="t"><thead><tr><th>Point of measure</th><th class="num">Spec</th><th class="num">Actual</th><th class="num">Tol ±</th><th class="num">Deviation</th><th></th></tr></thead><tbody>
    ${r.meas.map((x,i)=>{const d=dev(x);return `<tr><td><input class="inp sm" style="width:100%" name="pom_${i}" value="${esc(x.pom)}" aria-label="Point of measure"></td>
      <td class="num"><input class="inp sm" style="width:78px" type="number" step="any" name="spec_${i}" value="${esc(x.spec)}" data-mrow="${i}" aria-label="Spec"></td><td class="num"><input class="inp sm" style="width:78px" type="number" step="any" name="act_${i}" value="${esc(x.act)}" data-mrow="${i}" aria-label="Actual"></td>
      <td class="num"><input class="inp sm" style="width:64px" type="number" step="any" name="tol_${i}" value="${esc(x.tol)}" data-mrow="${i}" aria-label="Tolerance"></td><td class="num" id="dev_${i}">${devHtml(d)}</td>
      <td><button type="button" class="btn ghost sm" data-act="srmrow" data-i="${i}" aria-label="Remove row">${ic('x')}</button></td></tr>`}).join('')}
    </tbody></table></div><button type="button" class="btn sm" data-act="saddrow" style="margin-top:8px">${ic('plus')}Add measurement</button></div>
    <div class="formsec">Fit review checklist</div>
    <div class="span3 chkgrid">${FIT_CHECK.map((c,i)=>`<label class="field"><span class="small">${c}</span><select class="inp sm" name="chk_${i}">${['','OK','Issue','N/A'].map(o=>`<option value="${o}" ${(r.chk[i]||'')===o?'selected':''}>${o||'Not checked'}</option>`).join('')}</select></label>`).join('')}</div>
    <div class="formsec">Feedback & decision</div>
    ${sfld('fit','Fit feedback',r.fit,{type:'textarea',cls:'span3'})}${sfld('construction','Construction feedback',r.construction,{type:'textarea',cls:'span3'})}
    ${sfld('quality','Quality problems',r.quality,{type:'textarea',cls:'span3'})}${sfld('corrections','Corrections required for the next round',r.corrections,{type:'textarea',cls:'span3'})}
    ${sfld('decision','Decision note',r.decision,{cls:'span2',ph:'e.g. Rejected: shoulder pulls forward'})}${sfld('nextDue','Next sample due',r.nextDue,{type:'date'})}
    <div class="formsec">Fitting photos</div>
    <div class="span3 qa" style="align-items:center">${r.images.map((u,i)=>`<div style="position:relative"><img src="${u}" alt="Fitting photo ${i+1}" style="height:110px;border-radius:6px;border:1px solid var(--line)"><button type="button" class="btn sm" data-act="srmimg" data-i="${i}" style="position:absolute;top:4px;right:4px;padding:2px 4px" aria-label="Remove photo">${ic('x')}</button></div>`).join('')}
      ${r.images.length<3?`<label class="btn sm">${ic('img')}Add photo<input type="file" accept="image/*" data-on="simg" hidden></label>`:''}<span class="tiny muted">Up to 3 photos per round.</span></div>
  </div></div>
  <div class="modal-f">${m.id?`<button type="button" class="btn" data-act="sdel" style="margin-right:auto">${ic('trash')}Delete round</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save sample</button></div></form></div>`;
}
const devHtml=d=>d==null?'<span class="faint">—</span>':`<span class="pill ${d.out?'solid':''}" title="${d.out?'Outside tolerance':'Within tolerance'}">${d.v>0?'+':''}${d.v}</span>`;
function compareModal(m){
  const ss=samplesFor(m.pid);const p=prod(m.pid);const poms=[...new Set(ss.flatMap(s=>(s.meas||[]).map(x=>x.pom)).filter(Boolean))];
  const row=(l,fn)=>`<tr><td class="small muted" style="white-space:nowrap">${l}</td>${ss.map(s=>`<td class="small">${fn(s)}</td>`).join('')}</tr>`;
  return `<div class="modal wide" style="max-width:1080px"><div class="modal-h"><div><h2 class="h">${esc(p.code)}: rounds side by side</h2><p class="muted small" style="margin:4px 0 0">Actual / spec in cm. Solid marks fall outside tolerance.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="modal-b"><div class="tablewrap"><table class="t"><thead><tr><th></th>${ss.map(s=>`<th><span class="round-n" style="font-size:20px">${esc(s.round)}</span></th>`).join('')}</tr></thead><tbody>
  ${row('Status',s=>`<span class="pill ${stCls(s.status)}">${esc(s.status)}</span>`)}${row('Received',s=>fmtD(s.received))}${row('Vendor',s=>esc(supName(s.vendorId)||'—'))}${row('Fabric',s=>esc(s.fabric||'—'))}${row('Pattern',s=>esc(s.patternVer||'—'))}
  ${poms.map(pm=>row(esc(pm),s=>{const x=(s.meas||[]).find(y=>y.pom===pm);if(!x)return '<span class="faint">—</span>';const d=dev(x);return `${esc(x.act||'—')} <span class="tiny muted">/ ${esc(x.spec||'—')}</span> ${d&&d.v?devHtml(d):''}`})).join('')}
  ${row('Checklist issues',s=>FIT_CHECK.filter((c,i)=>(s.chk||{})[i]==='Issue').map(esc).join(', ')||'None recorded')}
  ${row('Fit feedback',s=>esc(s.fit||'—'))}${row('Construction',s=>esc(s.construction||'—'))}${row('Corrections',s=>esc(s.corrections||'—'))}${row('Decision',s=>esc(s.decision||'—'))}
  </tbody></table></div></div><div class="modal-f"><button class="btn" data-act="close">Close</button></div></div>`;
}
function roundsStrip(pid,filter){
  let ss=samplesFor(pid);if(filter)ss=ss.filter(s=>s.status===filter);
  return ss.length?`<div class="rounds">${ss.map(s=>{const late=SAMPLE_OPEN.includes(s.status)&&!s.received&&s.due&&s.due<TODAY;return `<button class="round" data-act="opensample" data-id="${s.id}"><span class="round-n">${esc(s.round)}</span><span class="pill ${stCls(s.status)}">${esc(s.status)}</span>
    <span class="tiny ${late?'':'muted'}" style="${late?'font-weight:700':''}">${s.received?'Received '+fmtD(s.received):s.due?(late?`${-diffD(TODAY,s.due)}d late · due `:'Expected ')+fmtD(s.due):'Requested '+fmtD(s.requested)}</span>
    ${s.vendorId?`<span class="tiny muted">${esc(supName(s.vendorId))}</span>`:''}${s.decision||s.corrections?`<span class="tiny clamp">${esc(s.decision||s.corrections)}</span>`:''}</button>`}).join('')}</div>`:'';
}
function vFitRoom(){
  const f=S.fit;const all=recs('samples').filter(s=>prod(s.pid));
  const ps=products().filter(p=>p.stage!==S_ARCHIVED&&(samplesFor(p.id).length||(p.stage>=4&&p.stage<=7))).filter(p=>!f.pid||p.id===f.pid).sort((a,b)=>a.code.localeCompare(b.code));
  const blocks=ps.map(p=>{const strip=roundsStrip(p.id,f.status);if(f.status&&!strip)return '';const n=samplesFor(p.id).length;
    return `<div class="panel" style="margin-bottom:14px"><div class="panel-h"><div><a href="#product-${p.id}" class="code" style="text-decoration:none">${esc(p.code)}</a> <span class="muted small">${esc(p.name)} · ${esc(STAGES[p.stage])}</span></div>
    <div class="qa">${n>1?`<button class="btn sm" data-act="cmpsample" data-pid="${p.id}">Compare rounds</button>`:''}<button class="btn sm pri" data-act="addsample" data-pid="${p.id}">${ic('plus')}${n?'Next round':'Log S1'}</button></div></div>
    <div class="panel-b">${strip||`<div class="tiny muted">No sample rounds logged yet.</div>`}</div></div>`}).join('');
  return `<div class="pagehead"><div><h1 class="title">Fit Room</h1><p class="sub">Every sample round, from request to approval, with measurements, fit notes and photos.</p></div>
    <div class="qa"><button class="btn" data-act="csvsamples">${ic('dl')}CSV</button><button class="btn pri" data-act="addsample" data-pid="">${ic('plus')}Log sample</button></div></div>
  <div class="kpis" style="grid-template-columns:repeat(6,1fr)">${SAMPLE_ST.map(s=>`<button class="kpi ${f.status===s?'alert':''}" data-act="fitstatus" data-v="${esc(s)}"><div class="v">${all.filter(x=>x.status===s).length}</div><div class="l">${s}</div></button>`).join('')}</div>
  <div class="toolbar"><select class="inp sm" data-on="xfilter" data-o="fit" data-k="pid"><option value="">All products</option>${prodOpts().map(([v,t])=>`<option value="${v}" ${f.pid===v?'selected':''}>${esc(t)}</option>`).join('')}</select>${f.status?`<button class="btn ghost sm" data-act="fitstatus" data-v="">Showing ${esc(f.status)} · clear</button>`:''}</div>
  ${blocks||`<div class="panel">${empty('Nothing in the Fit Room yet','Products in Tech Pack to Costing show up here automatically. Log the first round when a sample is requested.',`<button class="btn pri" data-act="addsample" data-pid="">${ic('plus')}Log sample</button>`)}</div>`}`;
}

/* =================== FABRICS & TRIMS =================== */
function usedIn(r){return (r.pids||[]).filter(prod).map(id=>`<a href="#product-${id}" class="code" style="text-decoration:none">${esc(pcode(id))}</a>`).join(', ')||'<span class="faint">—</span>'}
function vFabrics(){
  const f=S.fab,q=f.q.toLowerCase();const isF=f.tab==='fabrics';const coll=isF?'fabrics':'trims';
  const xs=recs(coll).filter(x=>(!f.cat||(isF?x.category:x.type)===f.cat)&&(!q||JSON.stringify(x).toLowerCase().includes(q))).sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  const th=x=>`<td style="width:44px">${x.image?`<span class="sw" style="background-image:url('${x.image}')"></span>`:'<span class="sw"></span>'}</td>`;
  const table=isF?`<table class="t"><thead><tr><th></th><th>ID</th><th>Fabric</th><th>Category</th><th>Composition</th><th class="num">GSM</th><th>Construction</th><th>Supplier</th><th class="num">Cost</th><th>MOQ</th><th class="num">Lead</th><th>Tests</th><th>Used in</th></tr></thead><tbody>
    ${xs.map(x=>`<tr class="click" data-act="editrec" data-coll="fabrics" data-id="${x.id}">${th(x)}<td class="code">${esc(x.code)}</td><td><b>${esc(x.name)}</b>${x.finish?`<div class="tiny muted">${esc(x.finish)}</div>`:''}</td><td>${esc(x.category||'—')}</td><td class="small">${esc(x.composition||'—')}</td><td class="num">${esc(x.gsm||'—')}</td><td class="small">${esc(x.construction||'—')}</td><td class="small">${esc(supName(x.supplierId)||'—')}</td><td class="num">${x.cost?inr(x.cost)+'/'+esc(x.costUnit||'m'):'—'}</td><td class="small">${esc(x.moq||'—')}</td><td class="num">${x.leadTime?esc(x.leadTime)+'d':'—'}</td><td><span class="pill ${x.testStatus==='Passed'?'solid':x.testStatus==='Failed'?'done':x.testStatus==='Testing'?'hatch':'dash'}">${esc(x.testStatus||'Untested')}</span></td><td>${usedIn(x)}</td></tr>`).join('')}</tbody></table>`
  :`<table class="t"><thead><tr><th></th><th>ID</th><th>Trim</th><th>Type</th><th>Specification</th><th>Supplier</th><th class="num">Cost</th><th>MOQ</th><th class="num">Lead</th><th>Used in</th></tr></thead><tbody>
    ${xs.map(x=>`<tr class="click" data-act="editrec" data-coll="trims" data-id="${x.id}">${th(x)}<td class="code">${esc(x.code)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.type||'—')}</td><td class="small">${esc(x.spec||'—')}</td><td class="small">${esc(supName(x.supplierId)||'—')}</td><td class="num">${x.cost?inr(x.cost)+(x.unit?'/'+esc(x.unit):''):'—'}</td><td class="small">${esc(x.moq||'—')}</td><td class="num">${x.leadTime?esc(x.leadTime)+'d':'—'}</td><td>${usedIn(x)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="pagehead"><div><h1 class="title">Fabrics & Trims</h1><p class="sub">The material library. Link a fabric or trim to as many products as use it.</p></div>
    <div class="qa"><div class="seg">${[['fabrics','Fabrics'],['trims','Trims']].map(([k,l])=>`<button class="${f.tab===k?'on':''}" data-act="fabtab" data-v="${k}">${l} <span class="faint">${recs(k).length}</span></button>`).join('')}</div>
    <button class="btn" data-act="csvrec" data-coll="${coll}">${ic('dl')}CSV</button><button class="btn pri" data-act="newrec" data-coll="${coll}">${ic('plus')}Add ${isF?'fabric':'trim'}</button></div></div>
  <div class="toolbar"><input class="inp sm" id="fq" data-on="xfilter" data-o="fab" data-k="q" placeholder="Search ${isF?'fabrics':'trims'}" value="${esc(f.q)}" style="width:220px">
    <select class="inp sm" data-on="xfilter" data-o="fab" data-k="cat"><option value="">${isF?'All categories':'All types'}</option>${(isF?FAB_CATS:TRIM_TYPES).map(k=>`<option ${f.cat===k?'selected':''}>${k}</option>`).join('')}</select></div>
  ${xs.length?`<div class="tablewrap">${table}</div>`:`<div class="panel">${empty(recs(coll).length?'Nothing matches':`No ${isF?'fabrics':'trims'} yet`,isF?'Record every fabric you test, with GSM, shrinkage and colourfastness results, so good research isn’t lost.':'Zippers, drawcords, rib, buttons, labels and accessories live here.',`<button class="btn pri" data-act="newrec" data-coll="${coll}">${ic('plus')}Add ${isF?'fabric':'trim'}</button>`)}</div>`}`;
}

/* =================== SUPPLIERS =================== */
function supPerf(sid){
  const s=D.suppliers[sid]||{};const lg=s.log||[];const ss=recs('samples').filter(x=>x.vendorId===sid&&prod(x.pid));
  const del=lg.filter(x=>x.type==='delivery'&&x.promised&&x.actual).map(x=>({ok:x.actual<=x.promised,late:diffD(x.promised,x.actual),src:x.note||'Delivery',date:x.actual}))
    .concat(ss.filter(x=>x.due&&x.received).map(x=>({ok:x.received<=x.due,late:diffD(x.due,x.received),src:`${pcode(x.pid)} ${x.round}`,date:x.received})));
  const q=lg.filter(x=>x.type==='quality').map(x=>({ok:!!x.ok,src:x.note||'Quality check',date:x.date}));
  return {del,q,ss,onTime:del.filter(x=>x.ok).length,qOk:q.filter(x=>x.ok).length};
}
function supProducts(sid){const set=new Set();recs('samples').forEach(x=>x.vendorId===sid&&set.add(x.pid));recs('fabrics').concat(recs('trims')).forEach(x=>x.supplierId===sid&&(x.pids||[]).forEach(p=>set.add(p)));return [...set].filter(prod)}
function vSuppliers(){
  const f=S.sup,q=f.q.toLowerCase();
  const xs=recs('suppliers').filter(x=>(!f.cat||x.category===f.cat)&&(!q||JSON.stringify(x).toLowerCase().includes(q))).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return `<div class="pagehead"><div><h1 class="title">Supplier Network</h1><p class="sub">Mills, units, makers and labs. Performance is counted only from deliveries, sample dates and quality checks you record. There are no ratings.</p></div>
    <div class="qa"><button class="btn" data-act="csvrec" data-coll="suppliers">${ic('dl')}CSV</button><button class="btn pri" data-act="newrec" data-coll="suppliers">${ic('plus')}Add supplier</button></div></div>
  <div class="toolbar"><input class="inp sm" id="sq" data-on="xfilter" data-o="sup" data-k="q" placeholder="Search suppliers" value="${esc(f.q)}" style="width:220px">
    <div class="seg" style="flex-wrap:wrap"><button class="${!f.cat?'on':''}" data-act="supcat" data-v="">All ${recs('suppliers').length}</button>${SUP_CATS.map(c=>{const n=recs('suppliers').filter(x=>x.category===c).length;return n?`<button class="${f.cat===c?'on':''}" data-act="supcat" data-v="${esc(c)}">${esc(c)} ${n}</button>`:''}).join('')}</div></div>
  ${xs.length?`<div class="tablewrap"><table class="t"><thead><tr><th>Supplier</th><th>Category</th><th>Location</th><th>Contact</th><th class="num">Lead time</th><th>Status</th><th>On time</th><th>Quality checks passed</th><th>Products</th></tr></thead><tbody>
    ${xs.map(x=>{const pf=supPerf(x.id);const pr=supProducts(x.id);return `<tr class="click" data-act="opensup" data-id="${x.id}"><td><b>${esc(x.name)}</b></td><td class="small">${esc(x.category||'—')}</td><td class="small">${esc(x.location||'—')}</td><td class="small">${esc(x.contact||'—')}${x.phone?`<div class="tiny muted">${esc(x.phone)}</div>`:''}</td><td class="num">${x.leadTime?esc(x.leadTime)+'d':'—'}</td>
      <td><span class="pill ${x.status==='Active'?'solid':x.status==='Inactive'?'dash':''}">${esc(x.status||'Active')}</span></td><td class="small">${pf.del.length?`${pf.onTime} of ${pf.del.length}`:'<span class="faint">No records</span>'}</td><td class="small">${pf.q.length?`${pf.qOk} of ${pf.q.length}`:'<span class="faint">No records</span>'}</td><td class="small">${pr.map(pcode).map(esc).join(', ')||'—'}</td></tr>`}).join('')}</tbody></table></div>`
  :`<div class="panel">${empty(recs('suppliers').length?'Nothing matches':'No suppliers yet','Add the mills, sampling units and manufacturers you work with. Samples, fabrics and expenses can then point to them.',`<button class="btn pri" data-act="newrec" data-coll="suppliers">${ic('plus')}Add supplier</button>`)}</div>`}`;
}
function supModal(m){
  const s=D.suppliers[m.id];if(!s)return '';const pf=supPerf(s.id);const pr=supProducts(s.id);
  const mats=recs('fabrics').filter(x=>x.supplierId===s.id).map(x=>x.code+' '+x.name).concat(recs('trims').filter(x=>x.supplierId===s.id).map(x=>x.code+' '+x.name));
  const dd=(k,v)=>v?`<dt>${k}</dt><dd>${esc(v)}</dd>`:'';
  return `<div class="modal wide"><div class="modal-h"><div><h2 class="h">${esc(s.name)}</h2><p class="muted small" style="margin:4px 0 0">${esc(s.category||'')}${s.location?' · '+esc(s.location):''} · ${esc(s.status||'Active')}</p></div><div class="qa"><button class="btn sm" data-act="editrec" data-coll="suppliers" data-id="${s.id}">${ic('edit')}Edit</button><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div></div>
  <div class="modal-b"><div class="grid2"><dl class="dl">${dd('Contact',s.contact)}${dd('Phone',s.phone)}${dd('Email',s.email)}${dd('MOQ',s.moq)}${dd('Lead time',s.leadTime&&s.leadTime+' days')}${dd('Price',s.price)}${dd('Capability',s.capability)}${dd('Quality notes',s.notes)}<dt>Products</dt><dd>${pr.map(pcode).map(esc).join(', ')||'—'}</dd><dt>Materials</dt><dd>${mats.map(esc).join(', ')||'—'}</dd></dl>
  <div><h3 class="h3">Recorded performance</h3>
    <div class="health-row"><div class="hv">${pf.del.length?pctTxt(pf.onTime,pf.del.length):'—'}</div><div><div class="small" style="font-weight:600">On-time</div><div class="tiny muted">${pf.del.length?`${pf.onTime} of ${pf.del.length} deliveries and samples arrived by the promised date`:'No delivery or sample dates recorded yet'}</div></div></div>
    <div class="health-row"><div class="hv">${pf.q.length?pctTxt(pf.qOk,pf.q.length):'—'}</div><div><div class="small" style="font-weight:600">Quality checks passed</div><div class="tiny muted">${pf.q.length?`${pf.qOk} of ${pf.q.length} recorded checks`:'No quality checks recorded yet'}</div></div></div>
    <div class="health-row"><div class="hv">${pf.ss.length}</div><div><div class="small" style="font-weight:600">Sample rounds</div><div class="tiny muted">${SAMPLE_ST.map(st=>[st,pf.ss.filter(x=>x.status===st).length]).filter(x=>x[1]).map(([a,b])=>`${b} ${a.toLowerCase()}`).join(', ')||'None'}</div></div></div>
  </div></div>
  <h3 class="h3" style="margin:18px 0 8px">Record an outcome</h3>
  <div class="grid3" style="grid-template-columns:repeat(6,minmax(0,1fr))"><select class="inp sm" id="so_type" aria-label="Type"><option value="delivery">Delivery</option><option value="quality">Quality check</option></select>
    <label class="tiny muted">Promised / check date<input class="inp sm" type="date" id="so_prom" style="width:100%"></label><label class="tiny muted">Delivered on<input class="inp sm" type="date" id="so_act" style="width:100%"></label>
    <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="so_ok">Quality passed</label><input class="inp sm" id="so_note" placeholder="What was it?" style="grid-column:span 1"><button class="btn sm pri" data-act="soadd" data-id="${s.id}">Record</button></div>
  <p class="tiny muted">Deliveries need both dates. For a quality check, use the first date and tick if it passed.</p>
  ${(s.log||[]).length||pf.ss.length?`<ul class="list" style="margin-top:8px">${(s.log||[]).map((x,i)=>({x,i})).sort((a,b)=>((a.x.actual||a.x.date||'')<(b.x.actual||b.x.date||'')?1:-1)).map(({x,i})=>`<li class="li small"><span style="width:90px" class="tiny muted">${fmtD(x.actual||x.date||x.promised)}</span><span style="flex:1">${x.type==='delivery'?`Delivery ${x.actual<=x.promised?'on time':`${diffD(x.promised,x.actual)}d late`}`:`Quality check ${x.ok?'passed':'failed'}`}${x.note?` · ${esc(x.note)}`:''}</span><button class="btn ghost sm" data-act="sorm" data-id="${s.id}" data-i="${i}" aria-label="Remove">${ic('x')}</button></li>`).join('')}
    ${pf.ss.map(x=>`<li class="li small click" data-act="opensample" data-id="${x.id}"><span style="width:90px" class="tiny muted">${fmtD(x.received||x.requested)}</span><span style="flex:1">${esc(pcode(x.pid))} ${esc(x.round)} · ${esc(x.status)}${x.due&&x.received?` · ${x.received<=x.due?'on time':`${diffD(x.due,x.received)}d late`}`:''}</span></li>`).join('')}</ul>`:''}
  </div><div class="modal-f"><button class="btn" data-act="close">Close</button></div></div>`;
}

/* =================== COSTING =================== */
const sheetsFor=pid=>recs('costsheets').filter(c=>c.pid===pid).sort((a,b)=>(a.createdAt<b.createdAt?-1:1));
const lineAmt=l=>{if(!l)return 0;const r=num(l.rate);if(r==null)return 0;const q=num(l.qty);return (q==null?1:q)*r};
const sheetTotal=cs=>COST_LINES.reduce((s,[k])=>s+lineAmt((cs.lines||{})[k]),0);
const approvedSheet=pid=>sheetsFor(pid).find(c=>c.approved);
const latestSheet=pid=>sheetsFor(pid).slice(-1)[0];
function econ(p,cost){
  const fin=cfg().finance||{};const mrp=num(p.mrp);if(!mrp||cost==null)return null;const gst=num(fin.gst);if(gst==null)return {needs:true};
  const nrp=mrp/(1+gst/100)*(1-(num(fin.disc)||0)/100);const gm=nrp-cost;
  const sell=(num(fin.mkt)||0)+(num(fin.ship)||0)+nrp*((num(fin.fees)||0)+(num(fin.returns)||0))/100;
  return {mrp,nrp,gm,gmPct:gm/nrp*100,sell,cm:gm-sell,cmPct:(gm-sell)/nrp*100};
}
const FIN=[['gst','GST included in MRP (%)'],['disc','Average discount (%)'],['mkt','Marketing cost per unit (₹)'],['ship','Customer shipping per unit (₹)'],['fees','Payment & platform fees (% of net price)'],['returns','Returns & RTO cost (% of net price)']];
function vCosting(){
  const ps=products().filter(p=>p.stage!==S_ARCHIVED).sort((a,b)=>a.code.localeCompare(b.code));
  if(!ps.length)return `<div class="pagehead"><div><h1 class="title">Costing</h1></div></div><div class="panel">${empty('No products to cost','Add a product first.')}</div>`;
  if(!prod(S.cost.pid))S.cost.pid=ps[0].id;
  const p=prod(S.cost.pid);
  return `<div class="pagehead"><div><h1 class="title">Costing & Product Economics</h1><p class="sub">Garment cost sheets by version, gross margin, and contribution after selling costs. All amounts in ₹.</p></div></div>
  <div class="twopane"><div class="panel" style="padding:6px"><ul class="list">${ps.map(x=>{const c=approvedSheet(x.id)||latestSheet(x.id);return `<li class="li click ${x.id===p.id?'sel':''}" data-act="costpick" data-id="${x.id}" style="padding:8px 10px;border-radius:6px"><div style="flex:1;min-width:0"><div class="code">${esc(x.code)}</div><div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</div></div><div class="tiny" style="text-align:right">${c?inr(Math.round(sheetTotal(c))):'<span class="faint">No sheet</span>'}${c&&c.approved?'<div class="tiny muted">approved</div>':''}</div></li>`}).join('')}</ul></div>
  <div>${costSheet(p,true)}</div></div>`;
}
function costSheet(p,full){
  const ss=sheetsFor(p.id);const canC=can('costsheets');
  if(!ss.length)return `<div class="panel">${empty(`No cost sheet for ${esc(p.code)}`,'Start with an estimate. Add a new version after each sample round so you can see where cost moved.',`<button class="btn pri" data-act="newsheet" data-pid="${p.id}">${ic('plus')}Start cost sheet</button>`)}</div>`;
  const cur=ss.find(x=>x.id===S.cost.ver&&x.pid===p.id)||ss[ss.length-1];const idx=ss.indexOf(cur);const prev=ss[idx-1];
  const tot=sheetTotal(cur);const est=num(p.estCost);const e=econ(p,tot);const ro=cur.approved||!canC;
  const L=cur.lines||{};
  return `<div class="panel"><div class="panel-h" style="flex-wrap:wrap"><div class="qa" style="align-items:center"><b class="code">${esc(p.code)}</b><div class="seg">${ss.map(x=>`<button class="${x.id===cur.id?'on':''}" data-act="selsheet" data-id="${x.id}">${esc(x.label||'v')}${x.approved?' ✓':''}</button>`).join('')}</div></div>
    <div class="qa"><button class="btn sm" data-act="newsheet" data-pid="${p.id}" data-from="${cur.id}">${ic('copy')}New version</button>
    ${cur.approved?`<button class="btn sm" data-act="unapprovesheet" data-id="${cur.id}">Withdraw approval</button>`:`<button class="btn sm pri" data-act="approvesheet" data-id="${cur.id}" ${['ops','founder'].includes(myRole())?'':'disabled title="Approved by Finance or Operations, or the Founder"'}>Approve this cost</button>`}
    <button class="btn sm" data-act="useestcost" data-id="${cur.id}" title="Copy this total into the product’s estimated cost">Use as estimated cost</button><button class="btn ghost sm" data-act="delsheet" data-id="${cur.id}" aria-label="Delete version">${ic('trash')}</button></div></div>
  <div class="panel-b">
    <div class="qa" style="margin-bottom:10px"><label class="tiny muted">Version name <input class="inp sm" value="${esc(cur.label||'')}" data-on="sheetmeta" data-id="${cur.id}" data-k="label" ${ro?'disabled':''} style="width:160px"></label><label class="tiny muted">Basis <input class="inp sm" value="${esc(cur.basis||'')}" data-on="sheetmeta" data-id="${cur.id}" data-k="basis" placeholder="Estimate, S2 actual…" ${ro?'disabled':''} style="width:180px"></label>
    ${cur.approved?`<span class="pill solid">Approved by ${esc(pname(cur.approvedBy))} · ${fmtTs(cur.approvedAt)}</span><span class="tiny muted">Approved sheets are locked. Make a new version to change them.</span>`:''}</div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Cost component</th><th class="num">Qty / consumption</th><th>Unit</th><th class="num">Rate (₹)</th><th class="num">Amount</th>${prev?`<th class="num">vs ${esc(prev.label)}</th>`:''}</tr></thead><tbody>
    ${COST_LINES.map(([k,l,u])=>{const x=L[k]||{};const a=lineAmt(x);const pa=prev?lineAmt((prev.lines||{})[k]):0;return `<tr><td>${l}</td>
      <td class="num"><input class="inp sm" type="number" step="any" min="0" style="width:90px" value="${esc(x.qty??'')}" placeholder="1" data-on="cl" data-id="${cur.id}" data-k="${k}" data-f="qty" ${ro?'disabled':''} aria-label="${l} quantity"></td>
      <td><input class="inp sm" style="width:64px" value="${esc(x.unit??u)}" data-on="cl" data-id="${cur.id}" data-k="${k}" data-f="unit" ${ro?'disabled':''} aria-label="${l} unit"></td>
      <td class="num"><input class="inp sm" type="number" step="any" min="0" style="width:100px" value="${esc(x.rate??'')}" data-on="cl" data-id="${cur.id}" data-k="${k}" data-f="rate" ${ro?'disabled':''} aria-label="${l} rate"></td>
      <td class="num">${a?inr(Math.round(a*100)/100):'<span class="faint">—</span>'}</td>${prev?`<td class="num small">${a-pa?(a-pa>0?'+':'−')+inr(Math.abs(Math.round((a-pa)*100)/100)).slice(0):'<span class="faint">0</span>'}</td>`:''}</tr>`}).join('')}
    <tr><td><b>Product cost</b></td><td></td><td></td><td></td><td class="num"><b>${inr(Math.round(tot*100)/100)}</b></td>${prev?`<td class="num"><b>${tot-sheetTotal(prev)>0?'+':tot-sheetTotal(prev)<0?'−':''}${inr(Math.abs(Math.round((tot-sheetTotal(prev))*100)/100))}</b></td>`:''}</tr></tbody></table></div>
    <div class="grid3" style="margin-top:16px">
      <div class="statbox"><div class="k">Estimated cost on the product</div><div class="vv">${est!=null?inr(est):'—'}</div><div class="tiny muted">${est!=null&&tot?`This version is ${tot>est?inr(Math.round(tot-est))+' above':tot<est?inr(Math.round(est-tot))+' below':'equal to'} it`:'Set with “Use as estimated cost”'}</div></div>
      <div class="statbox"><div class="k">Approved cost</div><div class="vv">${approvedSheet(p.id)?inr(Math.round(sheetTotal(approvedSheet(p.id)))):'—'}</div><div class="tiny muted">${approvedSheet(p.id)?esc(approvedSheet(p.id).label):'No version approved yet'}</div></div>
      <div class="statbox"><div class="k">Target MRP</div><div class="vv">${p.mrp?inr(p.mrp):'—'}</div><div class="tiny muted">${p.targetMargin?`Target gross margin ${esc(p.targetMargin)}%`:'No target margin set'}</div></div>
    </div>
    <h3 class="h3" style="margin:20px 0 8px">Economics</h3>
    ${!p.mrp?'<p class="small muted">Set a target MRP on the product to see margins.</p>':!e?'<p class="small muted">Add cost lines to see margins.</p>':e.needs?'<p class="small muted">Finance or Operations needs to set the GST assumption below before net price and margins can be calculated.</p>':
    `<div class="tablewrap"><table class="t"><tbody>
      <tr><td>MRP</td><td class="num">${inr(e.mrp)}</td><td class="tiny muted">Target MRP on the product</td></tr>
      <tr><td>Net realised price</td><td class="num">${inr(Math.round(e.nrp))}</td><td class="tiny muted">MRP ÷ (1 + GST) × (1 − average discount)</td></tr>
      <tr><td>Product cost</td><td class="num">${inr(Math.round(tot))}</td><td class="tiny muted">${esc(cur.label)}</td></tr>
      <tr><td><b>Product gross margin</b></td><td class="num"><b>${inr(Math.round(e.gm))} · ${e.gmPct.toFixed(1)}%</b></td><td class="tiny muted">Net price − product cost${p.targetMargin?` · target ${esc(p.targetMargin)}%`:''}</td></tr>
      <tr><td>Selling costs per unit</td><td class="num">${inr(Math.round(e.sell))}</td><td class="tiny muted">Marketing + shipping + fees + returns (finance assumptions)</td></tr>
      <tr><td><b>Contribution margin</b></td><td class="num"><b>${inr(Math.round(e.cm))} · ${e.cmPct.toFixed(1)}%</b></td><td class="tiny muted">Kept separate from gross margin</td></tr></tbody></table></div>`}
    ${full&&ss.length>1?`<h3 class="h3" style="margin:20px 0 8px">Version comparison</h3><div class="tablewrap"><table class="t"><thead><tr><th>Component</th>${ss.map(x=>`<th class="num">${esc(x.label)}${x.approved?' ✓':''}</th>`).join('')}</tr></thead><tbody>${COST_LINES.map(([k,l])=>`<tr><td class="small">${l}</td>${ss.map(x=>`<td class="num small">${lineAmt((x.lines||{})[k])?inr(Math.round(lineAmt((x.lines||{})[k]))):'—'}</td>`).join('')}</tr>`).join('')}<tr><td><b>Total</b></td>${ss.map(x=>`<td class="num"><b>${inr(Math.round(sheetTotal(x)))}</b></td>`).join('')}</tr></tbody></table></div>`:''}
    ${full?`<h3 class="h3" style="margin:20px 0 4px">Finance assumptions</h3><p class="tiny muted" style="margin:0 0 8px">Shared across all products. ${can('finance')?'You can edit these.':'Set by Finance / Operations or the Founder; read-only for your role.'} Blank selling costs count as ₹0.</p>
    <div class="grid3">${FIN.map(([k,l])=>`<label class="field"><span class="small">${l}</span><input class="inp sm" type="number" step="any" min="0" value="${esc((cfg().finance||{})[k]??'')}" data-on="fin" data-k="${k}" ${can('finance')?'':'disabled'} style="width:100%"></label>`).join('')}</div>`:''}
  </div></div>`;
}

/* =================== QUALITY =================== */
function qcFor(pid){return D.qc[pid]||{id:pid,pid,items:{}}}
function qcCounts(pid){const it=qcFor(pid).items||{};const v=QC_ITEMS.map((_,i)=>(it[i]||{}).s||'');return {pass:v.filter(x=>x==='Pass').length,fail:v.filter(x=>x==='Fail').length,na:v.filter(x=>x==='N/A').length,open:v.filter(x=>!x).length}}
function pQuality(p){
  const it=qcFor(p.id).items||{};const c=qcCounts(p.id);const ro=!can('qc');
  return `<p class="muted small" style="margin-top:-6px">${c.pass} passed · ${c.fail} failed · ${c.open} not checked · ${c.na} not applicable. Gate approvals are on the Approvals tab.</p>
  <div class="tablewrap"><table class="t"><thead><tr><th></th><th>Check</th><th>Result</th><th>Note</th><th>Last checked</th></tr></thead><tbody>
  ${QC_ITEMS.map((q,i)=>{const x=it[i]||{};return `<tr><td class="tiny faint">${pad(i+1)}</td><td><b>${q}</b></td><td><select class="inp sm" data-on="qc" data-pid="${p.id}" data-i="${i}" data-f="s" ${ro?'disabled':''} aria-label="${q} result">${['','Pass','Fail','N/A'].map(o=>`<option value="${o}" ${(x.s||'')===o?'selected':''}>${o||'Not checked'}</option>`).join('')}</select> ${x.s==='Fail'?'<span class="pill solid">Fail</span>':''}</td>
    <td><input class="inp sm" style="width:100%;min-width:200px" value="${esc(x.note||'')}" data-on="qc" data-pid="${p.id}" data-i="${i}" data-f="note" ${ro?'disabled':''} placeholder="What did you find?"></td><td class="tiny muted">${x.ts?`${fmtTs(x.ts)} · ${esc(pname(x.by))}`:'—'}</td></tr>`}).join('')}</tbody></table></div>`;
}
function vQuality(){
  const f=S.qa;
  const rows=[];products().filter(p=>p.stage!==S_ARCHIVED).forEach(p=>AP_TYPES.forEach(([t])=>{const a=apFor(p.id,t);
    if(f.status==='all'?a.status!=='none':f.status==='none'?(a.status==='none'&&p.stage>=6&&requiredFor(11).includes(t)&&(t!=='handover'||p.stage>=8)&&(t!=='bulkqc'||p.stage>=9)):a.status===f.status)rows.push({p,a,t})}));
  const cnt=s=>Object.values(D.approvals).filter(a=>a.status===s&&prod(a.pid)).length;
  const qcP=products().filter(p=>p.stage>=5&&p.stage<S_ARCHIVED).sort((a,b)=>a.code.localeCompare(b.code));
  const fails=[];qcP.forEach(p=>{const it=qcFor(p.id).items||{};QC_ITEMS.forEach((q,i)=>{if((it[i]||{}).s==='Fail')fails.push({p,q,n:it[i].note})})});
  return `<div class="pagehead"><div><h1 class="title">Quality & Approvals</h1><p class="sub">Every approval across products in one queue, and the quality checklist for products in sampling or later.</p></div>
    <div class="seg">${[['queue','Approval queue'],['qc','Quality checklist']].map(([k,l])=>`<button class="${f.tab===k?'on':''}" data-act="qatab" data-v="${k}">${l}</button>`).join('')}</div></div>
  ${f.tab==='queue'?`<div class="toolbar"><div class="seg">${[['pending',`Pending ${cnt('pending')}`],['rejected',`Changes required ${cnt('rejected')}`],['approved',`Approved ${cnt('approved')}`],['none','Due, not requested'],['all','All']].map(([k,l])=>`<button class="${f.status===k?'on':''}" data-act="qastatus" data-v="${k}">${l}</button>`).join('')}</div></div>
    ${rows.length?`<div class="tablewrap"><table class="t"><thead><tr><th>Product</th><th>Approval</th><th>Decided by</th><th>Status</th><th>Requested</th><th>Last decision</th><th>Required changes / note</th><th></th></tr></thead><tbody>
    ${rows.sort((x,y)=>(x.a.requestedAt||'')<(y.a.requestedAt||'')?-1:1).map(({p,a,t})=>{const mine=AP[t].roles.includes(myRole())&&!S.readOnly;return `<tr><td><a href="#product-${p.id}" class="code" style="text-decoration:none">${esc(p.code)}</a><div class="tiny muted">${esc(STAGES[p.stage])}</div></td><td><b>${AP[t].label}</b></td><td class="small">${AP[t].who}</td>
      <td>${{none:'<span class="pill dash">Not requested</span>',pending:'<span class="pill hatch">Pending</span>',approved:'<span class="pill solid">Approved</span>',rejected:'<span class="pill">Changes required</span>'}[a.status]}</td>
      <td class="tiny muted">${a.requestedAt?fmtTs(a.requestedAt):'—'}</td><td class="tiny muted">${a.decidedAt?`${fmtTs(a.decidedAt)} · ${esc(pname(a.decidedBy))}`:'—'}</td><td class="small" style="max-width:260px">${esc(a.note||'')}</td>
      <td style="white-space:nowrap">${a.status==='none'||a.status==='rejected'?`<button class="btn sm" data-act="aprequest" data-id="${p.id}" data-t="${t}">Request</button>`:''}${a.status!=='none'?` <button class="btn sm ${mine?'pri':''}" data-act="apdecide" data-id="${p.id}" data-t="${t}" ${mine?'':`disabled title="Only ${AP[t].who} can decide"`}>Decide</button>`:''}</td></tr>`}).join('')}</tbody></table></div>`
    :`<div class="panel">${empty('Nothing here','Approvals are requested from a product’s Approvals tab or from this queue.')}</div>`}`
  :`${fails.length?`<div class="notice">${ic('flag')}<div><b>${fails.length} open quality failure${fails.length>1?'s':''}.</b> ${fails.map(x=>`${esc(x.p.code)}: ${esc(x.q)}${x.n?` (${esc(x.n)})`:''}`).join('; ')}</div></div>`:''}
    ${qcP.length?`<div class="tablewrap"><table class="t"><thead><tr><th>Product</th><th>Stage</th>${QC_ITEMS.map((q,i)=>`<th class="num" title="${q}">${pad(i+1)}</th>`).join('')}<th class="num">Passed</th><th class="num">Failed</th></tr></thead><tbody>
    ${qcP.map(p=>{const it=qcFor(p.id).items||{};const c=qcCounts(p.id);return `<tr class="click" data-act="open" data-id="${p.id}" data-tab="quality"><td class="code">${esc(p.code)}</td><td class="small">${esc(STAGES[p.stage])}</td>${QC_ITEMS.map((q,i)=>{const s=(it[i]||{}).s;return `<td class="num" title="${esc(q)}: ${s||'not checked'}"><span class="qcdot ${s==='Pass'?'pass':s==='Fail'?'fail':s==='N/A'?'na':''}"></span></td>`}).join('')}<td class="num">${c.pass}/${QC_ITEMS.length-c.na}</td><td class="num">${c.fail?`<b>${c.fail}</b>`:0}</td></tr>`}).join('')}</tbody></table></div>
    <div class="legend"><span><span class="qcdot pass"></span>Pass</span><span><span class="qcdot fail"></span>Fail</span><span><span class="qcdot"></span>Not checked</span><span><span class="qcdot na"></span>N/A</span><span>${QC_ITEMS.map((q,i)=>`${pad(i+1)} ${q}`).join(' · ')}</span></div>`
    :`<div class="panel">${empty('No products in sampling yet','Products from the Sampling stage onward appear here.')}</div>`}`}`;
}

/* =================== PRODUCT TABS (new) =================== */
function pTechPack(p){
  const tp=Object.assign({sizes:'S, M, L, XL',rows:[],branding:'',labels:'',packaging:'',trimsSpec:'',frozen:false},p.tp||{});const ro=tp.frozen||!can('products');
  const sizes=tp.sizes.split(',').map(s=>s.trim()).filter(Boolean);
  return `${tp.frozen?`<div class="notice">${ic('lock')}<div><b>Tech pack frozen</b> on ${fmtD(tp.frozenOn)} by ${esc(pname(tp.frozenBy))}. Reopening it creates a new revision and sends approvals back for review. <button class="btn sm" data-act="tpunfreeze" data-id="${p.id}" style="margin-left:8px">Reopen tech pack</button></div></div>`:''}
  <div class="toolbar"><label class="small">Sizes <input class="inp sm" value="${esc(tp.sizes)}" data-on="tp" data-id="${p.id}" data-k="sizes" ${ro?'disabled':''} style="width:200px"></label><span class="tiny muted">Comma separated</span><div class="spacer"></div>
    ${ro?'':`<button class="btn sm" data-act="tprow" data-id="${p.id}">${ic('plus')}Add measurement</button><button class="btn sm pri" data-act="tpfreeze" data-id="${p.id}">${ic('lock')}Freeze tech pack</button>`}</div>
  <h3 class="h3" style="margin:0 0 8px">Size chart & tolerances (cm)</h3>
  <div class="tablewrap"><table class="t"><thead><tr><th>Point of measure</th>${sizes.map(s=>`<th class="num">${esc(s)}</th>`).join('')}<th class="num">Tol ±</th><th></th></tr></thead><tbody>
  ${tp.rows.map((r,i)=>`<tr><td><input class="inp sm" style="width:100%;min-width:160px" value="${esc(r.pom||'')}" data-on="tpcell" data-id="${p.id}" data-i="${i}" data-k="pom" ${ro?'disabled':''} aria-label="Point of measure"></td>${sizes.map(s=>`<td class="num"><input class="inp sm" type="number" step="any" style="width:70px" value="${esc((r.v||{})[s]??'')}" data-on="tpcell" data-id="${p.id}" data-i="${i}" data-k="v.${esc(s)}" ${ro?'disabled':''} aria-label="${esc(r.pom)} ${esc(s)}"></td>`).join('')}
    <td class="num"><input class="inp sm" type="number" step="any" style="width:60px" value="${esc(r.tol??'')}" data-on="tpcell" data-id="${p.id}" data-i="${i}" data-k="tol" ${ro?'disabled':''} aria-label="Tolerance"></td><td>${ro?'':`<button class="btn ghost sm" data-act="tprm" data-id="${p.id}" data-i="${i}" aria-label="Remove">${ic('x')}</button>`}</td></tr>`).join('')||`<tr><td colspan="${sizes.length+3}" class="small muted">No measurements yet. Add the points of measure you grade.</td></tr>`}
  </tbody></table></div>
  <div class="grid2" style="margin-top:16px">${[['branding','Branding specification','Logo placement, size, method'],['labels','Labels','Main, size, care and composition labels'],['trimsSpec','Trims specification','Zips, drawcords, rib, buttons'],['packaging','Packaging','Polybag, tissue, hangtag, folding']].map(([k,l,ph])=>`<div class="field"><label>${l}</label><textarea class="inp" rows="3" data-on="tp" data-id="${p.id}" data-k="${k}" placeholder="${ph}" ${ro?'disabled':''}>${esc(tp[k]||'')}</textarea></div>`).join('')}</div>
  <p class="tiny muted">Construction notes and wash care sit on the product record (Edit). Files such as the PDF tech pack go in Design & references as links.</p>`;
}
function pMaterials(p){
  const fs=recs('fabrics').filter(x=>(x.pids||[]).includes(p.id)),ts=recs('trims').filter(x=>(x.pids||[]).includes(p.id));
  const avF=recs('fabrics').filter(x=>!(x.pids||[]).includes(p.id)),avT=recs('trims').filter(x=>!(x.pids||[]).includes(p.id));
  const block=(t,xs,coll,av)=>`<div class="panel"><div class="panel-h"><h3 class="h3">${t}</h3><div class="qa">${av.length?`<select class="inp sm" data-on="linkmat" data-coll="${coll}" data-pid="${p.id}" aria-label="Link ${coll}"><option value="">Link existing…</option>${av.map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select>`:''}<button class="btn sm" data-act="newrec" data-coll="${coll}" data-pid="${p.id}">${ic('plus')}New</button></div></div><div class="panel-b">
    ${xs.length?`<ul class="list">${xs.map(x=>`<li class="li"><span class="sw" ${x.image?`style="background-image:url('${x.image}')"`:''}></span><div style="flex:1;min-width:0" class="click" data-act="editrec" data-coll="${coll}" data-id="${x.id}"><b>${esc(x.code)}</b> ${esc(x.name)}<div class="tiny muted">${coll==='fabrics'?[x.composition,x.gsm&&x.gsm+' GSM',x.construction,supName(x.supplierId),x.testStatus].filter(Boolean).map(esc).join(' · '):[x.type,x.spec,supName(x.supplierId)].filter(Boolean).map(esc).join(' · ')}</div></div><button class="btn ghost sm" data-act="unlinkmat" data-coll="${coll}" data-id="${x.id}" data-pid="${p.id}">Unlink</button></li>`).join('')}</ul>`:'<div class="tiny muted">Nothing linked yet.</div>'}</div></div>`;
  return `<div class="grid2">${block('Fabrics',fs,'fabrics',avF)}${block('Trims',ts,'trims',avT)}</div><p class="tiny muted">${p.fabric?`The product record also names “${esc(p.fabric)}” as its fabric.`:''}</p>`;
}
function pSampling(p){
  const ss=samplesFor(p.id);
  return `<div class="toolbar"><button class="btn pri" data-act="addsample" data-pid="${p.id}">${ic('plus')}${ss.length?'Log next round':'Log S1'}</button>${ss.length>1?`<button class="btn" data-act="cmpsample" data-pid="${p.id}">Compare rounds</button>`:''}</div>
  ${ss.length?roundsStrip(p.id)+`<div class="tablewrap" style="margin-top:14px"><table class="t"><thead><tr><th>Round</th><th>Status</th><th>Vendor</th><th>Received</th><th>Pattern</th><th>Out of tolerance</th><th>Checklist issues</th><th>Decision</th></tr></thead><tbody>
    ${ss.map(s=>`<tr class="click" data-act="opensample" data-id="${s.id}"><td class="code">${esc(s.round)}</td><td><span class="pill ${stCls(s.status)}">${esc(s.status)}</span></td><td class="small">${esc(supName(s.vendorId)||'—')}</td><td class="small">${fmtD(s.received)}</td><td class="small">${esc(s.patternVer||'—')}</td><td class="small">${(s.meas||[]).filter(x=>{const d=dev(x);return d&&d.out}).map(x=>esc(x.pom)).join(', ')||'None'}</td><td class="small">${FIT_CHECK.filter((c,i)=>(s.chk||{})[i]==='Issue').map(esc).join(', ')||'None'}</td><td class="small">${esc(s.decision||'—')}</td></tr>`).join('')}</tbody></table></div>`
  :`<div class="panel">${empty('No sample rounds yet','Log S1 when you request it. Each round keeps its own measurements, fit review and decision.')}</div>`}`;
}
function pCosting(p){return `<p class="muted small" style="margin-top:-6px">Same cost sheets as the Costing module. <a href="#costing" data-act="costpick" data-id="${p.id}">Open in Costing</a> to edit finance assumptions or compare all versions.</p>${costSheet(p,false)}`}

/* =================== TASKS (department task management) =================== */
function taskFilter(ts){
  const f=S.tasks;const we=addDays(weekStart(TODAY),6);
  if(f.scope==='mine')ts=ts.filter(t=>t.who===S.me);else if(f.who)ts=ts.filter(t=>t.who===f.who);
  if(f.status==='open'&&f.view!=='board')ts=ts.filter(t=>t.status!=='done');else if(f.status&&f.status!=='open'&&f.view!=='board')ts=ts.filter(t=>t.status===f.status);
  if(f.type)ts=ts.filter(t=>(t.type||'Product development')===f.type);
  if(f.pid)ts=ts.filter(t=>f.pid==='__none'?!t.pid:t.pid===f.pid);
  if(f.due==='overdue')ts=ts.filter(t=>t.status!=='done'&&t.due&&t.due<TODAY);else if(f.due==='week')ts=ts.filter(t=>t.due&&t.due>=TODAY&&t.due<=we);else if(f.due==='nodate')ts=ts.filter(t=>!t.due);
  if(f.q)ts=ts.filter(t=>(t.title+' '+(t.notes||'')+' '+pcode(t.pid)).toLowerCase().includes(f.q.toLowerCase()));
  return ts.sort((a,b)=>(a.status==='done')-(b.status==='done')||((a.due||'9')<(b.due||'9')?-1:(a.due||'9')>(b.due||'9')?1:(a.priority>b.priority?1:-1)));
}
const tMeta=t=>{const c=t.checklist||[];const n=(t.comments||[]).length;return `${c.length?`<span class="tiny muted" title="Checklist">☐ ${c.filter(x=>x.done).length}/${c.length}</span>`:''}${n?`<span class="tiny muted" title="Updates">${n} update${n>1?'s':''}</span>`:''}`};
function taskTable(ts,showProd){
  if(!ts.length)return `<div class="panel">${empty('No tasks here','Tasks keep next steps visible without extra meetings. Product work and department work both live here.',`<button class="btn" data-act="newtask">${ic('plus')}Add task</button>`)}</div>`;
  return `<div class="tablewrap"><table class="t"><thead><tr><th style="width:30px"></th><th>Task</th>${showProd?'<th>Product</th>':''}<th>Type</th><th>Owner</th><th>Due</th><th>Pri</th><th>Status</th><th></th></tr></thead><tbody>
  ${ts.map(t=>{const late=t.status!=='done'&&t.due&&t.due<TODAY;return `<tr><td><input type="checkbox" aria-label="Mark done" ${t.status==='done'?'checked':''} data-on="taskdone" data-id="${t.id}"></td>
  <td class="click" data-act="edittask" data-id="${t.id}" style="cursor:pointer;min-width:220px"><span class="${t.status==='done'?'muted':''}" style="${t.status==='done'?'text-decoration:line-through':''}">${esc(t.title)}</span><div class="qa" style="gap:10px">${tMeta(t)}${t.notes?`<span class="tiny muted">${esc(t.notes.slice(0,70))}</span>`:''}</div></td>
  ${showProd?`<td>${prod(t.pid)?`<a href="#product-${t.pid}" class="code" style="text-decoration:none">${esc(pcode(t.pid))}</a>`:'<span class="faint">—</span>'}</td>`:''}<td class="small">${esc(t.type||'Product development')}</td>
  <td class="small">${esc(pname(t.who))}</td><td class="small" style="${late?'font-weight:700':''}">${t.due?fmtD(t.due)+(late?' · late':''):'—'}</td><td>${priMark(t.priority)}</td>
  <td><select class="inp sm" data-on="taskstatus" data-id="${t.id}" aria-label="Status">${Object.entries(TSTAT).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('')}</select></td>
  <td><button class="btn ghost sm" data-act="deltask" data-id="${t.id}" aria-label="Delete task">${ic('trash')}</button></td></tr>`}).join('')}</tbody></table></div>`;
}
const tCard=t=>{const late=t.status!=='done'&&t.due&&t.due<TODAY;return `<article class="card tcard" draggable="true" data-tdrag="${t.id}" data-act="edittask" data-id="${t.id}" tabindex="0">
  <div class="row"><span class="tiny muted">${esc(t.type||'Product development')}</span>${priMark(t.priority)}</div><div class="nm" style="${t.status==='done'?'text-decoration:line-through;color:var(--ink3)':''}">${esc(t.title)}</div>
  <div class="row"><span class="tiny" style="${late?'font-weight:700':''}">${t.pid&&prod(t.pid)?`<b>${esc(pcode(t.pid))}</b> · `:''}${t.due?fmtD(t.due)+(late?' · late':''):'No date'}</span>${av(t.who)}</div><div class="qa" style="gap:8px">${tMeta(t)}</div></article>`};
function vTasks(){
  const f=S.tasks;const all=recs('tasks');const ts=taskFilter(all);
  const mine=products().filter(p=>p.owner===S.me&&isActive(p));
  const mySamples=recs('samples').filter(s=>s.who===S.me&&SAMPLE_OPEN.includes(s.status)&&prod(s.pid));
  const myAp=pendingApprovals().filter(a=>AP[a.type].roles.includes(myRole()));
  const we=addDays(weekStart(TODAY),6);
  const load=people().map(p=>{const o=all.filter(t=>t.who===p.id&&t.status!=='done');return {p,open:o.length,late:o.filter(t=>t.due&&t.due<TODAY).length,week:o.filter(t=>t.due&&t.due>=TODAY&&t.due<=we).length,blocked:o.filter(t=>t.status==='blocked').length,prods:products().filter(x=>x.owner===p.id&&isActive(x)).length}});
  let body='';
  if(f.view==='board')body=`<div class="board" style="grid-auto-columns:minmax(260px,1fr)">${Object.entries(TSTAT).map(([k,l])=>{const c=ts.filter(t=>t.status===k);return `<section class="colk" data-tdrop="${k}"><div class="colk-h"><span class="t">${l}</span><span class="c">${c.length}</span></div><div class="colk-b">${(k==='done'?c.slice(0,25):c).map(tCard).join('')||'<div class="tiny faint" style="padding:8px 4px">Drop here</div>'}</div></section>`}).join('')}</div>`;
  else if(f.view==='agenda'){const g=[['Overdue',t=>t.due&&t.due<TODAY],['Today',t=>t.due===TODAY],['This week',t=>t.due>TODAY&&t.due<=we],['Next week',t=>t.due>we&&t.due<=addDays(we,7)],['Later',t=>t.due>addDays(we,7)],['No date',t=>!t.due]];const open=ts.filter(t=>t.status!=='done');
    body=g.map(([l,fn])=>{const xs=open.filter(fn);return xs.length?`<h3 class="h3" style="margin:18px 0 8px">${l} <span class="faint">${xs.length}</span></h3>${taskTable(xs,true)}`:''}).join('')||`<div class="panel">${empty('No open tasks','')}</div>`}
  else if(f.view==='people')body=`<div class="board" style="grid-auto-columns:minmax(260px,1fr)">${people().concat([{id:'',name:'Unassigned'}]).map(p=>{const xs=ts.filter(t=>t.status!=='done'&&(p.id?t.who===p.id:!person(t.who)));if(!p.id&&!xs.length)return '';return `<section class="colk"><div class="colk-h"><span class="av">${esc(initials(p.name))}</span><span class="t">${esc(p.name)}</span><span class="c">${xs.length}</span></div><div class="colk-b">${xs.map(tCard).join('')||'<div class="tiny faint" style="padding:8px 4px">No open tasks</div>'}</div></section>`}).join('')}</div>`;
  else body=taskTable(ts,true);
  return `<div class="pagehead"><div><h1 class="title">${f.scope==='mine'?'My Workspace':'Department tasks'}</h1><p class="sub">${f.scope==='mine'?(me().name===ROLES[myRole()]?esc(me().name):`${esc(me().name)} · ${esc(ROLES[myRole()])}`):`${all.filter(t=>t.status!=='done').length} open across the department`}</p></div>
    <div class="qa"><div class="seg">${[['mine','Mine'],['all','Everyone']].map(([k,l])=>`<button class="${f.scope===k?'on':''}" data-act="taskscope" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="seg">${[['list','List'],['board','Board'],['agenda','Agenda'],['people','By person']].map(([k,l])=>`<button class="${f.view===k?'on':''}" data-act="taskview" data-v="${k}">${l}</button>`).join('')}</div>
    <button class="btn" data-act="csvtasks">${ic('dl')}CSV</button><button class="btn pri" data-act="newtask">${ic('plus')}Add task</button></div></div>
  ${f.scope==='mine'?`<div class="grid3" style="margin-bottom:18px">
    <div class="panel"><div class="panel-h"><h3 class="h3">Products I own</h3><span class="tiny muted">${mine.length}</span></div><div class="panel-b">${mine.length?`<ul class="list">${mine.map(p=>{const nm=nextMs(p.id);return `<li class="li click small" data-act="open" data-id="${p.id}"><div style="flex:1;min-width:0"><b class="code">${esc(p.code)}</b> <span class="muted">${esc(STAGES[p.stage])}</span><div class="tiny muted">${p.nextAction?esc(p.nextAction):'No next action set'}</div></div><span class="tiny muted">${nm?fmtD(nm.target):''}</span></li>`}).join('')}</ul>`:'<div class="tiny muted">None active.</div>'}</div></div>
    <div class="panel"><div class="panel-h"><h3 class="h3">My open sample rounds</h3><span class="tiny muted">${mySamples.length}</span></div><div class="panel-b">${mySamples.length?`<ul class="list">${mySamples.map(s=>`<li class="li click small" data-act="opensample" data-id="${s.id}"><b class="code">${esc(pcode(s.pid))} ${esc(s.round)}</b><span style="flex:1" class="muted">${esc(s.status)}</span><span class="tiny muted">${s.due?fmtD(s.due):''}</span></li>`).join('')}</ul>`:'<div class="tiny muted">None.</div>'}</div></div>
    <div class="panel"><div class="panel-h"><h3 class="h3">Approvals waiting on me</h3><span class="tiny muted">${myAp.length}</span></div><div class="panel-b">${myAp.length?`<ul class="list">${myAp.map(a=>`<li class="li click small" data-act="open" data-id="${a.pid}" data-tab="approvals"><b class="code">${esc(pcode(a.pid))}</b><span style="flex:1" class="muted">${AP[a.type].label}</span></li>`).join('')}</ul>`:'<div class="tiny muted">None.</div>'}</div></div></div>`
  :`<div class="kpis" style="grid-template-columns:repeat(${Math.min(load.length,5)},1fr)">${load.map(l=>`<button class="kpi ${f.who===l.p.id?'alert':''}" data-act="taskwho" data-v="${l.p.id}"><div class="v">${l.open}</div><div class="l">${esc(l.p.name)}</div><div class="f">${l.week} due this week · ${l.late} late · ${l.blocked} blocked · ${l.prods} products</div></button>`).join('')}</div>`}
  <div class="toolbar"><input class="inp sm" id="tq" data-on="tfilter" data-k="q" placeholder="Search tasks" value="${esc(f.q)}" style="width:180px">
    ${f.view==='board'?'':`<select class="inp sm" data-on="tfilter" data-k="status"><option value="open" ${f.status==='open'?'selected':''}>Open tasks</option><option value="" ${f.status===''?'selected':''}>All statuses</option>${Object.entries(TSTAT).map(([k,v])=>`<option value="${k}" ${f.status===k?'selected':''}>${v}</option>`).join('')}</select>`}
    <select class="inp sm" data-on="tfilter" data-k="type"><option value="">All types</option>${TASK_TYPES.map(k=>`<option ${f.type===k?'selected':''}>${k}</option>`).join('')}</select>
    <select class="inp sm" data-on="tfilter" data-k="due"><option value="">Any due date</option>${[['overdue','Overdue'],['week','Due this week'],['nodate','No date']].map(([k,v])=>`<option value="${k}" ${f.due===k?'selected':''}>${v}</option>`).join('')}</select>
    <select class="inp sm" data-on="tfilter" data-k="pid"><option value="">Any product</option><option value="__none" ${f.pid==='__none'?'selected':''}>Department work (no product)</option>${prodOpts().map(([v,t])=>`<option value="${v}" ${f.pid===v?'selected':''}>${esc(t)}</option>`).join('')}</select>
    ${f.scope!=='mine'?`<select class="inp sm" data-on="tfilter" data-k="who"><option value="">Everyone</option>${people().map(p=>`<option value="${p.id}" ${f.who===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`:''}
    ${f.q||f.type||f.due||f.pid||f.who?`<button class="btn ghost sm" data-act="tclear">Clear</button>`:''}</div>
  ${body}`;
}
function pTasks(p){const ts=tasksFor(p.id).sort((a,b)=>(a.status==='done')-(b.status==='done')||((a.due||'9')<(b.due||'9')?-1:1));return `<div class="toolbar"><button class="btn pri" data-act="newtask" data-pid="${p.id}">${ic('plus')}Add task</button></div>${taskTable(ts,false)}`}
function taskModal(m){
  const base=m.id?D.tasks[m.id]:{title:m.title||'',pid:m.pid||'',who:S.me,due:m.due||'',priority:'P2',status:'todo',notes:'',type:m.type||(m.pid?'Product development':'Department')};
  if(!base)return '';
  const t=Object.assign({},base,m.draft||{});const cl=(m.id?D.tasks[m.id].checklist:null)||[];const cm=(m.id?D.tasks[m.id].comments:null)||[];
  return `<div class="modal wide"><form id="tform"><div class="modal-h"><h2 class="h">${m.id?'Task':m.review?'Schedule review':'New task'}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="modal-b"><div class="grid3">${fld('title','Task',t.title,{req:true,cls:'span3'})}
    ${fld('type','Type',t.type||'Product development',{type:'select',options:TASK_TYPES.map(x=>[x,x])})}${fld('pid','Product',t.pid,{type:'select',options:prodOptsNone()})}${fld('who','Owner',t.who,{type:'select',options:people().map(x=>[x.id,x.name])})}
    ${fld('due',m.review?'Review date':'Due date',t.due,{type:'date',req:!!m.review})}${fld('priority','Priority',t.priority,{type:'select',options:PRIORITIES.map(x=>[x,x])})}${fld('status','Status',t.status,{type:'select',options:Object.entries(TSTAT)})}
    ${fld('notes','Notes',t.notes,{type:'textarea',cls:'span3'})}</div>
  ${m.id?`<div class="grid2" style="margin-top:16px"><div><h3 class="h3">Checklist <span class="faint">${cl.filter(x=>x.done).length}/${cl.length}</span></h3><ul class="list" style="margin:6px 0">${cl.map((x,i)=>`<li class="li small" style="padding:6px 0"><input type="checkbox" ${x.done?'checked':''} data-on="tcheck" data-i="${i}" aria-label="Done"><span style="flex:1;${x.done?'text-decoration:line-through;color:var(--ink3)':''}">${esc(x.t)}</span><button type="button" class="btn ghost sm" data-act="tcrm" data-i="${i}" aria-label="Remove">${ic('x')}</button></li>`).join('')}</ul>
      <div class="qa"><input class="inp sm" id="tcnew" placeholder="Add a step" style="flex:1"><button type="button" class="btn sm" data-act="tcadd">Add</button></div></div>
    <div><h3 class="h3">Updates</h3><ul class="list" style="margin:6px 0;max-height:220px;overflow:auto">${cm.slice().reverse().map(c=>`<li class="li small" style="align-items:flex-start;padding:7px 0"><span class="av">${esc(initials(pname(c.by)))}</span><div style="flex:1"><div class="tiny muted">${esc(pname(c.by))} · ${fmtTs(c.ts)}</div>${esc(c.text)}</div></li>`).join('')||'<li class="li tiny muted">No updates yet.</li>'}</ul>
      <div class="qa"><input class="inp sm" id="tcom" placeholder="Post an update or question" style="flex:1"><button type="button" class="btn sm" data-act="tcpost">Post</button></div></div></div>`:'<p class="tiny muted" style="margin-top:12px">Checklist and updates become available after the task is created.</p>'}
  </div><div class="modal-f">${m.id?`<button type="button" class="btn" data-act="deltask" data-id="${m.id}" style="margin-right:auto">${ic('trash')}Delete</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">${m.id?'Save task':m.review?'Schedule review':'Add task'}</button></div></form></div>`;
}
function capTask(){const f=$('#tform');if(f&&S.modal)S.modal.draft=formData(f)}
function bindTaskDnD(){
  document.querySelectorAll('[data-tdrag]').forEach(el=>{el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/task',el.dataset.tdrag);el.classList.add('dragging')});el.addEventListener('dragend',()=>el.classList.remove('dragging'))});
  document.querySelectorAll('[data-tdrop]').forEach(col=>{col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop')});col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('drop')});
    col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('drop');const id=e.dataTransfer.getData('text/task');const t=D.tasks[id];if(!t||!guard('tasks'))return;const st=col.dataset.tdrop;if(t.status===st)return;
      const x=clone(t);x.status=st;x.doneAt=st==='done'?new Date().toISOString():'';put('tasks',x);if(st==='done'||st==='blocked')log(`Task ${st==='done'?'completed':'blocked'}: ${x.title}`,x.pid,'task')})});
}

/* =================== TEAM & HIRING =================== */
const PLANNED_ROLES=[['Product Development Coordinator','Full-time'],['Associate Designer','Full-time'],['Technical Pattern Specialist','Full-time'],['Sampling Partner','External / freelance']];
function vTeam(){
  const f=S.team;const all=recs('tasks');const we=addDays(weekStart(TODAY),6);
  const hires=recs('hires').sort((a,b)=>(a.priority>b.priority?1:-1));
  let body='';
  if(f.tab==='people')body=`<div class="lib" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${people().map(p=>{const o=all.filter(t=>t.who===p.id&&t.status!=='done');const prs=products().filter(x=>x.owner===p.id&&isActive(x));const ms=prs.map(x=>nextMs(x.id)).filter(Boolean).sort((a,b)=>a.target<b.target?-1:1);
    return `<div class="panel"><div class="panel-b" style="padding-top:16px"><div class="qa" style="align-items:center"><span class="av" style="width:40px;height:40px;font-size:13px">${esc(initials(p.name))}</span><div style="flex:1"><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.title||ROLES[p.role])}${p.external?' · external':''}</div></div><button class="btn ghost sm" data-act="editperson" data-id="${p.id}">Edit</button></div>
    ${p.resp?`<p class="small" style="white-space:pre-line">${esc(p.resp)}</p>`:'<p class="tiny muted">No responsibilities written yet.</p>'}
    <dl class="dl"><dt>Access role</dt><dd>${esc(ROLES[p.role])}</dd><dt>Products owned</dt><dd>${prs.map(x=>`<a href="#product-${x.id}">${esc(x.code)}</a>`).join(', ')||'—'}</dd><dt>Open tasks</dt><dd>${o.length} · ${o.filter(t=>t.due&&t.due<TODAY).length} late</dd><dt>Next milestone</dt><dd>${ms[0]?`${esc(pcode(ms[0].pid))} ${MS_LABEL[ms[0].type]} · ${fmtD(ms[0].target)}`:'—'}</dd></dl>
    <button class="btn sm" data-act="taskof" data-v="${p.id}" style="margin-top:8px">See tasks</button></div></div>`}).join('')}
    <div class="panel"><div class="panel-b" style="padding-top:16px"><b>Department structure</b><ul class="list" style="margin-top:8px">${[['Founder / Creative Director','founder'],['Product Lead','lead']].map(([l,r])=>`<li class="li small"><span style="flex:1">${l}</span><span class="pill solid">${people().some(p=>p.role===r)?'Filled':'Open'}</span></li>`).join('')}
    ${PLANNED_ROLES.map(([r,k])=>{const h=hires.find(x=>x.role===r);const filled=people().some(p=>(p.title||'')===r);return `<li class="li small"><span style="flex:1">${r}<div class="tiny muted">${k}</div></span><span class="pill ${filled?'solid':h?'hatch':'dash'}">${filled?'Filled':h?esc(h.stage):'Not planned'}</span></li>`}).join('')}</ul>
    <button class="btn sm" data-act="newperson">${ic('plus')}Add person</button></div></div></div>`;
  else if(f.tab==='workload')body=`<div class="tablewrap"><table class="t"><thead><tr><th>Person</th><th class="num">Open tasks</th><th class="num">Due this week</th><th class="num">Late</th><th class="num">Blocked</th><th class="num">Products owned</th><th class="num">Open sample rounds</th><th class="num">Approvals waiting</th></tr></thead><tbody>
    ${people().map(p=>{const o=all.filter(t=>t.who===p.id&&t.status!=='done');return `<tr class="click" data-act="taskof" data-v="${p.id}"><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.title||ROLES[p.role])}</div></td><td class="num">${o.length}</td><td class="num">${o.filter(t=>t.due&&t.due>=TODAY&&t.due<=we).length}</td><td class="num">${o.filter(t=>t.due&&t.due<TODAY).length}</td><td class="num">${o.filter(t=>t.status==='blocked').length}</td><td class="num">${products().filter(x=>x.owner===p.id&&isActive(x)).length}</td><td class="num">${recs('samples').filter(s=>s.who===p.id&&SAMPLE_OPEN.includes(s.status)).length}</td><td class="num">${pendingApprovals().filter(a=>AP[a.type].roles.includes(p.role)).length}</td></tr>`}).join('')}</tbody></table></div>
    <p class="tiny muted">Workload is counted from assigned records only. The Lab doesn’t track time or score people.</p>`;
  else{const bud=hires.filter(h=>!['Hired','On hold'].includes(h.stage)).reduce((s,h)=>s+(num(h.budget)||0),0);
    body=`${hires.length?`<div class="tablewrap"><table class="t"><thead><tr><th>Role</th><th>Type</th><th>Priority</th><th>Reason</th><th class="num">Budget / month</th><th>Target start</th><th>Stage</th></tr></thead><tbody>
    ${hires.map(h=>`<tr><td class="click" data-act="editrec" data-coll="hires" data-id="${h.id}" style="cursor:pointer"><b>${esc(h.role)}</b></td><td class="small">${esc(h.kind||'—')}</td><td>${esc(h.priority||'—')}</td><td class="small" style="max-width:320px">${esc(h.reason||'')||'<span class="faint">Add the reason</span>'}</td><td class="num">${h.budget?inr(h.budget):'—'}</td><td class="small">${fmtD(h.target)}</td>
      <td><select class="inp sm" data-on="hirestage" data-id="${h.id}" ${can('hires')?'':'disabled'} aria-label="Stage">${HIRE_STAGES.map(s=>`<option ${h.stage===s?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Planned monthly cost of roles not yet hired or on hold: <b>${inr(bud)}</b>, from the budgets entered above.</p>`
    :`<div class="panel">${empty('No hiring plan yet','Your brief names four future roles. Add them as proposals, then fill in reason, budget and timing.',`<div class="qa" style="justify-content:center"><button class="btn pri" data-act="seedroles">Add the four planned roles</button><button class="btn" data-act="newrec" data-coll="hires">${ic('plus')}Add a role</button></div>`)}</div>`}`}
  return `<div class="pagehead"><div><h1 class="title">Team & Hiring</h1><p class="sub">Who owns what, how much is on each plate, and who the department needs next.</p></div>
    <div class="qa"><div class="seg">${[['people','People'],['workload','Workload'],['hiring','Hiring plan']].map(([k,l])=>`<button class="${f.tab===k?'on':''}" data-act="teamtab" data-v="${k}">${l}</button>`).join('')}</div>${f.tab==='hiring'?`<button class="btn pri" data-act="newrec" data-coll="hires">${ic('plus')}Add role</button>`:''}</div></div>${body}`;
}
function personModal(m){
  const x=m.id?person(m.id):{name:'',role:'member',title:'',resp:'',external:false};
  return `<div class="modal"><form id="peform"><div class="modal-h"><h2 class="h">${m.id?'Edit person':'Add person'}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="modal-b"><div class="grid2">${fld('name','Name',x.name,{req:true})}${fld('title','Job title',x.title||'',{ph:'e.g. Associate Designer'})}${fld('role','Access role',x.role,{type:'select',options:Object.entries(ROLES),hint:'Decides which approvals they can give.'})}
    ${fld('external','Relationship',x.external?'1':'',{type:'select',options:[['','Team member'],['1','External partner']]})}${fld('resp','Responsibilities',x.resp||'',{type:'textarea',cls:'span2',rows:4})}</div></div>
  <div class="modal-f">${m.id&&people().length>1?`<button type="button" class="btn" data-act="delperson" data-id="${m.id}" style="margin-right:auto">Remove</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save</button></div></form></div>`;
}

/* =================== BUDGET & R&D =================== */
function budgetFor(month){return ((cfg().budget||{})[month.slice(0,7)])||{}}
function spendFor(month){const m=month.slice(0,7);const o={};recs('expenses').filter(e=>(e.date||'').slice(0,7)===m).forEach(e=>{o[e.category]=(o[e.category]||0)+(num(e.amount)||0)});return o}
function vBudget(){
  const f=S.bud;const b=budgetFor(f.month),sp=spendFor(f.month);const ro=!can('budget');
  const tb=BUDGET_CATS.reduce((s,c)=>s+(num(b[c])||0),0),ta=BUDGET_CATS.reduce((s,c)=>s+(sp[c]||0),0);
  const ex=recs('expenses').filter(e=>(e.date||'').slice(0,7)===f.month.slice(0,7)).sort((a,b)=>a.date<b.date?1:-1);
  const exps=recs('experiments').sort((a,b)=>((a.date||a.createdAt)<(b.date||b.createdAt)?1:-1));
  const head=`<div class="pagehead"><div><h1 class="title">Budget & R&D</h1><p class="sub">${f.tab==='budget'?`${MONTH[+f.month.slice(5,7)-1]} ${f.month.slice(0,4)} · development budget against recorded spend`:'Experiments are kept for what they teach, whether or not they reach production.'}</p></div>
    <div class="qa"><div class="seg">${[['budget','Budget & spend'],['rnd','R&D log']].map(([k,l])=>`<button class="${f.tab===k?'on':''}" data-act="budtab" data-v="${k}">${l}</button>`).join('')}</div>
    ${f.tab==='budget'?`<button class="btn sm" data-act="budnav" data-d="-1" aria-label="Previous month">${ic('left')}</button><button class="btn sm" data-act="budnav" data-d="0">This month</button><button class="btn sm" data-act="budnav" data-d="1" aria-label="Next month">${ic('right')}</button><button class="btn" data-act="csvrec" data-coll="expenses">${ic('dl')}CSV</button><button class="btn pri" data-act="newrec" data-coll="expenses" data-date="${f.month.slice(0,7)===TODAY.slice(0,7)?TODAY:f.month}">${ic('plus')}Add expense</button>`:`<button class="btn pri" data-act="newrec" data-coll="experiments">${ic('plus')}Log experiment</button>`}</div></div>`;
  if(f.tab==='rnd')return head+(exps.length?`<div class="lib" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${exps.map(x=>{const spent=recs('expenses').filter(e=>e.expId===x.id).reduce((s,e)=>s+(num(e.amount)||0),0);return `<article class="panel click" data-act="editrec" data-coll="experiments" data-id="${x.id}" style="cursor:pointer;overflow:hidden">${x.image?`<div style="aspect-ratio:16/9;background:center/cover url('${x.image}')"></div>`:''}<div class="panel-b" style="padding-top:14px">
    <div class="qa" style="gap:6px"><span class="pill">${esc(x.type||'Other')}</span><span class="pill ${x.status==='Running'?'hatch':x.status==='Concluded'?'solid':'dash'}">${esc(x.status||'Planned')}</span>${x.outcome&&x.outcome!=='Pending'?`<span class="pill">${esc(x.outcome)}</span>`:''}</div>
    <h3 class="idea-t">${esc(x.title)}</h3><div class="tiny muted">${[x.date&&fmtD(x.date),x.who&&pname(x.who),x.pid&&pcode(x.pid),x.fabricId&&(D.fabrics[x.fabricId]||{}).code,spent&&inr(spent)+' spent'].filter(Boolean).map(esc).join(' · ')}</div>
    ${x.learning?`<p class="small" style="margin-bottom:0"><b>Learning:</b> ${esc(x.learning)}</p>`:x.hypothesis?`<p class="small muted clamp" style="margin-bottom:0">${esc(x.hypothesis)}</p>`:''}</div></article>`}).join('')}</div>`
    :`<div class="panel">${empty('No experiments logged','Record construction ideas, unusual fabrics, wash treatments and fit experiments with what you learned.',`<button class="btn pri" data-act="newrec" data-coll="experiments">${ic('plus')}Log experiment</button>`)}</div>`);
  return head+`<div class="grid2" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)"><div class="tablewrap"><table class="t"><thead><tr><th>Category</th><th class="num">Budget (₹)</th><th class="num">Actual</th><th class="num">Remaining</th><th style="width:120px"></th></tr></thead><tbody>
    ${BUDGET_CATS.map(c=>{const bb=num(b[c]),aa=sp[c]||0;const rem=bb==null?null:bb-aa;return `<tr><td>${c}</td><td class="num"><input class="inp sm" type="number" min="0" step="any" style="width:110px" value="${esc(b[c]??'')}" data-on="bud" data-k="${esc(c)}" ${ro?'disabled':''} aria-label="${c} budget"></td><td class="num">${aa?inr(Math.round(aa)):'—'}</td><td class="num" style="${rem!=null&&rem<0?'font-weight:700':''}">${rem==null?'—':(rem<0?'−':'')+inr(Math.abs(Math.round(rem)))}</td><td>${bb?`<div class="bar" title="${Math.round(aa/bb*100)}% used"><i style="width:${Math.min(100,aa/bb*100)}%"></i></div>`:''}</td></tr>`}).join('')}
    <tr><td><b>Total</b></td><td class="num"><b>${tb?inr(tb):'—'}</b></td><td class="num"><b>${ta?inr(Math.round(ta)):'—'}</b></td><td class="num"><b>${tb?(tb-ta<0?'−':'')+inr(Math.abs(Math.round(tb-ta))):'—'}</b></td><td>${tb?`<div class="bar"><i style="width:${Math.min(100,ta/tb*100)}%"></i></div>`:''}</td></tr></tbody></table></div>
  <div class="panel"><div class="panel-h"><h2 class="h">Expenses</h2><span class="tiny muted">${ex.length}</span></div><div class="panel-b">${ex.length?`<ul class="list">${ex.map(e=>`<li class="li click small" data-act="editrec" data-coll="expenses" data-id="${e.id}"><span class="tiny muted" style="width:52px">${fmtD(e.date)}</span><div style="flex:1;min-width:0"><b>${esc(e.desc)}</b><div class="tiny muted">${[e.category,pcode(e.pid),supName(e.supplierId),e.expId&&(D.experiments[e.expId]||{}).title].filter(Boolean).map(esc).join(' · ')}</div></div><span>${inr(e.amount)}</span></li>`).join('')}</ul>`:'<div class="tiny muted">No expenses recorded this month.</div>'}</div></div></div>
  ${ro?'<p class="tiny muted">Budgets are set by the Founder or Product Lead.</p>':''}`;
}

/* =================== REPORTS =================== */
function monthData(ms){
  const m=ms.slice(0,7);const inM=ts=>(ts||'').slice(0,7)===m;
  const moves=recs('activity').filter(a=>a.kind==='stage'&&inM(a.ts));
  const entered=products().filter(p=>inM(p.createdAt));
  const advanced=[...new Set(moves.filter(a=>a.to>a.from).map(a=>a.pid))].filter(prod);
  const toProd=[...new Set(moves.filter(a=>a.to===8).map(a=>a.pid))].filter(prod);
  const launchedM=[...new Set(moves.filter(a=>a.to===S_LAUNCHED).map(a=>a.pid))].filter(prod);
  const launchTs={};recs('activity').filter(a=>a.kind==='stage'&&a.to===S_LAUNCHED).sort((a,b)=>a.ts<b.ts?-1:1).forEach(a=>{if(!launchTs[a.pid])launchTs[a.pid]=a.ts});
  const cycles=Object.entries(launchTs).filter(([pid])=>prod(pid)).map(([pid,ts])=>({pid,days:diffD(prod(pid).createdAt.slice(0,10),ts.slice(0,10))}));
  const withS=products().map(p=>({p,n:samplesFor(p.id).length})).filter(x=>x.n);
  const b=budgetFor(ms),sp=spendFor(ms);
  const delays=[];recs('suppliers').forEach(s=>(s.log||[]).forEach(x=>{if(x.type==='delivery'&&x.actual&&x.promised&&x.actual>x.promised&&inM(x.actual))delays.push({s:s.name,t:`delivery ${diffD(x.promised,x.actual)}d late${x.note?' · '+x.note:''}`})}));
  recs('samples').forEach(x=>{if(x.received&&x.due&&x.received>x.due&&inM(x.received))delays.push({s:supName(x.vendorId)||'No vendor',t:`${pcode(x.pid)} ${x.round} ${diffD(x.due,x.received)}d late`})});
  const qprob=[];recs('suppliers').forEach(s=>(s.log||[]).forEach(x=>{if(x.type==='quality'&&!x.ok&&inM(x.date))qprob.push({s:s.name,t:x.note||'Quality check failed'})}));
  recs('samples').forEach(x=>{if(['Rejected','Correction Required'].includes(x.status)&&inM(x.received||x.updatedAt))qprob.push({s:supName(x.vendorId)||'—',t:`${pcode(x.pid)} ${x.round} ${x.status.toLowerCase()}${x.decision?' · '+x.decision:''}`})});
  const cap=people().map(p=>{const o=recs('tasks').filter(t=>t.who===p.id&&t.status!=='done');return {p,open:o.length,late:o.filter(t=>t.due&&t.due<TODAY).length,prods:products().filter(x=>x.owner===p.id&&isActive(x)).length}});
  const openHires=recs('hires').filter(h=>!['Hired','On hold'].includes(h.stage));
  const next90=products().filter(isActive).map(p=>({p,d:releaseDate(p.id)})).filter(x=>x.d&&x.d>=TODAY&&x.d<=addDays(TODAY,90)).sort((a,b)=>a.d<b.d?-1:1);
  return {m,entered,advanced,toProd,launchedM,cycles,withS,b,sp,delays,qprob,cap,openHires,next90,moves};
}
function vMonthly(){
  const M=monthData(S.pulse.month);const avg=a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length):null;
  const avgC=avg(M.cycles.map(c=>c.days)),avgS=M.withS.length?(M.withS.reduce((s,x)=>s+x.n,0)/M.withS.length).toFixed(1):null;
  const tb=BUDGET_CATS.reduce((s,c)=>s+(num(M.b[c])||0),0),ta=BUDGET_CATS.reduce((s,c)=>s+(M.sp[c]||0),0);
  const sec=(t,body)=>`<div class="panel"><div class="panel-h"><h2 class="h">${t}</h2></div><div class="panel-b">${body}</div></div>`;
  const ul=(a,fn,none)=>a.length?`<ul class="list">${a.map(fn).join('')}</ul>`:`<div class="tiny muted">${none}</div>`;
  const pl=(pid,txt)=>`<li class="li small ${prod(pid)?'click':''}" ${prod(pid)?`data-act="open" data-id="${pid}"`:''}><b class="code" style="width:130px">${esc(pcode(pid))}</b><span style="flex:1">${txt}</span></li>`;
  return `<div class="pagehead"><div><h1 class="title">Monthly Product Report</h1><p class="sub">${MONTH[+M.m.slice(5)-1]} ${M.m.slice(0,4)} · from Lab records only</p></div>
    <div class="qa"><button class="btn sm" data-act="pmonth" data-d="-1" aria-label="Previous month">${ic('left')}</button><button class="btn sm" data-act="pmonth" data-d="0">This month</button><button class="btn sm" data-act="pmonth" data-d="1" aria-label="Next month">${ic('right')}</button><button class="btn" data-act="pexportm">${ic('dl')}Export</button></div></div>
  <div class="kpis" style="grid-template-columns:repeat(6,1fr)">${[[M.entered.length,'Entered development'],[M.advanced.length,'Advanced a stage'],[M.toProd.length,'Approved for production'],[M.launchedM.length,'Launched'],[avgC??'—','Avg idea-to-launch days',M.cycles.length?`across ${M.cycles.length} launched`:'no launches yet'],[avgS??'—','Sample rounds per product',M.withS.length?`across ${M.withS.length} products`:'no rounds yet']].map(([v,l,f])=>`<div class="kpi" style="cursor:default"><div class="v">${v}</div><div class="l">${l}</div>${f?`<div class="f">${f}</div>`:''}</div>`).join('')}</div>
  <div class="grid2">
    ${sec('Movement',ul(M.moves.sort((a,b)=>a.ts<b.ts?-1:1),a=>pl(a.pid,`${fmtTs(a.ts)} · ${esc(a.text)}`),'No stage moves this month.'))}
    ${sec('Cycle times',ul(M.cycles,c=>pl(c.pid,`${c.days} days from record created to launch`),'No product has been moved to Launched yet.')+(M.withS.length?`<h3 class="h3" style="margin:14px 0 4px">Sampling rounds</h3>`+ul(M.withS,x=>pl(x.p.id,`${x.n} round${x.n>1?'s':''} · ${samplesFor(x.p.id).map(s=>s.round+' '+s.status.toLowerCase()).join(', ')}`),''):''))}
    ${sec('Budget vs actual',tb||ta?`<div class="tablewrap"><table class="t"><tbody>${BUDGET_CATS.filter(c=>M.b[c]||M.sp[c]).map(c=>`<tr><td class="small">${c}</td><td class="num small">${M.b[c]?inr(M.b[c]):'—'}</td><td class="num small">${M.sp[c]?inr(Math.round(M.sp[c])):'—'}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="num"><b>${inr(tb)}</b></td><td class="num"><b>${inr(Math.round(ta))}</b></td></tr></tbody></table></div>`:'<div class="tiny muted">No budget or spend recorded for this month.</div>')}
    ${sec('Supplier delays & quality problems',ul(M.delays.map(x=>Object.assign({k:'Delay'},x)).concat(M.qprob.map(x=>Object.assign({k:'Quality'},x))),x=>`<li class="li small"><span class="pill ${x.k==='Quality'?'hatch':''}">${x.k}</span><b>${esc(x.s)}</b><span style="flex:1" class="muted">${esc(x.t)}</span></li>`,'None recorded this month.'))}
    ${sec('Capacity & hiring',`<ul class="list">${M.cap.map(c=>`<li class="li small"><b style="flex:1">${esc(c.p.name)}</b><span class="muted">${c.open} open tasks · ${c.late} late · ${c.prods} products</span></li>`).join('')}</ul>${M.openHires.length?`<h3 class="h3" style="margin:14px 0 4px">Open roles</h3><ul class="list">${M.openHires.map(h=>`<li class="li small"><span style="flex:1">${esc(h.role)}</span><span class="pill">${esc(h.stage)}</span></li>`).join('')}</ul>`:''}`)}
    ${sec('Next 90 days',ul(M.next90,x=>pl(x.p.id,`${fmtD(x.d)} release · ${esc(STAGES[x.p.stage])}${missingApprovals(x.p.id,11).length?` · ${missingApprovals(x.p.id,11).length} gate approvals outstanding`:' · gates clear'}`),'No releases planned in the next 90 days.'))}
  </div>`;
}
function monthMarkdown(){const M=monthData(S.pulse.month);const L=[`# OFFCOMFRT Monthly Product Report`,`${MONTH[+M.m.slice(5)-1]} ${M.m.slice(0,4)}`,'',
  `Entered development: ${M.entered.length} · Advanced: ${M.advanced.length} · Approved for production: ${M.toProd.length} · Launched: ${M.launchedM.length}`,'','## Stage moves',...(M.moves.length?M.moves.map(a=>`- ${pcode(a.pid)}: ${a.text}`):['- None']),'',
  '## Cycle times',...(M.cycles.length?M.cycles.map(c=>`- ${pcode(c.pid)}: ${c.days} days`):['- No launches yet']),'','## Sampling rounds',...(M.withS.length?M.withS.map(x=>`- ${x.p.code}: ${x.n}`):['- None']),'',
  '## Budget vs actual',...BUDGET_CATS.filter(c=>M.b[c]||M.sp[c]).map(c=>`- ${c}: budget ${M.b[c]||0}, actual ${Math.round(M.sp[c]||0)}`),'','## Supplier delays and quality problems',...(M.delays.length+M.qprob.length?M.delays.map(x=>`- Delay, ${x.s}: ${x.t}`).concat(M.qprob.map(x=>`- Quality, ${x.s}: ${x.t}`)):['- None']),'',
  '## Capacity',...M.cap.map(c=>`- ${c.p.name}: ${c.open} open tasks, ${c.late} late, ${c.prods} products`),...(M.openHires.length?['','## Open roles',...M.openHires.map(h=>`- ${h.role} (${h.stage})`)]:[]),'','## Next 90 days',...(M.next90.length?M.next90.map(x=>`- ${x.p.code}: release ${x.d}, ${STAGES[x.p.stage]}`):['- None'])];return L.join('\n')}
function vReports(){
  const mode=S.pulse.mode;
  const tabs=`<div class="seg" style="margin-bottom:18px">${[['week','Weekly Pulse'],['month','Monthly report']].map(([k,l])=>`<button class="${mode===k?'on':''}" data-act="pmode" data-v="${k}">${l}</button>`).join('')}</div>`;
  if(mode==='month')return tabs+vMonthly();
  const ws=S.pulse.week,we=addDays(ws,6);const inW=d=>d&&d>=ws&&d<=we;
  const rec=recs('samples').filter(s=>inW(s.received)&&prod(s.pid));
  const dec=recs('activity').filter(a=>a.kind==='sample'&&inW(a.ts.slice(0,10))&&['Approved','Rejected','Correction Required'].includes(a.status));
  const extra=`<div class="panel" style="margin-top:18px"><div class="panel-h"><h2 class="h">Samples this week</h2><span class="tiny muted">${rec.length} received · ${dec.filter(a=>a.status==='Approved').length} approved · ${dec.filter(a=>a.status!=='Approved').length} rejected or sent back</span></div><div class="panel-b">
    ${rec.length+dec.length?`<ul class="list">${rec.map(s=>`<li class="li small click" data-act="opensample" data-id="${s.id}"><b class="code" style="width:130px">${esc(pcode(s.pid))}</b><span style="flex:1">${esc(s.round)} received ${fmtD(s.received)}</span></li>`).join('')}${dec.map(a=>`<li class="li small"><b class="code" style="width:130px">${esc(pcode(a.pid))}</b><span style="flex:1">${esc(a.text)}</span></li>`).join('')}</ul>`:'<div class="tiny muted">No samples received or decided this week.</div>'}</div></div>`;
  return tabs+vPulse().replace('<p class="tiny muted" style="margin-top:16px">',extra+'<p class="tiny muted" style="margin-top:16px;display:none">');
}

/* =================== AUDIT (setup) =================== */
function vAudit(){
  const a=recs('activity').sort((x,y)=>x.ts<y.ts?1:-1).slice(0,150);
  return `<div class="panel" style="margin-top:18px"><div class="panel-h"><h2 class="h">Audit history</h2><span class="tiny muted">Latest ${a.length} of ${recs('activity').length} entries</span></div><div class="panel-b">${a.length?`<ul class="list">${a.map(x=>`<li class="li small"><span class="tiny muted" style="width:110px;flex:none">${fmtTs(x.ts)}</span><span class="pill" style="width:84px;justify-content:center">${esc(x.kind||'note')}</span><span style="flex:1">${x.pid?`<b>${esc(pcode(x.pid))}</b> `:''}${esc(x.text)}</span><span class="tiny muted">${esc(pname(x.by))}</span></li>`).join('')}</ul>`:'<div class="tiny muted">Nothing recorded yet.</div>'}</div></div>`;
}

/* =================== overview additions =================== */
function vFitPanel(){
  const ss=recs('samples').filter(s=>SAMPLE_OPEN.includes(s.status)&&prod(s.pid)).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1);
  return `<div class="panel"><div class="panel-h"><h2 class="h">In the Fit Room</h2><button class="btn ghost sm" data-act="go" data-to="fit-room">Fit Room</button></div><div class="panel-b">
  ${ss.length?`<ul class="list">${ss.slice(0,8).map(s=>{const late=!s.received&&s.due&&s.due<TODAY;return `<li class="li click small" data-act="opensample" data-id="${s.id}"><b class="code" style="width:130px">${esc(pcode(s.pid))} ${esc(s.round)}</b><span style="flex:1"><span class="pill ${stCls(s.status)}">${esc(s.status)}</span></span><span class="tiny ${late?'':'muted'}" style="${late?'font-weight:700':''}">${s.received?'in '+fmtD(s.received):s.due?(late?'late · ':'')+fmtD(s.due):''}</span></li>`}).join('')}</ul>`:'<div class="tiny muted">No open sample rounds.</div>'}</div></div>`;
}
function palExtra(q){
  if(!q)return [];const out=[];const has=x=>JSON.stringify(x).toLowerCase().includes(q);
  recs('fabrics').forEach(x=>{if(has([x.code,x.name,x.composition]))out.push({k:'Fabric',t:`${x.code} · ${x.name}`,s:x.composition,go:()=>openModal({kind:'rec',coll:'fabrics',id:x.id})})});
  recs('trims').forEach(x=>{if(has([x.code,x.name,x.type]))out.push({k:'Trim',t:`${x.code} · ${x.name}`,s:x.type,go:()=>openModal({kind:'rec',coll:'trims',id:x.id})})});
  recs('suppliers').forEach(x=>{if(has([x.name,x.category,x.location,x.contact]))out.push({k:'Supplier',t:x.name,s:x.category,go:()=>{go('suppliers');openModal({kind:'supplier',id:x.id})}})});
  recs('ideas').forEach(x=>{if(has([x.title,x.tags,x.notes]))out.push({k:'Idea',t:x.title,s:x.kind,go:()=>openModal({kind:'rec',coll:'ideas',id:x.id})})});
  recs('samples').forEach(x=>{if(prod(x.pid)&&has([pcode(x.pid)+' '+x.round,x.decision]))out.push({k:'Sample',t:`${pcode(x.pid)} ${x.round}`,s:x.status,go:()=>openSample(x.id)})});
  return out;
}

/* =================== demo data for new modules =================== */
function seedDemo2(){
  const T=TODAY,d=n=>addDays(T,n),now=new Date().toISOString();const P=c=>products().find(p=>p.code===c);
  const ins=(c,o)=>{const r=Object.assign({id:uid(),createdAt:now,updatedAt:now},o);D[c][r.id]=r;return r};
  const s1=ins('suppliers',{name:'Demo Knit Mills',category:'Knitting mill',location:'Tiruppur',contact:'Demo contact',status:'Active',leadTime:'21',moq:'300 kg',price:'Demo pricing',capability:'Fleece, waffle, rib',notes:'',log:[{type:'delivery',promised:d(-30),actual:d(-27),note:'Fleece lab dips'},{type:'quality',date:d(-27),ok:true,note:'Shade within tolerance'}]});
  const s2=ins('suppliers',{name:'Demo Sampling Studio',category:'Sampling unit',location:'Bengaluru',contact:'Demo contact',status:'Active',leadTime:'10',capability:'Knit sampling, small runs',log:[]});
  const s3=ins('suppliers',{name:'Demo Trims Co.',category:'Trims supplier',location:'Delhi',status:'Trial',leadTime:'14',log:[]});
  const W=P('WAFFLE-001'),SW=P('SWEATSHIRT-001'),L=P('LWR-001'),H=P('HENLEY-001');
  ins('fabrics',{code:'FAB-001',name:'Loopback fleece (demo)',category:'Fleece',composition:'100% cotton (demo)',gsm:'360',construction:'Loopback',finish:'Enzyme wash',shrinkage:'Not tested',testStatus:'Testing',supplierId:s1.id,cost:'540',costUnit:'kg',leadTime:'21',moq:'300 kg',pids:SW?[SW.id]:[]});
  ins('fabrics',{code:'FAB-002',name:'Cotton waffle (demo)',category:'Knit',composition:'Cotton (demo)',gsm:'240',construction:'Waffle',testStatus:'Untested',supplierId:s1.id,cost:'480',costUnit:'kg',leadTime:'25',pids:W?[W.id]:[]});
  ins('trims',{code:'TRM-001',name:'Flat cotton drawcord (demo)',type:'Drawcord',spec:'10 mm, black',supplierId:s3.id,cost:'6',unit:'piece',pids:L?[L.id]:[]});
  ins('trims',{code:'TRM-002',name:'1×1 rib (demo)',type:'Rib',spec:'Cuff and hem rib',supplierId:s1.id,pids:SW?[SW.id]:[]});
  const meas=(a)=>[{pom:'Chest (½)',spec:'58',act:a[0],tol:'1'},{pom:'Body length (HPS)',spec:'70',act:a[1],tol:'1'},{pom:'Shoulder',spec:'50',act:a[2],tol:'0.5'},{pom:'Sleeve length',spec:'62',act:a[3],tol:'1'}];
  if(W){ins('samples',{pid:W.id,round:'S1',status:'Rejected',requested:d(-26),due:d(-14),received:d(-12),vendorId:s2.id,fabric:'Cotton waffle (demo)',patternVer:'P1',who:'p-lead',meas:meas(['59.5','70.5','51.2','62']),chk:{0:'OK',1:'Issue',9:'OK'},fit:'Shoulder too wide, drops off the body.',corrections:'Reduce shoulder 1 cm, re-balance armhole.',decision:'Rejected due to shoulder fit',images:[]});
    ins('samples',{pid:W.id,round:'S2',status:'Under Review',requested:d(-10),due:d(-3),received:d(-2),vendorId:s2.id,fabric:'Cotton waffle (demo)',patternVer:'P2',who:'p-lead',meas:meas(['58.4','70.2','50.6','61.5']),chk:{0:'OK',1:'Issue',6:'OK'},fit:'Shoulder better; seam still pulls forward.',corrections:'',decision:'',images:[]})}
  if(SW)ins('samples',{pid:SW.id,round:'S1',status:'Approved',requested:d(-30),due:d(-18),received:d(-20),vendorId:s2.id,fabric:'Loopback fleece (demo)',patternVer:'P1',who:'p-lead',meas:meas(['58.2','69.8','50.1','62.3']),chk:{0:'OK',1:'OK',2:'OK'},decision:'Approved',images:[]});
  if(L)ins('samples',{pid:L.id,round:'S1',status:'Awaiting Sample',requested:d(-9),due:d(-2),received:'',vendorId:s2.id,patternVer:'P1',who:'p-lead',meas:[],chk:{},images:[]});
  if(SW){ins('costsheets',{pid:SW.id,label:'v1 Estimate',basis:'Estimate',lines:{mainFabric:{qty:'0.75',rate:'540',unit:'kg'},secondary:{qty:'0.08',rate:'600',unit:'kg'},labels:{rate:'18'},cutting:{rate:'15'},cmt:{rate:'170'},wash:{rate:'35'},packaging:{rate:'22'},freight:{rate:'12'}},approved:false,createdAt:new Date(Date.now()-20*864e5).toISOString()});
    ins('costsheets',{pid:SW.id,label:'v2 After S1',basis:'S1 actual',lines:{mainFabric:{qty:'0.8',rate:'540',unit:'kg'},secondary:{qty:'0.08',rate:'600',unit:'kg'},labels:{rate:'18'},print:{rate:'40'},cutting:{rate:'15'},cmt:{rate:'185'},wash:{rate:'35'},packaging:{rate:'22'},testing:{rate:'10'},freight:{rate:'12'}},approved:false,createdAt:now});
    D.qc[SW.id]={id:SW.id,pid:SW.id,items:{0:{s:'Pass',ts:now,by:'p-lead'},1:{s:'Pass',ts:now,by:'p-lead'},2:{s:'Pass',ts:now,by:'p-lead'},4:{s:'Fail',note:'Body length −4% after 3 washes (demo)',ts:now,by:'p-lead'}}}}
  ins('ideas',{title:'Brushed-back travel trouser',kind:'Silhouette',category:'Bottoms',status:'Shortlisted',tags:'travel, comfort',notes:'Tapered, hidden zip pocket, soft hand.',sc_brand:'5',sc_diff:'4',sc_need:'4'});
  ins('ideas',{title:'Grey marl moodboard',kind:'Moodboard',status:'Raw',tags:'winter, grey',notes:'Concrete, wool, overcast light.'});
  ins('ideas',{title:'Garment-dyed rib trial',kind:'Fabric experiment',status:'Parked',tags:'rib, dye',notes:'Check shrinkage before committing.',sc_feas:'2',sc_cost:'3'});
  const ex=ins('experiments',{title:'Enzyme vs silicone wash on fleece',type:'Wash treatment',status:'Concluded',outcome:'Learned',date:d(-15),who:'p-lead',pid:SW?SW.id:'',hypothesis:'Which finish keeps the hand soft after 5 washes?',result:'Enzyme held its hand better (demo).',learning:'Default to enzyme on loopback fleece (demo).'});
  D.config.main.budget={[T.slice(0,7)]:{'Sampling':40000,'Pattern development':15000,'Fabric research':10000,'Laboratory testing':8000}};
  D.config.main.finance={gst:'5',disc:'10',mkt:'250',ship:'70',fees:'2',returns:'6'};
  D.config.main.people[1].title='Product Lead';D.config.main.people[1].resp='Runs product development end to end: pipeline, sampling, suppliers, technical approval.';
  D.config.main.people[0].title='Founder / Creative Director';D.config.main.people[0].resp='Brand, creative direction and creative approval.';
  ins('expenses',{date:d(-6),category:'Sampling',amount:'6500',desc:'WAFFLE-001 S2 sampling (demo)',pid:W?W.id:'',supplierId:s2.id});
  ins('expenses',{date:d(-3),category:'Laboratory testing',amount:'3200',desc:'Shrinkage test, fleece (demo)',supplierId:''});
  ins('expenses',{date:d(-15),category:'Fabric research',amount:'1800',desc:'Wash trial (demo)',expId:ex.id});
  PLANNED_ROLES.forEach(([r,k],i)=>ins('hires',{role:r,kind:k,priority:i<2?'P1':'P2',stage:'Proposed',reason:'',budget:'',target:''}));
  Object.values(D.tasks).forEach(t=>{t.type=t.title.includes('photos')||t.title.includes('S1')?'Sampling':t.title.includes('supplier')?'Sourcing':'Product development';t.checklist=[];t.comments=[]});
  const t1=Object.values(D.tasks).find(t=>t.title.startsWith('Send shoulder'));if(t1)t1.checklist=[{t:'Mark up S2 photos',done:true},{t:'Agree new shoulder measurement',done:false},{t:'Send to pattern maker',done:false}];
  ins('tasks',{title:'Set up November budget lines',type:'Department',who:'p-lead',due:d(3),priority:'P2',status:'todo',notes:'',checklist:[],comments:[{ts:now,by:'p-founder',text:'Keep sampling under the cap this month.'}]});
  ins('tasks',{title:'Shortlist two pattern makers',type:'Sourcing',who:'p-lead',due:d(9),priority:'P2',status:'doing',notes:'',checklist:[],comments:[]});
}

/* =================== hooks into the app =================== */
const MODS={wall:vWall,'fit-room':vFitRoom,fabrics:vFabrics,suppliers:vSuppliers,costing:vCosting,quality:vQuality,team:vTeam,budget:vBudget,pulse:vReports,tasks:vTasks,setup:()=>vSetup()+vAudit()};
const PTAB={overview:p=>pOverview(p),notes:p=>pNotes(p),techpack:pTechPack,materials:pMaterials,sampling:pSampling,costing:pCosting,quality:pQuality,milestones:p=>pMilestones(p),tasks:pTasks,approvals:p=>pApprovals(p),revisions:p=>pRevisions(p),activity:p=>pActivity(p)};
const MODAL2={rec:recModal,sample:sampleModal,compare:compareModal,supplier:supModal,task:taskModal,person:personModal};
const SUBMIT2={
  recform:f=>{const m=S.modal,sc=SCHEMA[m.coll];if(!guard(sc.area||m.coll))return;const v=readRecForm(f,sc);const errs={};
    sc.fields.forEach(([n,,o])=>{if(o.req&&!v[n])errs[n]='Required.';if(o.type==='number'&&v[n]!==''&&(isNaN(+v[n])||+v[n]<0))errs[n]='Enter a positive number.'});
    if(v.code!==undefined&&v.code){v.code=v.code.toUpperCase();if(recs(m.coll).some(x=>(x.code||'').toUpperCase()===v.code&&x.id!==m.id))errs.code='Another record already uses this ID.'}
    if(v.source&&!/^https?:\/\/\S+$/i.test(v.source))errs.source='Use a full link starting with https://';
    if(v.email&&!/^\S+@\S+\.\S+$/.test(v.email))errs.email='Check the email address.';
    if(!showErr(f,errs))return;
    const now=new Date().toISOString();const old=m.id?D[m.coll][m.id]:null;
    const rec=Object.assign(old?clone(old):{id:uid(),createdAt:now},v,{updatedAt:now});
    if(sc.image)rec.image=m.img||'';if(m.coll==='ideas'&&old&&old.status==='Converted')rec.status='Converted';
    if(m.coll==='suppliers'&&!rec.log)rec.log=[];
    put(m.coll,rec);const nm=rec[sc.name||'name']||rec.code||'';
    log(`${sc.title} ${old?'updated':'added'}: ${nm}`,rec.pid||(rec.pids&&rec.pids.length===1?rec.pids[0]:null),m.coll);
    closeModal();toast(`${sc.title} saved`)},
  sform:f=>{const m=S.modal;capSample();const r=m.rec;const errs={};
    if(!r.pid)errs.pid='Choose a product.';if(!r.round)errs.round='Name the round, e.g. S1.';
    if(r.received&&r.requested&&r.received<r.requested)errs.received='Received before it was requested.';
    if(samplesFor(r.pid).some(s=>s.round.toUpperCase()===r.round.toUpperCase()&&s.id!==m.id))errs.round='This round already exists for the product.';
    if(!showErr(f,errs))return;if(!guard('samples'))return;
    r.meas=r.meas.filter(x=>x.pom||x.spec||x.act);
    const old=m.id?D.samples[m.id]:null;const rec=Object.assign({},r,{id:m.id||uid(),createdAt:old?old.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    put('samples',rec);
    if(!old)log(`${rec.round} logged (${rec.status})`,rec.pid,'sample',{sid:rec.id,status:rec.status});
    else if(old.status!==rec.status)log(`${rec.round}: ${old.status} → ${rec.status}${rec.decision?` · ${rec.decision}`:''}`,rec.pid,'sample',{sid:rec.id,status:rec.status});
    else log(`${rec.round} updated`,rec.pid,'sample',{sid:rec.id});
    closeModal();toast(`${pcode(rec.pid)} ${rec.round} saved`);
    const sa=msOf(rec.pid,'sampleApproval'),fs=msOf(rec.pid,'firstSample');
    if(rec.status==='Approved'&&(!old||old.status!=='Approved')&&sa&&!sa.done)confirmBox('Mark sample approval complete?',`${esc(rec.round)} is approved. Mark the Sample approval milestone for ${esc(pcode(rec.pid))} as done today?`,'Mark complete',()=>{const x=clone(sa);x.done=TODAY;put('milestones',x);log('Sample approval completed',rec.pid,'milestone')});
    else if(rec.received&&(!old||!old.received)&&fs&&!fs.done&&roundNum(rec.round)===1)confirmBox('Mark first sample received?',`Mark the First sample milestone for ${esc(pcode(rec.pid))} as done on ${fmtD(rec.received)}?`,'Mark complete',()=>{const x=clone(fs);x.done=rec.received;put('milestones',x);log('First sample milestone completed',rec.pid,'milestone')})},
  tform:f=>{const v=formData(f);const m=S.modal;const errs={};if(!v.title||v.title==='Design review:')errs.title='Describe the task.';if(m.review&&!v.due)errs.due='Pick a date.';if(!showErr(f,errs))return;if(!guard('tasks'))return;
    const old=m.id?D.tasks[m.id]:null;const t=Object.assign(old?clone(old):{id:uid(),createdAt:new Date().toISOString(),checklist:[],comments:[]},v);
    if(t.status==='done'&&!t.doneAt)t.doneAt=new Date().toISOString();if(t.status!=='done')t.doneAt='';
    put('tasks',t);if(!old)log(`Task added: ${t.title}${t.due?` (due ${fmtD(t.due)})`:''}`,t.pid,'task');else if(old.status!==t.status&&(t.status==='done'||t.status==='blocked'))log(`Task ${t.status==='done'?'completed':'blocked'}: ${t.title}`,t.pid,'task');
    closeModal();toast(old?'Task saved':'Task added')},
  peform:f=>{if(!guard('people'))return;const v=formData(f);if(!showErr(f,v.name?{}:{name:'Add a name.'}))return;const c=clone(cfg());const data={name:v.name,role:v.role,title:v.title,resp:v.resp,external:v.external==='1'};
    if(S.modal.id)Object.assign(c.people.find(p=>p.id===S.modal.id),data);else c.people.push(Object.assign({id:'p-'+uid()},data));putConfig(c);closeModal();toast('Saved')},
};
const CHANGE2={
  recimg:t=>{const m=S.modal;m.draft=readRecForm($('#recform'),SCHEMA[m.coll]);readFile(t,url=>compressImage(url,s=>{m.img=s;renderModal()}),true)},
  simg:t=>{capSample();readFile(t,url=>compressImage(url,s=>{S.modal.rec.images.push(s);renderModal()}),true)},
  xfilter:t=>{S[t.dataset.o][t.dataset.k]=t.value;render()},
  taskstatus:t=>{if(!guard('tasks')){render();return}const x=clone(D.tasks[t.dataset.id]);x.status=t.value;x.doneAt=x.status==='done'?new Date().toISOString():'';put('tasks',x);if(x.status==='done'||x.status==='blocked')log(`Task ${x.status==='done'?'completed':'blocked'}: ${x.title}`,x.pid,'task')},
  taskdone:t=>{if(!guard('tasks')){render();return}const x=clone(D.tasks[t.dataset.id]);x.status=t.checked?'done':'todo';x.doneAt=t.checked?new Date().toISOString():'';put('tasks',x);if(t.checked)log(`Task completed: ${x.title}`,x.pid,'task')},
  tcheck:t=>{if(!guard('tasks'))return;capTask();const x=clone(D.tasks[S.modal.id]);x.checklist[+t.dataset.i].done=t.checked;put('tasks',x);renderModal()},
  cl:t=>{if(!guard('costsheets'))return;const c=clone(D.costsheets[t.dataset.id]);if(c.approved){toast('Approved sheets are locked. Make a new version.');render();return}c.lines=c.lines||{};c.lines[t.dataset.k]=Object.assign({},c.lines[t.dataset.k]||{},{[t.dataset.f]:t.value});c.updatedAt=new Date().toISOString();put('costsheets',c)},
  sheetmeta:t=>{if(!guard('costsheets'))return;const c=clone(D.costsheets[t.dataset.id]);c[t.dataset.k]=t.value.trim();put('costsheets',c)},
  fin:t=>{if(!guard('finance'))return;const c=clone(cfg());c.finance=Object.assign({},c.finance||{},{[t.dataset.k]:t.value});putConfig(c);log(`Finance assumption updated: ${FIN.find(x=>x[0]===t.dataset.k)[1]} = ${t.value||'blank'}`,null,'finance')},
  qc:t=>{if(!guard('qc'))return;const q=clone(qcFor(t.dataset.pid));q.items=q.items||{};const i=t.dataset.i;q.items[i]=Object.assign({},q.items[i]||{},{[t.dataset.f]:t.value,ts:new Date().toISOString(),by:S.me});put('qc',q);
    if(t.dataset.f==='s'&&t.value)log(`QC ${QC_ITEMS[+i]}: ${t.value}`,t.dataset.pid,'quality')},
  tp:t=>{if(!guard('products'))return;const p=clone(prod(t.dataset.id));p.tp=Object.assign({sizes:'S, M, L, XL',rows:[]},p.tp||{});if(p.tp.frozen)return;p.tp[t.dataset.k]=t.value;p.updatedAt=new Date().toISOString();put('products',p)},
  tpcell:t=>{if(!guard('products'))return;const p=clone(prod(t.dataset.id));const tp=p.tp;if(!tp||tp.frozen)return;const r=tp.rows[+t.dataset.i];const k=t.dataset.k;if(k.startsWith('v.')){r.v=r.v||{};r.v[k.slice(2)]=t.value}else r[k]=t.value;put('products',p)},
  linkmat:t=>{if(!t.value||!guard(t.dataset.coll))return;const x=clone(D[t.dataset.coll][t.value]);x.pids=[...new Set((x.pids||[]).concat([t.dataset.pid]))];put(t.dataset.coll,x);log(`Linked ${x.code} ${x.name}`,t.dataset.pid,t.dataset.coll)},
  hirestage:t=>{if(!guard('hires'))return;const h=clone(D.hires[t.dataset.id]);const o=h.stage;h.stage=t.value;put('hires',h);log(`Hiring: ${h.role} moved from ${o} to ${h.stage}`,null,'hiring')},
  bud:t=>{if(!guard('budget'))return;const c=clone(cfg());c.budget=c.budget||{};const m=S.bud.month.slice(0,7);c.budget[m]=Object.assign({},c.budget[m]||{},{[t.dataset.k]:t.value===''?'':+t.value});putConfig(c)},
};
const ACT2={
  newrec:el=>{const coll=el.dataset.coll;if(!guard(SCHEMA[coll].area||coll))return;const preset={};if(el.dataset.pid){if(SCHEMA[coll].fields.some(f=>f[0]==='pids'))preset.pids=[el.dataset.pid];else preset.pid=el.dataset.pid}
    if(coll==='expenses')preset.date=el.dataset.date||TODAY;if(coll==='hires')preset.stage='Proposed';if(coll==='ideas')preset.status='Raw';if(coll==='suppliers')preset.status='Active';if(coll==='experiments'){preset.status='Planned';preset.who=S.me;preset.date=TODAY}if(coll==='fabrics'){preset.testStatus='Untested';preset.costUnit='kg'}
    openModal({kind:'rec',coll,preset})},
  editrec:(el,e)=>{if(e&&e.target.closest('button[data-act="convertidea"],a'))return;openModal({kind:'rec',coll:el.dataset.coll,id:el.dataset.id})},
  recdel:()=>{const m=S.modal;const sc=SCHEMA[m.coll];if(!guard(sc.area||m.coll))return;const r=D[m.coll][m.id];const nm=r[sc.name||'name']||r.code||'';
    confirmBox(`Delete this ${sc.title.toLowerCase()}?`,`“${esc(nm)}” will be removed. Links from other records will show as empty.`,'Delete',()=>{del(m.coll,m.id);log(`${sc.title} deleted: ${nm}`,null,m.coll);toast('Deleted')})},
  recimgrm:()=>{const m=S.modal;m.draft=readRecForm($('#recform'),SCHEMA[m.coll]);m.img='';renderModal()},
  csvrec:el=>saveFile(`offcomfrt-${el.dataset.coll}.csv`,recCSV(el.dataset.coll),'text/csv'),
  csvsamples:()=>saveFile('offcomfrt-samples.csv',toCSV(['product','round','status','vendor','requested','due','received','pattern','fabric','out_of_tolerance','fit','corrections','decision'],recs('samples').filter(s=>prod(s.pid)).map(s=>[pcode(s.pid),s.round,s.status,supName(s.vendorId),s.requested,s.due,s.received,s.patternVer,s.fabric,(s.meas||[]).filter(x=>{const d=dev(x);return d&&d.out}).map(x=>x.pom).join('; '),s.fit,s.corrections,s.decision])),'text/csv'),
  wallview:el=>{S.wall.view=el.dataset.v;render()},
  convertidea:el=>{if(!guardEdit())return;const x=D.ideas[el.dataset.id];openModal({kind:'product',fromIdea:x.id,preset:{name:x.title,category:x.category||'',collection:x.collection||'',notes:[x.notes,x.source&&'Reference: '+x.source].filter(Boolean).join('\n\n'),image:x.image||'',stage:1}})},
  addsample:el=>{if(guard('samples'))openSample(null,el.dataset.pid||(S.route==='product'?S.param:''))},
  opensample:(el,e)=>{openSample(el.dataset.id)},
  cmpsample:el=>openModal({kind:'compare',pid:el.dataset.pid}),
  saddrow:()=>{capSample();S.modal.rec.meas.push({pom:'',spec:'',act:'',tol:''});renderModal()},
  srmrow:el=>{capSample();S.modal.rec.meas.splice(+el.dataset.i,1);renderModal()},
  srmimg:el=>{capSample();S.modal.rec.images.splice(+el.dataset.i,1);renderModal()},
  sdel:()=>{if(!guard('samples'))return;const s=D.samples[S.modal.id];confirmBox(`Delete ${esc(pcode(s.pid))} ${esc(s.round)}?`,'This sample record, its measurements and photos will be removed.','Delete round',()=>{del('samples',s.id);log(`${s.round} deleted`,s.pid,'sample');toast('Sample deleted')})},
  fitstatus:el=>{S.fit.status=S.fit.status===el.dataset.v?'':el.dataset.v;render()},
  fabtab:el=>{S.fab.tab=el.dataset.v;S.fab.cat='';render()},
  supcat:el=>{S.sup.cat=el.dataset.v;render()},
  opensup:el=>openModal({kind:'supplier',id:el.dataset.id}),
  soadd:el=>{if(!guard('suppliers'))return;const type=$('#so_type').value,pr=$('#so_prom').value,ac=$('#so_act').value,ok=$('#so_ok').checked,note=$('#so_note').value.trim();
    if(type==='delivery'&&(!pr||!ac)){toast('A delivery needs the promised date and the delivered date.');return}if(type==='quality'&&!pr){toast('Add the date of the quality check.');return}
    const s=clone(D.suppliers[el.dataset.id]);s.log=(s.log||[]).concat([type==='delivery'?{type,promised:pr,actual:ac,note}:{type,date:pr,ok,note}]);put('suppliers',s);
    log(`${s.name}: ${type==='delivery'?`delivery ${ac<=pr?'on time':diffD(pr,ac)+'d late'}`:`quality check ${ok?'passed':'failed'}`}${note?' · '+note:''}`,null,'supplier');renderModal()},
  sorm:el=>{if(!guard('suppliers'))return;const s=clone(D.suppliers[el.dataset.id]);s.log.splice(+el.dataset.i,1);put('suppliers',s);renderModal()},
  costpick:(el,e)=>{if(e)e.preventDefault();S.cost.pid=el.dataset.id;S.cost.ver='';if(S.route!=='costing')go('costing');else render()},
  selsheet:el=>{S.cost.ver=el.dataset.id;render()},
  newsheet:el=>{if(!guard('costsheets'))return;const pid=el.dataset.pid;const ss=sheetsFor(pid);const from=el.dataset.from&&D.costsheets[el.dataset.from];
    const c={id:uid(),pid,label:'v'+(ss.length+1)+(ss.length?'':' Estimate'),basis:ss.length?'':'Estimate',lines:from?clone(from.lines||{}):{},approved:false,createdAt:new Date().toISOString()};put('costsheets',c);S.cost.ver=c.id;S.cost.pid=pid;log(`Cost sheet ${c.label} created`,pid,'costing')},
  approvesheet:el=>{if(!['ops','founder'].includes(myRole())||S.readOnly){toast('Cost is approved by Finance / Operations or the Founder.');return}const c=D.costsheets[el.dataset.id];
    confirmBox(`Approve ${esc(c.label)}?`,`${inr(Math.round(sheetTotal(c)))} becomes the approved product cost for ${esc(pcode(c.pid))}. Any other approved version is withdrawn.`,'Approve cost',()=>{sheetsFor(c.pid).forEach(x=>{if(x.approved&&x.id!==c.id){const y=clone(x);y.approved=false;put('costsheets',y)}});const y=clone(c);y.approved=true;y.approvedBy=S.me;y.approvedAt=new Date().toISOString();put('costsheets',y);log(`Product cost approved: ${y.label} at ${inr(Math.round(sheetTotal(y)))}`,c.pid,'costing')})},
  unapprovesheet:el=>{if(!['ops','founder'].includes(myRole())||S.readOnly){toast('Only Finance / Operations or the Founder can change cost approval.');return}const y=clone(D.costsheets[el.dataset.id]);y.approved=false;put('costsheets',y);log(`Cost approval withdrawn: ${y.label}`,y.pid,'costing')},
  useestcost:el=>{if(!guardEdit())return;const c=D.costsheets[el.dataset.id];applyProductChange(c.pid,{estCost:String(Math.round(sheetTotal(c)*100)/100)},`Estimated cost taken from ${c.label}`)},
  delsheet:el=>{if(!guard('costsheets'))return;const c=D.costsheets[el.dataset.id];confirmBox(`Delete ${esc(c.label)}?`,'This cost sheet version will be removed.','Delete version',()=>{del('costsheets',c.id);S.cost.ver='';log(`Cost sheet ${c.label} deleted`,c.pid,'costing')})},
  qatab:el=>{S.qa.tab=el.dataset.v;render()},qastatus:el=>{S.qa.status=el.dataset.v;render()},
  tprow:el=>{if(!guard('products'))return;const p=clone(prod(el.dataset.id));p.tp=Object.assign({sizes:'S, M, L, XL',rows:[]},p.tp||{});p.tp.rows.push({pom:'',v:{},tol:''});put('products',p)},
  tprm:el=>{if(!guard('products'))return;const p=clone(prod(el.dataset.id));p.tp.rows.splice(+el.dataset.i,1);put('products',p)},
  tpfreeze:el=>{if(!guard('products'))return;const p0=prod(el.dataset.id);if(!(p0.tp&&p0.tp.rows&&p0.tp.rows.length)){toast('Add at least one measurement before freezing.');return}
    confirmBox('Freeze the tech pack?',`The size chart and specs for ${esc(p0.code)} become read-only. Reopening later creates a new revision.`,'Freeze',()=>{const p=clone(prod(el.dataset.id));p.tp.frozen=true;p.tp.frozenOn=TODAY;p.tp.frozenBy=S.me;put('products',p);log('Tech pack frozen',p.id,'techpack');
      const m=msOf(p.id,'techFreeze');if(m&&!m.done){const x=clone(m);x.done=TODAY;put('milestones',x);log('Tech-pack freeze milestone completed',p.id,'milestone')}})},
  tpunfreeze:el=>{if(!guard('products'))return;const p=prod(el.dataset.id);const tp=Object.assign({},clone(p.tp),{frozen:false});applyProductChange(p.id,{tp},'Tech pack reopened after freeze',true)},
  unlinkmat:el=>{if(!guard(el.dataset.coll))return;const x=clone(D[el.dataset.coll][el.dataset.id]);x.pids=(x.pids||[]).filter(i=>i!==el.dataset.pid);put(el.dataset.coll,x);log(`Unlinked ${x.code} ${x.name}`,el.dataset.pid,el.dataset.coll)},
  taskview:el=>{S.tasks.view=el.dataset.v;render()},
  taskof:el=>{S.tasks.scope='all';S.tasks.who=el.dataset.v;go('tasks')},
  tclear:()=>{Object.assign(S.tasks,{q:'',type:'',due:'',pid:'',who:''});render()},
  newtask:el=>{if(guard('tasks'))openModal({kind:'task',pid:el&&el.dataset&&el.dataset.pid||(S.route==='product'?S.param:'')})},
  newreview:()=>{if(guard('tasks'))openModal({kind:'task',review:true,title:'Design review: ',due:addDays(TODAY,2),pid:S.route==='product'?S.param:'',type:'Product development'})},
  deltask:el=>{if(!guard('tasks'))return;const t=D.tasks[el.dataset.id];confirmBox('Delete this task?',`“${esc(t.title)}” will be removed permanently.`,'Delete task',()=>{del('tasks',t.id);toast('Task deleted')})},
  tcadd:()=>{if(!guard('tasks'))return;const v=$('#tcnew').value.trim();if(!v)return;capTask();const x=clone(D.tasks[S.modal.id]);x.checklist=(x.checklist||[]).concat([{t:v,done:false}]);put('tasks',x);renderModal();setTimeout(()=>{const i=$('#tcnew');if(i)i.focus()},0)},
  tcrm:el=>{if(!guard('tasks'))return;capTask();const x=clone(D.tasks[S.modal.id]);x.checklist.splice(+el.dataset.i,1);put('tasks',x);renderModal()},
  tcpost:()=>{if(!guard('tasks'))return;const v=$('#tcom').value.trim();if(!v)return;capTask();const x=clone(D.tasks[S.modal.id]);x.comments=(x.comments||[]).concat([{ts:new Date().toISOString(),by:S.me,text:v}]);put('tasks',x);log(`Update on “${x.title}”: ${v.slice(0,80)}`,x.pid,'task');renderModal()},
  teamtab:el=>{S.team.tab=el.dataset.v;render()},
  seedroles:()=>{if(!guard('hires'))return;PLANNED_ROLES.forEach(([r,k],i)=>put('hires',{id:uid(),role:r,kind:k,priority:i<2?'P1':'P2',stage:'Proposed',reason:'',budget:'',target:'',createdAt:new Date().toISOString()}));log('Hiring plan started with four planned roles',null,'hiring')},
  budtab:el=>{S.bud.tab=el.dataset.v;render()},
  budnav:el=>{const d=+el.dataset.d;S.bud.month=d===0?monthStart(TODAY):addMonths(S.bud.month,d);render()},
  pmode:el=>{S.pulse.mode=el.dataset.v;render()},
  pmonth:el=>{const d=+el.dataset.d;S.pulse.month=d===0?monthStart(TODAY):addMonths(S.pulse.month,d);render()},
  pexportm:el=>showMenu(el,[{l:'Monthly report (.md)',i:'dl',fn:()=>saveFile(`product-report-${S.pulse.month.slice(0,7)}.md`,monthMarkdown(),'text/markdown')},{l:'Products snapshot (.csv)',i:'dl',fn:()=>ACT.csvproducts()},{l:'Samples (.csv)',i:'dl',fn:()=>ACT2.csvsamples()}]),
  newsample:()=>ACT2.addsample({dataset:{pid:''}}),
};
/* live deviation update in the sample form */
document.addEventListener('input',e=>{const t=e.target;if(t.dataset&&t.dataset.mrow!==undefined&&$('#sform')){const i=t.dataset.mrow;const g=n=>($(`[name="${n}_${i}"]`)||{}).value;const c=$('#dev_'+i);if(c)c.innerHTML=devHtml(dev({spec:g('spec'),act:g('act'),tol:g('tol')}))}});
/* ============ routing & render ============ */
const ROUTES=['overview','pipeline','roadmap','library','tasks','pulse','setup',...Object.keys(LATER)];
function readHash(){
  const h=(location.hash||'').slice(1);
  if(h.startsWith('product-')){S.route='product';S.param=h.slice(8)}
  else if(ROUTES.includes(h)){S.route=h;S.param=null}
  else{S.route='overview';S.param=null}
}
function go(route,param){const h=route==='product'?'product-'+param:route;if(location.hash.slice(1)!==h)location.hash=h;else{readHash();render()}document.documentElement.classList.remove('sb-open')}
let rq=null;function scheduleRender(){if(rq)return;rq=requestAnimationFrame(()=>{rq=null;render()})}
function render(){
  const ae=document.activeElement;const fid=ae&&ae.id&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')?ae.id:null;const sel=fid?[ae.selectionStart,ae.selectionEnd]:null;
  renderShell();
  if(Store.backend==='login'){if(!$('#lablogin'))renderLabLogin();return}
  if(!Store.ready){$('#main').innerHTML=`<div class="loading"><div><div class="wordmark">OFFCOMFRT</div>Connecting to the live workspace…<div style="margin-top:14px"><button class="btn" data-act="setmode" data-mode="demo">Open demo instead</button></div></div></div>`;return}
  const r=S.route;let h;
  try{
    h=MODS[r]?MODS[r]():r==='overview'?vOverview():r==='pipeline'?vPipeline():r==='product'?vProduct():r==='roadmap'?vRoadmap():r==='library'?vLibrary():r==='tasks'?vTasks():r==='pulse'?vPulse():r==='setup'?vSetup():LATER[r]?vLater(r):vOverview();
  }catch(e){console.error(e);h=`<div class="panel">${empty('This view hit an error',esc(e.message))}</div>`}
  $('#main').innerHTML=`<div class="page">${h}</div>`;
  if(fid){const el=document.getElementById(fid);if(el&&!$('#layer').contains(el)){el.focus();try{el.setSelectionRange(sel[0],sel[1])}catch(e){}}}
  bindDnD();bindTaskDnD();
}
window.addEventListener('hashchange',()=>{const prev=S.route+S.param;readHash();if(S.route+S.param!==prev&&S.route!=='product')S.tab='overview';$('#scroll').scrollTop=0;render()});

/* ============ toast ============ */
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('#toasts').appendChild(t);setTimeout(()=>t.remove(),3800)}

/* ============ drag & drop ============ */
function bindDnD(){
  document.querySelectorAll('[data-drag]').forEach(el=>{
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',el.dataset.drag);e.dataTransfer.effectAllowed='move';el.classList.add('dragging')});
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  });
  document.querySelectorAll('[data-drop]').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop')});
    col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('drop')});
    col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('drop');const id=e.dataTransfer.getData('text/plain');const to=+col.dataset.drop;
      if(!prod(id))return;if(to===S_ARCHIVED){confirmBox('Archive this product?','It stays in the Product Library and can be restored by changing its stage.','Archive',()=>moveStage(id,to))}else moveStage(id,to)});
  });
}

/* ============ modals ============ */
function openModal(m){S.modal=m;renderModal()}
function closeModal(){S.modal=null;$('#layer').innerHTML=''}
function confirmBox(title,body,okLabel,fn,typed){openModal({kind:'confirm',title,body,okLabel,fn,typed})}
const fld=(name,label,val,opt)=>{opt=opt||{};const id='f_'+name;
  const inner=opt.type==='select'?`<select class="inp" id="${id}" name="${name}">${opt.options.map(([v,t])=>`<option value="${esc(v)}" ${String(val)===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>`
    :opt.type==='textarea'?`<textarea class="inp" id="${id}" name="${name}" rows="${opt.rows||3}" placeholder="${esc(opt.ph||'')}">${esc(val||'')}</textarea>`
    :`<input class="inp" id="${id}" name="${name}" type="${opt.type||'text'}" value="${esc(val??'')}" placeholder="${esc(opt.ph||'')}" ${opt.min!=null?`min="${opt.min}"`:''} ${opt.list?`list="${opt.list}"`:''} ${opt.step?`step="${opt.step}"`:''}>`;
  return `<div class="field ${opt.cls||''}"><label for="${id}">${label}${opt.req?' *':''}${opt.lock?` ${ic('lock')}`:''}</label>${inner}${opt.hint?`<div class="hint">${opt.hint}</div>`:''}<div class="err" data-err="${name}"></div></div>`};
function renderModal(){
  const m=S.modal;if(!m){$('#layer').innerHTML='';return}
  let h='';
  if(MODAL2[m.kind]){h=MODAL2[m.kind](m)}
  else if(m.kind==='product'){
    const p=m.id?prod(m.id):newProduct(m.preset||{});const isNew=!m.id;
    const locked=!isNew&&apFor(p.id,'technical').status==='approved'&&apFor(p.id,'creative').status==='approved';
    const colls=(cfg().collections||[]).map(c=>c.name);
    h=`<div class="modal wide"><form id="pform"><div class="modal-h"><div><h2 class="h">${isNew?(m.idea?'New idea':'New product'):'Edit '+esc(p.code)}</h2><p class="muted small" style="margin:4px 0 0">${m.idea?'Ideas don’t need dates. Promote one by moving it along the pipeline.':'Fields marked * are required.'}</p></div><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b">${locked?`<div class="notice">${ic('lock')}<div>Technical and creative approval are in place. Changing a locked field saves as <b>Rev ${(p.rev||1)+1}</b> and returns technical, creative and commercial approval to pending.</div></div>`:''}
    <div class="grid3">
      ${fld('code','Product code',p.code,{req:true,ph:'e.g. WAFFLE-002'})}${fld('name','Product name',p.name,{req:true,cls:'span2'})}
      ${fld('dept','Department',p.dept,{type:'select',options:DEPTS.map(d=>[d,d])})}${fld('category','Category',p.category,{ph:'Hoodie, Tee, Bottoms…'})}
      ${fld('priority','Priority',p.priority,{type:'select',options:PRIORITIES.map(x=>[x,x])})}
      ${m.idea?'':fld('collection','Collection',p.collection,{list:'colls',ph:colls.length?'Choose or type':'Optional'})}${m.idea?'':fld('season','Season',p.season,{ph:'Winter 2026'})}
      ${fld('owner','Owner',p.owner,{type:'select',options:people().map(x=>[x.id,x.name])})}
      ${isNew&&!m.idea?fld('stage','Starting stage',p.stage,{type:'select',options:STAGES.slice(0,8).map((s,i)=>[i,pad(i+1)+' '+s]),hint:'Production stages are reached through approval gates.'}):''}
      ${m.idea?fld('notes','Idea notes',p.notes,{type:'textarea',cls:'span3',rows:4,ph:'What is it, who is it for, what makes it OFFCOMFRT?'}):`
      <div class="formsec">Specification</div>
      ${fld('fabric','Fabric',p.fabric,{lock:locked})}${fld('composition','Composition',p.composition,{lock:locked,ph:'e.g. 100% cotton'})}${fld('gsm','GSM',p.gsm,{type:'number',min:0,lock:locked})}
      ${fld('colorways','Colorways',p.colorways,{lock:locked,cls:'span2'})}${fld('washCare','Wash care',p.washCare,{lock:locked})}
      ${fld('construction','Construction notes',p.construction,{type:'textarea',cls:'span3',lock:locked})}
      <div class="formsec">Commercials (₹)</div>
      ${fld('mrp','Target MRP',p.mrp,{type:'number',min:0,step:'any',lock:locked})}${fld('estCost','Estimated cost',p.estCost,{type:'number',min:0,step:'any',lock:locked})}${fld('targetMargin','Target gross margin %',p.targetMargin,{type:'number',min:0,step:'any'})}
      <div class="formsec">Plan</div>
      ${fld('targetSample','Target first sample',(msOf(p.id,'firstSample')||{}).target||'',{type:'date',hint:'Saved as the First sample milestone'})}
      ${fld('launch','Expected launch',(msOf(p.id,'release')||{}).target||'',{type:'date',hint:isNew?'Saved as the Target release milestone':'Changing this moves the release. Confirm it’s agreed.'})}
      <div></div>
      ${fld('nextAction','Next action',p.nextAction,{cls:'span2',ph:'One clear next step'})}${fld('blockers','Blockers',p.blockers,{ph:'Leave empty if none'})}
      ${locked?fld('revReason','Reason for revision',m.revReason||'',{cls:'span3',hint:'Recorded with the new revision if locked fields change.'}):''}`}
    </div><datalist id="colls">${colls.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="modal-f"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">${isNew?(m.idea?'Add idea':'Add product'):'Save changes'}</button></div></form></div>`;
  }else if(m.kind==='task'){
    const t=m.id?D.tasks[m.id]:{title:m.title||'',pid:m.pid||'',who:S.me,due:m.due||'',priority:'P2',status:'todo',notes:''};
    h=`<div class="modal"><form id="tform"><div class="modal-h"><h2 class="h">${m.id?'Edit task':m.review?'Schedule review':'New task'}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><div class="grid2">${fld('title','Task',t.title,{req:true,cls:'span2'})}
      ${fld('pid','Product',t.pid,{type:'select',options:[['','No product']].concat(products().filter(p=>p.stage!==S_ARCHIVED).map(p=>[p.id,p.code+' · '+p.name]))})}${fld('who','Owner',t.who,{type:'select',options:people().map(x=>[x.id,x.name])})}
      ${fld('due',m.review?'Review date':'Due date',t.due,{type:'date',req:!!m.review})}${fld('priority','Priority',t.priority,{type:'select',options:PRIORITIES.map(x=>[x,x])})}
      ${fld('status','Status',t.status,{type:'select',options:Object.entries(TSTAT)})}<div></div>
      ${fld('notes','Notes',t.notes,{type:'textarea',cls:'span2'})}</div></div>
    <div class="modal-f">${m.id?`<button type="button" class="btn" data-act="deltask" data-id="${m.id}" style="margin-right:auto">${ic('trash')}Delete</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">${m.id?'Save task':m.review?'Schedule review':'Add task'}</button></div></form></div>`;
  }else if(m.kind==='decide'){
    const p=prod(m.pid);const a=apFor(m.pid,m.t);
    h=`<div class="modal"><div class="modal-h"><div><h2 class="h">${AP[m.t].label}</h2><p class="muted small" style="margin:4px 0 0">${esc(p.code)} · ${esc(p.name)} · currently ${a.status==='none'?'not requested':a.status}</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b">${fld('apnote','Note',a.status==='rejected'?a.note:'',{type:'textarea',hint:'Required when you send it back with changes.'})}</div>
    <div class="modal-f"><button class="btn" data-act="close">Cancel</button><button class="btn" data-act="apgo" data-v="rejected">Changes required</button><button class="btn pri" data-act="apgo" data-v="approved">Approve</button></div></div>`;
  }else if(m.kind==='gate'){
    const p=prod(m.pid);
    h=`<div class="modal"><div class="modal-h"><div><h2 class="h">${ic('lock')} Gate locked</h2><p class="muted small" style="margin:4px 0 0">${esc(p.code)} can’t move to ${esc(STAGES[m.to])} yet.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><p>These approvals are needed first:</p><ul class="list">${m.miss.map(t=>{const a=apFor(m.pid,t);return `<li class="li"><b style="flex:1">${AP[t].label}</b><span class="small muted">${AP[t].who}</span><span class="pill ${a.status==='pending'?'hatch':'dash'}">${{none:'Not requested',pending:'Pending',rejected:'Changes required'}[a.status]||a.status}</span></li>`}).join('')}</ul></div>
    <div class="modal-f"><button class="btn" data-act="close">Close</button><button class="btn pri" data-act="gotoap" data-id="${m.pid}">Open approvals</button></div></div>`;
  }else if(m.kind==='confirm'){
    h=`<div class="modal"><div class="modal-h"><h2 class="h">${esc(m.title)}</h2></div><div class="modal-b"><p>${m.body}</p>${m.typed?`<div class="field"><label for="cftyped">Type <b>${esc(m.typed)}</b> to confirm</label><input class="inp" id="cftyped" autocomplete="off"></div>`:''}</div>
    <div class="modal-f"><button class="btn" data-act="close">Cancel</button><button class="btn pri" data-act="confirmok">${esc(m.okLabel)}</button></div></div>`;
  }else if(m.kind==='dup'){
    const p=prod(m.id);
    h=`<div class="modal"><form id="dform"><div class="modal-h"><div><h2 class="h">Duplicate ${esc(p.code)}</h2><p class="muted small" style="margin:4px 0 0">Copies the specification into a new Idea-stage record. ${esc(p.code)} stays exactly as it is.</p></div><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><div class="grid2">${fld('code','New product code','',{req:true,ph:p.code.replace(/\d+$/,n=>pad(+n+1).padStart(n.length,'0'))})}${fld('name','New product name',p.name+' (new)',{req:true})}</div></div>
    <div class="modal-f"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Create duplicate</button></div></form></div>`;
  }else if(m.kind==='person'){
    const x=m.id?person(m.id):{name:'',role:'member'};
    h=`<div class="modal"><form id="peform"><div class="modal-h"><h2 class="h">${m.id?'Edit person':'Add person'}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><div class="grid2">${fld('name','Name',x.name,{req:true})}${fld('role','Role',x.role,{type:'select',options:Object.entries(ROLES)})}</div></div>
    <div class="modal-f">${m.id&&people().length>1?`<button type="button" class="btn" data-act="delperson" data-id="${m.id}" style="margin-right:auto">Remove</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save</button></div></form></div>`;
  }else if(m.kind==='coll'){
    const c=m.id?(cfg().collections||[]).find(x=>x.id===m.id):{name:'',season:'',start:'',end:'',note:''};
    h=`<div class="modal"><form id="cform"><div class="modal-h"><h2 class="h">${m.id?'Edit collection':'New collection'}</h2><button type="button" class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><div class="grid2">${fld('name','Collection name',c.name,{req:true})}${fld('season','Season',c.season,{ph:'Winter 2026'})}${fld('start','Release window from',c.start,{type:'date'})}${fld('end','Release window to',c.end,{type:'date'})}${fld('note','Story / notes',c.note,{type:'textarea',cls:'span2'})}</div></div>
    <div class="modal-f">${m.id?`<button type="button" class="btn" data-act="delcoll" data-id="${m.id}" style="margin-right:auto">Delete</button>`:''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save collection</button></div></form></div>`;
  }else if(m.kind==='text'){
    h=`<div class="modal wide"><div class="modal-h"><div><h2 class="h">${esc(m.title)}</h2><p class="muted small" style="margin:4px 0 0">If the download didn’t start, copy the contents below instead.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b"><textarea class="inp" id="txtout" rows="16" readonly style="font-size:12px">${esc(m.text)}</textarea></div>
    <div class="modal-f"><button class="btn" data-act="close">Close</button><button class="btn pri" data-act="copytxt">Copy</button></div></div>`;
  }else if(m.kind==='palette'){
    h=`<div class="modal pal"><input id="palq" placeholder="Search products, collections, tasks, pages" autocomplete="off" value="${esc(m.q||'')}"><div class="pal-res" id="palres">${palResults(m.q||'')}</div></div>`;
  }
  $('#layer').innerHTML=`<div class="scrim" data-act="scrim">${h}</div>`;
  const first=$('#layer').querySelector('#palq,input:not([type=hidden]):not([readonly]),textarea,select');
  if(first&&!$('#layer').contains(document.activeElement))first.focus();
}

/* ============ palette ============ */
function palItems(q){
  q=q.trim().toLowerCase();const out=[];
  NAV.filter(n=>n.id).concat([{id:'setup',l:'Workspace setup'}]).forEach(n=>{if(!q||n.l.toLowerCase().includes(q))out.push({k:'Page',t:n.l,go:()=>go(n.id)})});
  products().forEach(p=>{const hay=[p.code,p.name,p.collection,p.fabric,p.category,p.composition].join(' ').toLowerCase();if(!q||hay.includes(q))out.push({k:'Product',t:`${p.code} · ${p.name}`,s:STAGES[p.stage],go:()=>{S.tab='overview';go('product',p.id)}})});
  (cfg().collections||[]).forEach(c=>{if(!q||c.name.toLowerCase().includes(q))out.push({k:'Collection',t:c.name,s:c.season,go:()=>{S.rm.coll=c.name;go('roadmap')}})});
  [...new Set(products().map(p=>p.fabric).filter(Boolean))].forEach(f=>{if(q&&f.toLowerCase().includes(q))out.push({k:'Fabric',t:f,s:'Products using it',go:()=>{S.f=Object.assign(S.f,{q:f});go('pipeline')}})});
  out.push(...palExtra(q));
  Object.values(D.tasks).forEach(t=>{if(q&&t.title.toLowerCase().includes(q))out.push({k:'Task',t:t.title,s:pname(t.who),go:()=>openModal({kind:'task',id:t.id})})});
  return q?out.slice(0,30):out.filter(x=>x.k!=='Page').slice(0,8).concat(out.filter(x=>x.k==='Page'));
}
let PAL=[],palIdx=0;
function palResults(q){PAL=palItems(q);palIdx=0;return PAL.length?PAL.map((x,i)=>`<div class="pal-it ${i===0?'on':''}" data-act="palgo" data-i="${i}"><span class="k">${x.k}</span><span style="flex:1">${esc(x.t)}</span><span class="tiny muted">${esc(x.s||'')}</span></div>`).join(''):`<div class="empty">Nothing matches “${esc(q)}”.</div>`}

/* ============ menus ============ */
function showMenu(anchor,items){
  closeMenu();const r=anchor.getBoundingClientRect();const m=document.createElement('div');m.className='menu';m.id='menu';
  m.innerHTML=items.map((it,i)=>`<button data-mi="${i}">${it.i?ic(it.i):''}${esc(it.l)}</button>`).join('');
  document.body.appendChild(m);const w=m.offsetWidth;m.style.top=(r.bottom+6)+'px';m.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.right-w))+'px';
  m.addEventListener('click',e=>{const b=e.target.closest('[data-mi]');if(b){closeMenu();items[+b.dataset.mi].fn()}});
}
function closeMenu(){const m=$('#menu');if(m)m.remove()}

/* ============ export / import ============ */
async function saveFile(filename,text,mime){
  try{const url=URL.createObjectURL(new Blob([text],{type:mime||'text/plain'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Downloaded '+filename)}
  catch(e){openModal({kind:'text',title:filename,text})}
}
const csvCell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const toCSV=(head,rows)=>[head.join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\n');
const P_CSV=['code','name','dept','category','collection','season','owner','stage','priority','fabric','composition','gsm','colorways','washCare','mrp','estCost','targetMargin','firstSample','release','nextAction','blockers'];
function productsCSV(ps){return toCSV(P_CSV,(ps||products()).map(p=>P_CSV.map(k=>k==='owner'?pname(p.owner):k==='stage'?STAGES[p.stage]:k==='firstSample'?(msOf(p.id,'firstSample')||{}).target||'':k==='release'?releaseDate(p.id):p[k])))}
function tasksCSV(){return toCSV(['title','type','product','owner','due','priority','status','checklist','notes'],Object.values(D.tasks).map(t=>[t.title,t.type||'',(prod(t.pid)||{}).code||'',pname(t.who),t.due,t.priority,TSTAT[t.status],(t.checklist||[]).map(c=>(c.done?'[x] ':'[ ] ')+c.t).join('; '),t.notes]))}
function msCSV(){return toCSV(['product','milestone','target','baseline','completed','note'],Object.values(D.milestones).filter(m=>prod(m.pid)).sort((a,b)=>prod(a.pid).code.localeCompare(prod(b.pid).code)||MS_ORDER.indexOf(a.type)-MS_ORDER.indexOf(b.type)).map(m=>[prod(m.pid).code,MS_LABEL[m.type],m.target,m.baseline,m.done,m.note]))}
function parseCSV(text){
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
    else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}
  if(cell!==''||row.length){row.push(cell);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()!==''));
}
function importProductsCSV(text){
  const rows=parseCSV(text);if(rows.length<2){toast('That CSV has no data rows.');return}
  const head=rows[0].map(h=>h.trim());const ix=k=>head.indexOf(k);
  if(ix('code')<0||ix('name')<0){toast('The CSV needs at least “code” and “name” columns. Export products to get the template.');return}
  let added=0,skipped=0;const codes=new Set(products().map(p=>p.code.toUpperCase()));
  rows.slice(1).forEach(r=>{const g=k=>ix(k)>=0?(r[ix(k)]||'').trim():'';const code=g('code').toUpperCase();
    if(!code||!g('name')||codes.has(code)){skipped++;return}
    const stg=STAGES.indexOf(g('stage'));const own=people().find(x=>x.name===g('owner'));
    const p=newProduct({code,name:g('name'),dept:DEPTS.includes(g('dept'))?g('dept'):DEPTS[0],category:g('category'),collection:g('collection'),season:g('season'),owner:own?own.id:S.me,stage:stg>=0&&stg<8?stg:0,priority:PRIORITIES.includes(g('priority'))?g('priority'):'P2',fabric:g('fabric'),composition:g('composition'),gsm:g('gsm'),colorways:g('colorways'),washCare:g('washCare'),mrp:g('mrp'),estCost:g('estCost'),targetMargin:g('targetMargin'),nextAction:g('nextAction'),blockers:g('blockers')});
    put('products',p);
    if(g('firstSample')||g('release')){ensureMilestones(p.id);if(/^\d{4}-\d\d-\d\d$/.test(g('firstSample')))setMsDate(p.id,'firstSample',g('firstSample'));if(/^\d{4}-\d\d-\d\d$/.test(g('release')))setMsDate(p.id,'release',g('release'))}
    log('Product imported from CSV',p.id,'product');codes.add(code);added++});
  toast(`Imported ${added} product${added===1?'':'s'}${skipped?`, skipped ${skipped} (missing fields or existing code)`:''}.`);
}
function replaceWorkspace(data){
  COLLS.forEach(c=>{Object.keys(D[c]).forEach(id=>{if(!(data[c]&&data[c][id]))del(c,id)})});
  COLLS.forEach(c=>Object.values(data[c]||{}).forEach(r=>put(c,r)));
  toast('Backup imported.');
}
function readFile(input,cb,asDataURL){const f=input.files&&input.files[0];if(!f)return;const r=new FileReader();r.onload=()=>cb(r.result,f);r.onerror=()=>toast('Couldn’t read that file.');asDataURL?r.readAsDataURL(f):r.readAsText(f);input.value=''}
function compressImage(dataURL,cb){const img=new Image();img.onload=()=>{const max=640;let w=img.width,h=img.height;if(w>max||h>max){const s=max/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s)}
  const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);cb(c.toDataURL('image/jpeg',.72))};img.onerror=()=>toast('That file isn’t an image the browser can read.');img.src=dataURL}

/* ============ form handling ============ */
function formData(f){const o={};new FormData(f).forEach((v,k)=>o[k]=typeof v==='string'?v.trim():v);return o}
function showErr(form,errs){form.querySelectorAll('[data-err]').forEach(e=>e.textContent=errs[e.dataset.err]||'');const k=Object.keys(errs)[0];if(k){const el=form.querySelector(`[name="${k}"]`);if(el)el.focus()}return !Object.keys(errs).length}
function submitProduct(form){
  const m=S.modal;const v=formData(form);const errs={};
  v.code=(v.code||'').toUpperCase();
  if(!v.code)errs.code='Add a product code.';else if(!/^[A-Z0-9][A-Z0-9\-_.]*$/.test(v.code))errs.code='Use letters, numbers and hyphens, e.g. HOODIE-002.';
  else if(products().some(p=>p.code.toUpperCase()===v.code&&p.id!==m.id))errs.code='Another product already uses this code.';
  if(!v.name)errs.name='Add a product name.';
  ['mrp','estCost','gsm','targetMargin'].forEach(k=>{if(v[k]!=null&&v[k]!==''&&(isNaN(+v[k])||+v[k]<0))errs[k]='Enter a positive number.'});
  if(v.targetMargin&&+v.targetMargin>=100)errs.targetMargin='Margin must be under 100%.';
  if(v.targetSample&&v.launch&&v.targetSample>v.launch)errs.targetSample='First sample is after the launch date.';
  if(!showErr(form,errs))return;
  const msFields={targetSample:v.targetSample,launch:v.launch};delete v.targetSample;delete v.launch;
  const reason=v.revReason;delete v.revReason;
  if(!m.id){
    const p=newProduct(Object.assign({},m.preset||{},v,{stage:+(v.stage??(m.preset||{}).stage??0)}));put('products',p);
    log(m.idea?'Idea added':`Product created at ${STAGES[p.stage]}`,p.id,'product');
    if(m.fromIdea&&D.ideas[m.fromIdea]){const x=clone(D.ideas[m.fromIdea]);x.status='Converted';x.productId=p.id;put('ideas',x);log(`Promoted from the Wall: ${x.title}`,p.id,'product')}
    if(!m.idea&&(msFields.targetSample||msFields.launch||p.stage>=2)){ensureMilestones(p.id);if(msFields.targetSample)setMsDate(p.id,'firstSample',msFields.targetSample);if(msFields.launch)setMsDate(p.id,'release',msFields.launch)}
    closeModal();toast(`${p.code} added`);S.tab='overview';go('product',p.id);return;
  }
  const old=prod(m.id);const p=Object.assign(clone(old),v);
  const locked=apFor(old.id,'technical').status==='approved'&&apFor(old.id,'creative').status==='approved';
  const changes=LOCKED_FIELDS.filter(k=>v[k]!==undefined&&String(old[k]??'')!==String(v[k]??'')).map(k=>({f:k,from:String(old[k]??''),to:String(v[k]??'')}));
  const finish=()=>{
    p.updatedAt=new Date().toISOString();
    if(locked&&changes.length){
      p.rev=(old.rev||1)+1;p.revisions=(old.revisions||[]).concat([{rev:p.rev,ts:p.updatedAt,by:S.me,changes,reason:reason||''}]);
      ['technical','creative','commercial'].forEach(t=>{const a=clone(apFor(p.id,t));if(a.status==='approved'){a.status='pending';a.requestedAt=p.updatedAt;a.requestedBy=S.me;a.history=(a.history||[]).concat([{ts:p.updatedAt,by:S.me,action:'reset',note:`Rev ${p.rev}`}]);put('approvals',a)}});
      log(`Revision ${p.rev} created (${changes.map(c=>c.f).join(', ')}); approvals returned to pending`,p.id,'revision');
    }else if(changes.length){p.revisions=(old.revisions||[]);}
    put('products',p);
    const relOld=releaseDate(p.id);
    if(msFields.targetSample!==undefined&&msFields.targetSample!==((msOf(p.id,'firstSample')||{}).target||''))setMsDate(p.id,'firstSample',msFields.targetSample);
    if(msFields.launch!==undefined&&msFields.launch!==relOld)setMsDate(p.id,'release',msFields.launch);
    const changed=Object.keys(v).filter(k=>String(old[k]??'')!==String(v[k]??''));
    if(changed.length&&!(locked&&changes.length))log(`Updated ${changed.join(', ')}`,p.id,'product');
    closeModal();toast('Saved');
  };
  if(locked&&changes.length)confirmBox(`Create Rev ${(old.rev||1)+1}?`,`You changed protected fields (${changes.map(c=>c.f).join(', ')}). This records a new revision and returns technical, creative and commercial approval to pending.`,'Create revision',finish);
  else finish();
}

/* ============ actions ============ */
const ACT={
  go:el=>go(el.dataset.to),
  back:()=>history.length>1?history.back():go('pipeline'),
  collapse:()=>{document.documentElement.classList.toggle('sb-collapsed');try{localStorage.setItem('ofc-sb',document.documentElement.classList.contains('sb-collapsed')?'1':'0')}catch(e){}},
  mobnav:()=>document.documentElement.classList.toggle('sb-open'),
  theme:()=>{const r=document.documentElement;const dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';try{localStorage.setItem('ofc-theme',r.dataset.theme)}catch(e){}},
  palette:()=>openModal({kind:'palette',q:''}),
  palgo:el=>{const it=PAL[+el.dataset.i];closeModal();if(it)it.go()},
  newmenu:el=>showMenu(el,[{l:'Product',i:'board',fn:()=>ACT.newproduct()},{l:'Idea',i:'wall',fn:()=>ACT.newidea()},{l:'Task',i:'task',fn:()=>ACT.newtask({dataset:{}})},{l:'Review',i:'cal',fn:()=>ACT.newreview()},{l:'Collection',i:'layers',fn:()=>ACT.newcoll()}]),
  newproduct:()=>{if(guardEdit())openModal({kind:'product'})},
  newidea:()=>{if(guardEdit())openModal({kind:'product',idea:true})},
  newtask:el=>{if(guardEdit())openModal({kind:'task',pid:el&&el.dataset&&el.dataset.pid||(S.route==='product'?S.param:'')})},
  newreview:()=>{if(guardEdit())openModal({kind:'task',review:true,title:'Design review: ',due:addDays(TODAY,2),pid:S.route==='product'?S.param:''})},
  edittask:el=>openModal({kind:'task',id:el.dataset.id}),
  deltask:el=>{if(!guardEdit())return;const t=D.tasks[el.dataset.id];confirmBox('Delete this task?',`“${esc(t.title)}” will be removed permanently.`,'Delete task',()=>{del('tasks',t.id);closeModal();toast('Task deleted')})},
  close:()=>closeModal(),
  scrim:(el,e)=>{if(e.target===el)closeModal()},
  confirmok:()=>{const m=S.modal;if(m.typed){const v=($('#cftyped')||{}).value||'';if(v.trim()!==m.typed){toast(`Type ${m.typed} to confirm.`);return}}S.modal=null;$('#layer').innerHTML='';m.fn()},
  copytxt:()=>{const t=$('#txtout');t.select();(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).then(()=>toast('Copied to clipboard')).catch(()=>{document.execCommand&&document.execCommand('copy');toast('Copied')})},
  kpi:el=>{const k=kpis().find(x=>x.k===el.dataset.k);if(k.go.route)return go(k.go.route);if(k.go.anchor){const a=document.getElementById(k.go.anchor);if(a)a.scrollIntoView({behavior:'smooth'});return}
    S.f={q:'',dept:'',coll:'',stage:k.go.stage||'',owner:'',month:'',pri:''};S.pipeView='table';go('pipeline')},
  stagefilter:el=>{S.f={q:'',dept:'',coll:'',stage:el.dataset.stage,owner:'',month:'',pri:''};S.pipeView='table';go('pipeline')},
  clearf:()=>{S.f={q:'',dept:'',coll:'',stage:'',owner:'',month:'',pri:''};render()},
  pipeview:el=>{S.pipeView=el.dataset.v;try{localStorage.setItem('ofc-pipeview',S.pipeView)}catch(e){}render()},
  sort:el=>{const k=el.dataset.k;S.sort=S.sort.k===k?{k,d:-S.sort.d}:{k,d:1};render()},
  open:(el,e)=>{if(e&&e.target.closest('input,select,button:not([data-act="open"]),a'))return;S.tab=el.dataset.tab||'overview';go('product',el.dataset.id)},
  tab:el=>{S.tab=el.dataset.t;render()},
  editproduct:el=>{if(guardEdit())openModal({kind:'product',id:el.dataset.id})},
  pmenu:el=>{const p=prod(el.dataset.id);showMenu(el,[
    {l:'Duplicate as new development',i:'copy',fn:()=>ACT.dup({dataset:{id:p.id}})},
    {l:'Add task',i:'task',fn:()=>ACT.newtask({dataset:{pid:p.id}})},
    {l:'Export product CSV',i:'dl',fn:()=>saveFile(`${p.code}.csv`,productsCSV([p]),'text/csv')},
    p.stage===S_ARCHIVED?{l:'Restore to Idea',i:'archive',fn:()=>moveStage(p.id,0)}:{l:'Archive / cancel',i:'archive',fn:()=>confirmBox(`Archive ${esc(p.code)}?`,'It stays in the Product Library and can be restored later.','Archive',()=>moveStage(p.id,S_ARCHIVED))},
    {l:'Delete permanently',i:'trash',fn:()=>{if(!guardEdit())return;confirmBox(`Delete ${esc(p.code)}?`,'This removes the product, its milestones, tasks and approvals. Archiving keeps the history instead.','Delete permanently',()=>{
      msFor(p.id).forEach(m=>del('milestones',m.id));tasksFor(p.id).forEach(t=>del('tasks',t.id));AP_TYPES.forEach(([t])=>{if(D.approvals[p.id+'--'+t])del('approvals',p.id+'--'+t)});
      del('products',p.id);log(`Deleted product ${p.code}`,null,'product');go('pipeline');toast(`${p.code} deleted`)},p.code)}}])},
  dup:el=>{if(guardEdit())openModal({kind:'dup',id:el.dataset.id})},
  mkms:el=>{if(guardEdit()){ensureMilestones(el.dataset.id);log('Milestone plan created',el.dataset.id,'milestone')}},
  rebase:el=>{if(!guardEdit())return;const m=clone(D.milestones[el.dataset.id]);const old=m.baseline;m.baseline=m.target;put('milestones',m);log(`${MS_LABEL[m.type]} re-planned: ${fmtD(old)} to ${fmtD(m.target)} accepted as the plan`,m.pid,'milestone');toast('New date accepted as plan')},
  aprequest:el=>{if(guardEdit()||myRole()==='ops')decideApproval(el.dataset.id,el.dataset.t,'request')},
  apdecide:el=>openModal({kind:'decide',pid:el.dataset.id,t:el.dataset.t}),
  apgo:el=>{const m=S.modal;const note=($('#f_apnote')||{}).value||'';if(el.dataset.v==='rejected'&&!note.trim()){$('[data-err="apnote"]').textContent='Say what needs to change.';return}decideApproval(m.pid,m.t,el.dataset.v,note.trim());closeModal()},
  gotoap:el=>{closeModal();S.tab='approvals';go('product',el.dataset.id)},
  rmimage:el=>{if(!guardEdit())return;const p=clone(prod(el.dataset.id));p.image='';p.updatedAt=new Date().toISOString();put('products',p)},
  savenotes:el=>{if(!guardEdit())return;const p=clone(prod(el.dataset.id));p.notes=$('#pnotes').value;p.updatedAt=new Date().toISOString();put('products',p);log('Design notes updated',p.id,'product');toast('Notes saved')},
  addref:el=>{if(!guardEdit())return;const t=$('#reft').value.trim(),u=$('#refu').value.trim();if(!/^https?:\/\/\S+$/i.test(u)){toast('Add a full link starting with https://');return}const p=clone(prod(el.dataset.id));p.refs=(p.refs||[]).concat([{title:t,url:u}]);put('products',p);log(`Reference added: ${t||u}`,p.id,'product')},
  rmref:el=>{if(!guardEdit())return;const p=clone(prod(el.dataset.id));p.refs.splice(+el.dataset.i,1);put('products',p)},
  taskscope:el=>{S.tasks.scope=el.dataset.v;render()},
  taskwho:el=>{S.tasks.who=el.dataset.v;render()},
  csvtasks:()=>saveFile('offcomfrt-tasks.csv',tasksCSV(),'text/csv'),
  csvproducts:()=>saveFile('offcomfrt-products.csv',productsCSV(),'text/csv'),
  csvms:()=>saveFile('offcomfrt-milestones.csv',msCSV(),'text/csv'),
  csvmenu:el=>showMenu(el,[{l:'Export filtered products',i:'dl',fn:()=>saveFile('offcomfrt-products.csv',productsCSV(filtered()),'text/csv')},{l:'Export milestones',i:'dl',fn:()=>ACT.csvms()},{l:'Import products…',i:'ul',fn:()=>go('setup')}]),
  rmview:el=>{S.rm.view=el.dataset.v;render()},
  rmnav:el=>{const d=+el.dataset.d;const r=S.rm;if(r.view==='month')r.month=d===0?monthStart(TODAY):addMonths(r.month,d);else r.start=d===0?monthStart(TODAY):addMonths(r.start,d*(r.view==='180'?3:1));render()},
  rmpreset:el=>{if(el.dataset.p==='q'){S.rm.start='2026-11-01';S.rm.view='90';S.rm.month='2026-11-01'}else{S.rm.start='2027-02-01';S.rm.view='180';S.rm.month='2027-02-01'}render()},
  newcoll:()=>{if(guardEdit())openModal({kind:'coll'})},
  editcoll:el=>{if(guardEdit())openModal({kind:'coll',id:el.dataset.id})},
  delcoll:el=>confirmBox('Delete this collection?','Products keep their collection name as text; only the planning window is removed.','Delete',()=>{const c=clone(cfg());c.collections=c.collections.filter(x=>x.id!==el.dataset.id);putConfig(c)}),
  pweek:el=>{const d=+el.dataset.d;S.pulse.week=d===0?weekStart(TODAY):addDays(S.pulse.week,d);render()},
  pfounder:el=>{S.pulse.founder=el.dataset.v==='1';render()},
  pexport:el=>showMenu(el,[{l:'Pulse as Markdown (.md)',i:'dl',fn:()=>saveFile(`product-pulse-${S.pulse.week}.md`,pulseMarkdown(),'text/markdown')},{l:'Products snapshot (.csv)',i:'dl',fn:()=>ACT.csvproducts()},{l:'Milestones (.csv)',i:'dl',fn:()=>ACT.csvms()}]),
  labretry:()=>{if(Store.mode!=='live'){toast('Already in the demo workspace.');return}Lab.offline=false;initStore();toast('Re-syncing the live workspace…')},
  labsignout:()=>{if(Lab.timer){clearInterval(Lab.timer);Lab.timer=null}Lab.token='';try{localStorage.removeItem('ofc-lab-token')}catch(e){}COLLS.forEach(c=>D[c]={});Store.ready=false;showLabLogin()},
  setmode:el=>{const mode=el.dataset.mode;if(Store.mode===mode)return;Store.mode=mode;try{localStorage.setItem('ofc-mode',mode)}catch(e){}S.readOnly=false;S.f={q:'',dept:'',coll:'',stage:'',owner:'',month:'',pri:''};closeModal();go('overview');initStore();render();toast(mode==='demo'?'Switched to the demo workspace':'Switched to the live workspace')},
  resetdemo:()=>confirmBox('Reset demo data?','The demo workspace returns to its starting products. Live data is not affected.','Reset demo',()=>{try{localStorage.removeItem('ofc-ws-demo')}catch(e){}COLLS.forEach(c=>D[c]={});loadLocal();render();toast('Demo reset')}),
  newperson:()=>{if(guardEdit())openModal({kind:'person'})},
  editperson:el=>{if(guardEdit())openModal({kind:'person',id:el.dataset.id})},
  delperson:el=>confirmBox('Remove this person?','Products and tasks they own will show as unassigned until reassigned.','Remove',()=>{const c=clone(cfg());c.people=c.people.filter(x=>x.id!==el.dataset.id);putConfig(c);if(S.me===el.dataset.id){S.me=c.people[0].id;localStorage.setItem('ofc-me',S.me)}}),
  exportjson:()=>{const out={app:'offcomfrt-product-lab',version:1,mode:Store.mode,exportedAt:new Date().toISOString()};COLLS.forEach(c=>out[c]=D[c]);saveFile(`offcomfrt-lab-${Store.mode}-${TODAY}.json`,JSON.stringify(out,null,1),'application/json')},
  wipe:()=>confirmBox('Clear the live workspace?','This deletes every product, milestone, task, approval and activity entry in the live workspace for everyone. Export a backup first.','Clear everything',()=>{COLLS.filter(c=>c!=='config').forEach(c=>Object.keys(D[c]).forEach(id=>del(c,id)));toast('Live workspace cleared')},'CLEAR'),
};

Object.assign(ACT,ACT2);
/* ============ event wiring ============ */
document.addEventListener('click',e=>{
  if(!e.target.closest('#menu'))closeMenu();
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act;if(!ACT[a])return;
  if(a==='open'&&e.target.closest('[data-act]')!==el)return;
  ACT[a](el,e);
});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openModal({kind:'palette',q:''});return}
  if(e.key==='Escape'){if($('#menu'))closeMenu();else if(S.modal)closeModal();document.documentElement.classList.remove('sb-open');return}
  if(S.modal&&S.modal.kind==='palette'){
    const items=[...document.querySelectorAll('.pal-it')];
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();palIdx=Math.max(0,Math.min(items.length-1,palIdx+(e.key==='ArrowDown'?1:-1)));items.forEach((x,i)=>x.classList.toggle('on',i===palIdx));items[palIdx]&&items[palIdx].scrollIntoView({block:'nearest'})}
    if(e.key==='Enter'){e.preventDefault();const it=PAL[palIdx];closeModal();if(it)it.go()}
  }
  if(e.key==='Enter'&&e.target.matches('.card[data-act="open"]')){ACT.open(e.target)}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='palq'){S.modal.q=t.value;$('#palres').innerHTML=palResults(t.value);return}
  const on=t.dataset.on;if(!on)return;
  if(on==='filter'&&t.tagName==='INPUT'){S.f[t.dataset.k]=t.value;render()}
  if(on==='tfilter'&&t.tagName==='INPUT'){S.tasks[t.dataset.k]=t.value;render()}
  if(on==='lfilter'&&t.tagName==='INPUT'){S.lib[t.dataset.k]=t.value;render()}
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='actas'){S.me=t.value;try{localStorage.setItem('ofc-me',S.me)}catch(x){}render();toast(`Acting as ${pname(S.me)} (${ROLES[myRole()]})`);return}
  const on=t.dataset.on;if(!on)return;
  if(CHANGE2[on]){CHANGE2[on](t);return}
  if(on==='filter'){S.f[t.dataset.k]=t.value;render()}
  else if(on==='tfilter'){S.tasks[t.dataset.k]=t.value;render()}
  else if(on==='lfilter'){S.lib[t.dataset.k]=t.value;render()}
  else if(on==='rmf'){S.rm[t.dataset.k]=t.value;render()}
  else if(on==='stage'){const to=+t.value;const p=prod(t.dataset.id);
    if(to===S_ARCHIVED){t.value=p.stage;confirmBox(`Archive ${esc(p.code)}?`,'It stays in the Product Library and can be restored later.','Archive',()=>moveStage(p.id,to))}
    else if(!moveStage(p.id,to))t.value=p.stage}
  else if(on==='msdate'){if(!guardEdit()){render();return}const m=D.milestones[t.dataset.id];const v=t.value;if(v===m.target)return;
    if(m.type==='release'&&m.target&&v!==m.target){const old=m.target;confirmBox('Change the target release?',`Move ${esc(prod(m.pid).code)} release from ${fmtD(old)} to ${v?fmtD(v):'no date'}. Release dates only change when you confirm them.`,'Change release',()=>setMsDate(m.pid,'release',v));render();return}
    setMsDate(m.pid,m.type,v);
    const rel=msOf(m.pid,'release');if(v&&rel&&rel.target&&v>rel.target&&m.type!=='release')toast(`${MS_LABEL[m.type]} now falls after the release date (${fmtD(rel.target)}). The release hasn’t moved; review it.`)}
  else if(on==='msdone'){if(!guardEdit()){render();return}const m=clone(D.milestones[t.dataset.id]);m.done=t.checked?TODAY:'';put('milestones',m);log(`${MS_LABEL[m.type]} ${t.checked?'completed':'reopened'}`,m.pid,'milestone')}
  else if(on==='msnote'){if(!guardEdit())return;const m=clone(D.milestones[t.dataset.id]);m.note=t.value.trim();put('milestones',m)}
  else if(on==='taskstatus'||on==='taskdone'){if(!guardEdit()){render();return}const x=clone(D.tasks[t.dataset.id]);const st=on==='taskdone'?(t.checked?'done':'todo'):t.value;x.status=st;x.doneAt=st==='done'?new Date().toISOString():'';put('tasks',x);
    if(st==='done'||st==='blocked')log(`Task ${st==='done'?'completed':'blocked'}: ${x.title}`,x.pid,'task')}
  else if(on==='image'){if(!guardEdit())return;readFile(t,url=>compressImage(url,small=>{const p=clone(prod(t.dataset.id));p.image=small;p.updatedAt=new Date().toISOString();put('products',p);log('Product image updated',p.id,'product');toast('Image saved')}),true)}
  else if(on==='importcsv'){if(!guardEdit())return;readFile(t,txt=>importProductsCSV(txt))}
  else if(on==='importjson'){if(!guardEdit())return;readFile(t,txt=>{let data;try{data=JSON.parse(txt)}catch(x){toast('That file isn’t valid JSON.');return}
    if(!data||data.app!=='offcomfrt-product-lab'){toast('That file isn’t a Product Lab backup.');return}
    confirmBox('Replace this workspace?',`The ${Store.mode} workspace will be replaced with the backup from ${esc((data.exportedAt||'').slice(0,10))} (${Object.keys(data.products||{}).length} products).`,'Replace workspace',()=>{
      if(Store.backend==='db'){labApi('/import',{method:'POST',body:JSON.stringify(data)}).then(()=>{toast('Backup imported.');initStore()}).catch(labWriteErr)}
      else replaceWorkspace(data)})})}
});
document.addEventListener('submit',e=>{
  e.preventDefault();const f=e.target;if(SUBMIT2[f.id]){SUBMIT2[f.id](f);return}
  if(f.id==='pform')submitProduct(f);
  else if(f.id==='tform'){const v=formData(f);const errs={};if(!v.title||v.title==='Design review:')errs.title='Describe the task.';if(S.modal.review&&!v.due)errs.due='Pick a date.';if(!showErr(f,errs))return;
    const m=S.modal;const t=m.id?Object.assign(clone(D.tasks[m.id]),v):Object.assign({id:uid(),createdAt:new Date().toISOString()},v);if(t.status==='done'&&!t.doneAt)t.doneAt=new Date().toISOString();
    put('tasks',t);if(!m.id)log(`Task added: ${t.title}${t.due?` (due ${fmtD(t.due)})`:''}`,t.pid,'task');closeModal();toast(m.id?'Task saved':'Task added')}
  else if(f.id==='dform'){const v=formData(f);v.code=(v.code||'').toUpperCase();const errs={};if(!v.code)errs.code='Add a code.';else if(products().some(p=>p.code.toUpperCase()===v.code))errs.code='That code is taken.';if(!v.name)errs.name='Add a name.';if(!showErr(f,errs))return;
    const src=prod(S.modal.id);const p=newProduct({code:v.code,name:v.name,dept:src.dept,category:src.category,season:'',owner:S.me,priority:src.priority,fabric:src.fabric,colorways:src.colorways,gsm:src.gsm,composition:src.composition,washCare:src.washCare,construction:src.construction,mrp:src.mrp,estCost:src.estCost,targetMargin:src.targetMargin,image:src.image,notes:`Started from ${src.code} rev ${src.rev||1}.\n\n${src.notes||''}`.trim(),refs:src.refs||[]});
    put('products',p);log(`Duplicated from ${src.code} rev ${src.rev||1}`,p.id,'product');log(`Used as the starting point for ${p.code}`,src.id,'product');closeModal();S.tab='overview';go('product',p.id);toast(`${p.code} created from ${src.code}`)}
  else if(f.id==='peform'){const v=formData(f);if(!showErr(f,v.name?{}:{name:'Add a name.'}))return;const c=clone(cfg());if(S.modal.id){const x=c.people.find(p=>p.id===S.modal.id);x.name=v.name;x.role=v.role}else c.people.push({id:'p-'+uid(),name:v.name,role:v.role});putConfig(c);closeModal();toast('Saved')}
  else if(f.id==='cform'){const v=formData(f);const errs={};if(!v.name)errs.name='Name the collection.';if(v.start&&v.end&&v.end<v.start)errs.end='Ends before it starts.';if(!showErr(f,errs))return;const c=clone(cfg());c.collections=c.collections||[];
    if(S.modal.id){const x=c.collections.find(k=>k.id===S.modal.id);const oldName=x.name;Object.assign(x,v);if(oldName!==v.name)products().filter(p=>p.collection===oldName).forEach(p=>{const q=clone(p);q.collection=v.name;put('products',q)})}else c.collections.push(Object.assign({id:'c-'+uid()},v));putConfig(c);closeModal();toast('Collection saved')}
});

/* ============ boot ============ */
(function boot(){
  try{const th=localStorage.getItem('ofc-theme');if(th)document.documentElement.dataset.theme=th;if(localStorage.getItem('ofc-sb')==='1')document.documentElement.classList.add('sb-collapsed')}catch(e){}
  readHash();render();initStore().then(()=>{if(!person(S.me)&&people()[0]){S.me=people().find(p=>p.role==='lead')?.id||people()[0].id}render()});
})();
