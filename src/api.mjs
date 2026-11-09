export const DOG='The dog accompanying our team is a service dog. Please flag allergies, access needs, or site concerns before work begins so suitable arrangements can be discussed and documented.';
const now=()=>new Date().toISOString();
export const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=(x,max=4000)=>typeof x==='string'?x.trim().slice(0,max):'';
export class D1Store {
 constructor(db){this.db=db}
 async get(id){const r=await this.db.prepare('SELECT * FROM records WHERE id=?').bind(id).first();return r?{...JSON.parse(r.data),id:r.id,project:r.project,kind:r.kind,version:r.version,created:r.created}:null}
 async list(kind,project){let s='SELECT * FROM records WHERE kind=?';const args=[kind];if(project!==undefined){s+=' AND project=?';args.push(project)}s+=' ORDER BY created DESC LIMIT 500';const r=await this.db.prepare(s).bind(...args).all();return r.results.map(r=>({...JSON.parse(r.data),id:r.id,project:r.project,kind:r.kind,version:r.version,created:r.created}))}
 async put(r,expected){const {id,project='',kind,version,created=now(),...data}=r;if(expected){const res=await this.db.prepare('UPDATE records SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),id,expected).run();if(!res.meta.changes)fail('This item changed. Refresh and try again.',409)}else{await this.db.prepare('INSERT INTO records(id,project,kind,data,created) VALUES(?,?,?,?,?)').bind(id,project,kind,JSON.stringify(data),created).run()}return this.get(id)}
}
export async function api(req,env){try{
 const url=new URL(req.url),path=url.pathname;
 if(req.method!=='GET'){
  const origin=req.headers.get('origin');if(origin&&origin!==url.origin)fail('Request origin rejected.',403);
  if(Number(req.headers.get('content-length')||0)>700000)fail('Request too large.',413);
 }
 const store=env.STORE||(env.DB?new D1Store(env.DB):null);if(!store)fail('Database is not connected.',503);
 const identity=env.identity?await env.identity(req):{email:req.headers.get('oai-authenticated-user-email'),id:req.headers.get('oai-authenticated-user-id')};
 const email=(identity?.email||'').toLowerCase();const admin=Boolean(identity?.id&&email&&env.ADMIN_EMAIL&&email===env.ADMIN_EMAIL.toLowerCase());
 let body={};if(req.method==='POST'){const raw=await req.text();if(raw.length>700000)fail('Request too large.',413);try{body=JSON.parse(raw)}catch{fail('Invalid request')}}
 const record=async(kind,project,data)=>store.put({id:crypto.randomUUID(),kind,project,...data,created:now()});
 const audit=async(project,action,target)=>record('audit',project,{action,target,actor:admin?'Levi team':email||'Client',at:now()});
 const projectAccess=async id=>{const p=await store.get(id);if(!p||p.kind!=='project'||(!admin&&p.clientEmail?.toLowerCase()!==email&&identity?.project!==id))fail('Project access denied.',403);return p};
 if(path==='/api/session')return json({authenticated:!!identity?.id,admin,email:identity?.email||'',cloud:!!env.identity});
 if(path==='/api/leads'&&req.method==='POST'){
  if(body.website)return json({ok:true,id:'received'});
  if(!str(body.name,120)||!/^\S+@\S+\.\S+$/.test(body.email||'')||!str(body.service,100)||!str(body.town,100)||!str(body.description)||body.consent!==true)fail('Please complete the required fields and contact consent.');
  const key=await digest((req.headers.get('cf-connecting-ip')||email||body.email)+new Date().toISOString().slice(0,10));
  const limit=await store.get('lead-limit-'+key);if((limit?.count||0)>=8)fail('Please call 609-335-7373 for further requests today.',429);
  await store.put({id:'lead-limit-'+key,kind:'limit',count:(limit?.count||0)+1},limit?.version);
  const lead=await record('lead','',{name:str(body.name,120),email:str(body.email,200),phone:str(body.phone,40),town:str(body.town,100),service:str(body.service,100),budget:str(body.budget,100),timeline:str(body.timeline,100),description:str(body.description),consent:true,consentedAt:now(),status:'New'});return json({ok:true,id:lead.id},201);
 }
 if(path==='/api/projects'&&req.method==='GET'){
  if(!identity?.id)fail('Sign in to view your projects.',401);const all=await store.list('project');return json(all.filter(p=>admin||p.clientEmail?.toLowerCase()===email||identity?.project===p.id))
 }
 if(path==='/api/leads'&&req.method==='GET'){if(!admin)fail('Team access required.',403);return json(await store.list('lead'))}
 if(path==='/api/projects'&&req.method==='POST'){
  if(!admin)fail('Team access required.',403);if(!str(body.name,120)||!/^\S+@\S+\.\S+$/.test(body.clientEmail||'')||!str(body.scope)||!str(body.address))fail('Project name, client email, property address, and scope are required.');
  const p=await record('project','',{name:str(body.name,120),clientEmail:str(body.clientEmail,200).toLowerCase(),clientName:str(body.clientName,120),address:str(body.address,400),scope:str(body.scope,8000),budget:Math.max(0,Number(body.budget)||0),start:str(body.start,20),finish:str(body.finish,20),manager:str(body.manager,120)||'Levi project team',phase:'Planning',progress:0,nextUpdate:str(body.nextUpdate,20),serviceDog:DOG,status:'Active'});await audit(p.id,'Project created',p.id);return json(p,201)
 }
 const m=path.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?$/);if(m){
  const p=await projectAccess(m[1]),section=m[2];
  if(req.method==='GET'&&!section){const kinds=['update','milestone','change','concern','message','photo','ack','audit'];const values=await Promise.all(kinds.map(k=>store.list(k,p.id)));return json({project:p,...Object.fromEntries(kinds.map((k,i)=>[k,values[i]]))})}
  if(req.method==='POST'&&section==='settings'){
   if(!admin)fail('Team access required.',403);if(!['Planning','Permits','Construction','Finishes','Closeout','Complete'].includes(body.phase))fail('Select a valid phase.');const v=Number(body.version);if(v!==p.version)fail('This project changed. Refresh and try again.',409);const saved=await store.put({...p,phase:body.phase,progress:Math.min(100,Math.max(0,Number(body.progress)||0)),nextUpdate:str(body.nextUpdate,20),finish:str(body.finish,20)},v);await audit(p.id,'Schedule updated',p.id);return json(saved)
  }
  if(req.method==='POST'&&['update','milestone','change','photo'].includes(section)){
   if(!admin)fail('Team access required.',403);if(!str(body.title,180))fail('A title is required.');let data={title:str(body.title,180),text:str(body.text,6000),author:'Levi team'};
   if(section==='milestone'){if(!body.date)fail('A date is required.');data={...data,date:str(body.date,20),status:'Planned'}}
   if(section==='change'){if(!Number.isFinite(Number(body.amount))||!str(body.text))fail('A scope and price are required.');data={...data,amount:Number(body.amount),days:Math.max(0,Number(body.days)||0),status:'Awaiting approval'}}
   if(section==='photo'){if(!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.image||'')||body.image.length>600000)fail('Choose a JPEG, PNG, or WebP image smaller than 450 KB.');data.image=body.image}
   const saved=await record(section,p.id,data);await audit(p.id,section+' posted',saved.id);return json(saved,201)
  }
  if(req.method==='POST'&&section==='message'){if(!str(body.text))fail('Enter a message.');const r=await record('message',p.id,{text:str(body.text),author:admin?'Levi team':email||'Client',fromTeam:admin});return json(r,201)}
  if(req.method==='POST'&&section==='concern'){
   if(!str(body.title)||!str(body.text))fail('Describe your concern.');const r=await record('concern',p.id,{title:str(body.title,180),text:str(body.text),category:str(body.category,100),priority:str(body.priority,40)||'Normal',status:'Open',owner:p.manager,nextResponse:'',resolution:'',history:[{at:now(),action:'Concern opened',actor:admin?'Levi team':'Client'}]});await audit(p.id,'Concern opened',r.id);return json(r,201)
  }
  if(req.method==='POST'&&section==='ack'){
   if(admin)fail('Client acknowledgement must be recorded by the client.',403);if(!str(body.name,120)||body.agreed!==true)fail('Enter your name and acknowledge the notice.');const r=await record('ack',p.id,{name:str(body.name,120),email,notice:DOG,at:now(),versionOfNotice:'1.0'});await audit(p.id,'Service dog notice acknowledged',r.id);return json(r,201)
  }
  if(req.method==='POST'&&section==='action'){
   const item=await store.get(body.id);if(!item||item.project!==p.id)fail('Item not found.',404);const v=Number(body.version);if(v!==item.version)fail('This item changed. Refresh and try again.',409);
   if(item.kind==='change'){
    if(admin)fail('Change decisions must be recorded by the client.',403);if(item.status!=='Awaiting approval')fail('A decision is already recorded.',409);if(!['Approved','Declined'].includes(body.status)||!str(body.name,120))fail('Your name and decision are required.');const r=await store.put({...item,status:body.status,decidedBy:str(body.name,120),decidedAt:now(),decisionEmail:email},v);await audit(p.id,'Change '+body.status.toLowerCase(),item.id);return json(r)
   }
   if(item.kind==='concern'){
    const allowed=admin?['Acknowledged','In progress','Resolution proposed']:['Resolved','Reopened'];if(!allowed.includes(body.status))fail('This status is not available for your role.',403);
    if(admin&&(!str(body.owner,120)||!str(body.nextResponse,20)||!str(body.resolution)))fail('Assign an owner, response date, and next action or resolution.');if(!admin&&body.status==='Resolved'&&item.status!=='Resolution proposed')fail('The team must propose a resolution before client confirmation.');
    const r=await store.put({...item,status:body.status,owner:admin?str(body.owner,120):item.owner,nextResponse:admin?str(body.nextResponse,20):item.nextResponse,resolution:admin?str(body.resolution):item.resolution,history:[...(item.history||[]),{at:now(),action:body.status,actor:admin?'Levi team':'Client',note:str(body.resolution)}]},v);await audit(p.id,'Concern '+body.status.toLowerCase(),item.id);return json(r)
   }
   if(item.kind==='milestone'&&admin&&['Planned','In progress','Complete','Delayed'].includes(body.status)){const r=await store.put({...item,status:body.status},v);await audit(p.id,'Milestone '+body.status.toLowerCase(),item.id);return json(r)}
   fail('Action not permitted.',403)
  }
 }
 fail('Endpoint not found.',404)
 }catch(e){if(!e.status)console.error('API error',e.message);return json({error:e.status?e.message:'We could not save this request. Please retry or call 609-335-7373.'},e.status||500)}}
