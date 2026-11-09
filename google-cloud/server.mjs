import http from 'node:http';
import {randomBytes,timingSafeEqual,scryptSync,createHmac} from 'node:crypto';
import worker from '../worker/index.js';
import {digest} from '../src/api.mjs';
const {Firestore}=await import('@google-cloud/firestore');
const db=new Firestore();const collection=db.collection('levi_records');
const problem=(msg,status=400)=>{throw Object.assign(Error(msg),{status})};
const store={async get(id){const s=await collection.doc(id).get();return s.exists?s.data():null},async list(kind,project){let q=collection.where('kind','==',kind);if(project!==undefined)q=q.where('project','==',project);const s=await q.limit(500).get();return s.docs.map(d=>d.data()).sort((a,b)=>(b.created||'').localeCompare(a.created||''))},async put(r,expected){const ref=collection.doc(r.id);await db.runTransaction(async tx=>{const old=await tx.get(ref);if(expected&&(!old.exists||old.data().version!==expected))problem('This item changed. Refresh and try again.',409);if(!expected&&old.exists)problem('Record already exists.',409);tx.set(ref,{...r,project:r.project||'',created:r.created||new Date().toISOString(),version:expected?expected+1:1})});return this.get(r.id)}};
const secret=process.env.SESSION_SECRET;if(!secret||secret.length<32)throw Error('Configure SESSION_SECRET with at least 32 random characters.');
const sign=s=>createHmac('sha256',secret).update(s).digest('base64url');
const sessionCookie=user=>{const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+8*3600000})).toString('base64url');return 'levi_session='+payload+'.'+sign(payload)+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800'};
const identity=async req=>{const cookie=req.headers.get('cookie')||'',s=cookie.match(/(?:^|;\s*)levi_session=([^;]+)/)?.[1];if(!s)return null;try{const [payload,sig]=s.split('.'),expected=sign(payload);if(!sig||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const u=JSON.parse(Buffer.from(payload,'base64url'));if(!u.exp||u.exp<Date.now())return null;return u}catch{return null}};
const json=(x,status=200,extra={})=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...extra}});
const env={STORE:store,ADMIN_EMAIL:process.env.ADMIN_EMAIL,identity};
http.createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>700000){res.writeHead(413);res.end();return}chunks.push(c)}const url='https://'+req.headers.host+req.url;const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks),duplex:'half'}:{})});let response;
if(req.url==='/api/login'&&req.method==='POST'){
 if(req.headers.origin&&req.headers.origin!==new URL(url).origin)problem('Request origin rejected.',403);const {email,password}=JSON.parse(Buffer.concat(chunks));if(typeof email!=='string'||typeof password!=='string'||password.length>256)problem('Sign-in failed.',401);
 const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString();const lid='login-'+await digest(ip+new Date().toISOString().slice(0,10));const limit=await store.get(lid);if((limit?.count||0)>=25)problem('Too many attempts today. Contact the team.',429);await store.put({id:lid,kind:'login-limit',count:(limit?.count||0)+1},limit?.version);
 let user=null;if(email.toLowerCase()===process.env.ADMIN_EMAIL?.toLowerCase()){
  const [salt,hash]=(process.env.ADMIN_PASSWORD_HASH||'').split(':');if(salt&&hash){const actual=scryptSync(password,salt,64).toString('hex');if(hash.length===actual.length&&timingSafeEqual(Buffer.from(hash),Buffer.from(actual)))user={id:'cloud-team',email:process.env.ADMIN_EMAIL}}
 }else{const token=await store.get('access-'+await digest(password));if(token&&token.expires>Date.now()&&token.clientEmail===email.toLowerCase())user={id:'client-'+token.project,email:token.clientEmail,project:token.project}}
 if(!user)problem('Email or access details were not recognized.',401);response=json({ok:true},200,{'Set-Cookie':sessionCookie(user)});
}else if(req.url==='/api/logout'&&req.method==='POST')response=json({ok:true},200,{'Set-Cookie':'levi_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
else if(/^\/api\/projects\/[^/]+\/invite$/.test(req.url)&&req.method==='POST'){
 if(req.headers.origin&&req.headers.origin!==new URL(url).origin)problem('Request origin rejected.',403);const u=await identity(request);if(!u?.id||u.email?.toLowerCase()!==process.env.ADMIN_EMAIL?.toLowerCase())problem('Team access required.',403);const id=req.url.split('/')[3],p=await store.get(id);if(!p||p.kind!=='project')problem('Project not found.',404);const code=randomBytes(24).toString('base64url');await store.put({id:'access-'+await digest(code),kind:'access',project:id,clientEmail:p.clientEmail,expires:Date.now()+30*86400000});response=json({code,email:p.clientEmail,expiresInDays:30});
}else response=await worker.fetch(request,env);
res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.status?e.message:'Request failed. Please retry or call the team.'}));if(!e.status)console.error(e.message)}}).listen(Number(process.env.PORT)||8080,'0.0.0.0',()=>console.log('Levi service ready'));
