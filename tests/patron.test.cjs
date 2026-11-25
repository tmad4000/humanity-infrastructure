const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const python=`import json,sqlite3,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row;out=[]
with c:
 for s in p['statements']:
  q=c.execute(s['sql'],s['args']);rows=[dict(r)for r in q.fetchall()] if q.description else [];out.append({'results':rows,'meta':{'changes':max(q.rowcount,0)}})
print(json.dumps(out))`;
const IDS=['openchat','lastbook','nosleep'];
function fixture(t,{secrets=false,fetchMock}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hi-patron-sql-')),file=path.join(dir,'test.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const schema=['0001_signups.sql','0002_interest_signals.sql','0004_patron_interest.sql','0005_patron_followups.sql'].map(name=>fs.readFileSync('migrations/'+name,'utf8')).join('\n');
 const init=spawnSync('python3',['-c',"import sqlite3,sys;sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())",file],{input:schema});assert.equal(init.status,0,String(init.stderr));
 const exec=statements=>{const result=spawnSync('python3',['-c',python],{input:JSON.stringify({file,statements}),encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout);};
 const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){return exec([this])[0];},async first(){return exec([this])[0].results[0] || null;},async all(){return exec([this])[0];}};},async batch(statements){return exec(statements);}};
 const context=vm.createContext({crypto:globalThis.crypto,Request,Response,Headers,URL,URLSearchParams,Blob,TextEncoder,TextDecoder,Uint8Array,Date,atob,btoa,fetch:fetchMock || (async()=>{throw Error('no network in tests');})});
 vm.runInContext('const PATRON_PROJECT_IDS='+JSON.stringify(IDS)+';\n'+fs.readFileSync('signup.js','utf8')+'\n'+fs.readFileSync('patron.js','utf8')+'\nthis.route=handlePatron;',context);
 const env={SIGNUPS:db,RATE_LIMIT_SALT:'test-salt',ADMIN_EXPORT_TOKEN:'test-secret',...(secrets?{IDEAFLOW_CLIENT_ID:'client-1',IDEAFLOW_CLIENT_SECRET:'shh',PATRON_SESSION_SECRET:'session-secret'}:{})};
 let counter=0;
 const send=(p,data,{ip='192.0.2.'+(++counter),headers={}}={})=>context.route(new Request('https://example.com'+p,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(data)}),env);
 const table=async name=>(await db.prepare('SELECT * FROM '+name+' ORDER BY created_at').all()).results;
 return {db,env,context,send,post:(data,o)=>send('/api/patron-interest',data,o),nominate:(data,o)=>send('/api/patron-nominate',data,o),rows:()=>table('patron_interest'),noms:()=>table('patron_nominations'),get:(p,headers={})=>context.route(new Request('https://example.com'+p,{headers}),env)};
}
test('other paths are not handled',async t=>{
 const f=fixture(t);assert.equal(await f.get('/patrons'),null);assert.equal(await f.get('/api/interest'),null);assert.equal(await f.get('/beyond'),null);
});
test('stores email, level and consent privately; fixed levels set the amount',async t=>{
 const f=fixture(t);
 const r=await f.post({email:' Person@Example.com ',tier:'patron',notify:true,amount:99999,source_page:'/patrons'});
 assert.equal(r.status,200);assert.equal(await r.text(),'{"ok":true}');assert.equal(r.headers.get('Cache-Control'),'no-store');
 const [row]=await f.rows();
 assert.equal(row.email,'person@example.com');assert.equal(row.tier,'patron');assert.equal(row.amount_cents,1000);assert.equal(row.notify_opt_in,1);assert.equal(row.source_page,'/patrons');
 assert.equal(row.allocations,'{}');assert.equal(row.ideaflow_sub,'');
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM signups').first()).n,0,'never joins the newsletter table');
});
test('a repeat submission updates the level, keeps one row, and answers identically',async t=>{
 const f=fixture(t);
 const first=await f.post({email:'a@example.com',tier:'seed',notify:true});
 const second=await f.post({email:'a@example.com',tier:'custom',amount:25.5,notify:false});
 assert.equal(await first.text(),await second.text());
 const rows=await f.rows();assert.equal(rows.length,1);
 assert.equal(rows[0].tier,'custom');assert.equal(rows[0].amount_cents,2550);assert.equal(rows[0].notify_opt_in,0);
});
test('validation: email, level, custom amount, origin, content type, size',async t=>{
 const f=fixture(t);
 assert.equal((await f.post({email:'nope',tier:'patron'})).status,400);
 assert.equal((await f.post({email:'a@example.com',tier:'gold'})).status,400);
 assert.equal((await f.post({email:'a@example.com',tier:'__proto__'})).status,400);
 for(const amount of [0.5,1001,'10',null,NaN])assert.equal((await f.post({email:'a@example.com',tier:'custom',amount})).status,400);
 assert.equal((await f.post({email:'a@example.com',tier:'patron'},{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.post({email:'a@example.com',tier:'patron'},{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await f.post({email:'a@example.com',tier:'patron',pad:'x'.repeat(5000)})).status,413);
 assert.equal((await f.get('/api/patron-interest')).status,405);
 assert.equal((await f.rows()).length,0);
});
test('per-project split: catalog ids only, bounded amounts, total becomes the monthly amount',async t=>{
 const f=fixture(t);
 const ok=await f.post({email:'s@example.com',tier:'custom',amount:1,allocations:{openchat:2.5,lastbook:1}});
 assert.equal(ok.status,200);
 const [row]=await f.rows();assert.equal(row.amount_cents,350);assert.deepEqual(JSON.parse(row.allocations),{openchat:250,lastbook:100});
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:{'not-listed':5}})).status,400);
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:{constructor:5}})).status,400);
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:{openchat:0.1}})).status,400);
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:{openchat:'5'}})).status,400);
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:{openchat:0.5}})).status,400,'total under $1');
 assert.equal((await f.post({email:'t@example.com',tier:'patron',allocations:{openchat:5}})).status,400,'split needs the custom level');
 assert.equal((await f.post({email:'t@example.com',tier:'custom',allocations:[1]})).status,400);
 assert.equal((await f.rows()).length,1);
 // a later plain submission clears the split
 await f.post({email:'s@example.com',tier:'seed'});assert.equal((await f.rows())[0].allocations,'{}');
});
test('nominations go to a private pending queue; nothing is public',async t=>{
 const f=fixture(t);
 const one=await f.nominate({name:' Blender ',url:'https://www.blender.org',why:'I use it daily',email:'N@Example.com'});
 assert.equal(one.status,200);assert.equal(await one.text(),'{"ok":true}');
 const many=await f.nominate({items:[{name:'react',ecosystem:'npm'},{name:'serde',ecosystem:'cargo'}],why:'From a stack scan'});
 assert.equal(many.status,200);
 const rows=await f.noms();assert.equal(rows.length,3);
 assert.ok(rows.every(r=>r.status==='pending'));
 const blender=rows.find(r=>r.name==='Blender');assert.equal(blender.url,'https://www.blender.org');assert.equal(blender.email,'n@example.com');assert.equal(blender.why,'I use it daily');
 assert.equal(new Set(rows.filter(r=>r.ecosystem).map(r=>r.batch)).size,1,'a scan shares one batch id');
 for(const bad of [{name:'',url:'https://x.org'},{name:'x',url:'http://x.org'},{name:'x',url:'javascript:alert(1)'},{name:'x'},{name:'x',ecosystem:'evil'},{name:'x'.repeat(121),url:'https://x.org'},{name:'x',url:'https://x.org',email:'nope'},{items:[]},{items:Array(31).fill({name:'a',ecosystem:'npm'})},{items:['x']}])assert.equal((await f.nominate(bad)).status,400,JSON.stringify(bad).slice(0,60));
 assert.equal((await f.nominate({name:'x',url:'https://x.org'},{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.nominate({name:'bot',url:'https://x.org',website:'x'})).status,200);
 assert.equal((await f.noms()).length,3);
 assert.equal((await f.get('/api/patron-nominate')).status,405,'no public read of the queue');
 assert.equal((await f.get('/admin/patron-nominations.csv')).status,401);
 const csv=await(await f.get('/admin/patron-nominations.csv',{Authorization:'Bearer test-secret'})).text();
 assert.match(csv,/^id,batch,name,url,ecosystem,why,email,status,created_at,source_page\r\n/);assert.ok(csv.includes('"Blender"'));
});
test('honeypot is accepted and stores nothing',async t=>{
 const f=fixture(t);const r=await f.post({email:'bot@example.com',tier:'patron',website:'x'});
 assert.equal(r.status,200);assert.equal((await f.rows()).length,0);
});
test('a stack scan spends one unit per package: two scans of 30 fit in an hour, a third does not',async t=>{
 const f=fixture(t),scan=()=>f.nominate({items:Array.from({length:30},(_,i)=>({name:'pkg'+i,ecosystem:'npm'}))},{ip:'198.51.100.9'});
 assert.equal((await scan()).status,200);assert.equal((await scan()).status,200);assert.equal((await scan()).status,429);
 assert.equal((await f.noms()).length,60);
});
test('nominated links may not carry credentials',async t=>{
 const f=fixture(t);assert.equal((await f.nominate({name:'x',url:'https://user:pass@example.org/x'})).status,400);assert.equal((await f.noms()).length,0);
});
test('twelve attempts per hashed address per hour, separate from the newsletter budget; raw address never stored',async t=>{
 const f=fixture(t);
 for(let i=0;i<12;i++)assert.equal((await f.post({email:'r'+i+'@example.com',tier:'seed'},{ip:'198.51.100.7'})).status,200);
 const blocked=await f.post({email:'r13@example.com',tier:'seed'},{ip:'198.51.100.7'});
 assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'3600');
 assert.equal((await f.nominate({name:'x',url:'https://x.org'},{ip:'198.51.100.7'})).status,429,'one budget for both patron forms');
 assert.equal((await f.rows()).length,12);
 const limits=(await f.db.prepare('SELECT * FROM signup_rate_limits').all()).results;
 const newsletterKey=await f.context.signupHash('test-salt:198.51.100.7');
 assert.ok(!limits.some(r=>r.ip_hash===newsletterKey),'does not spend the newsletter forms budget');
 assert.ok(!JSON.stringify([limits,await f.rows()]).includes('198.51.100.7'));
});
test('owner export needs the bearer token and neutralises spreadsheet formulas',async t=>{
 const f=fixture(t);
 await f.post({email:'=cmd@example.com',tier:'supporter',notify:true});
 assert.equal((await f.get('/admin/patron-interest.csv')).status,401);
 assert.equal((await f.get('/admin/patron-interest.csv?token=test-secret')).status,401);
 const ok=await f.get('/admin/patron-interest.csv',{Authorization:'Bearer test-secret'});
 assert.equal(ok.status,200);const csv=await ok.text();
 assert.match(csv,/^id,email,tier,amount_cents,notify_opt_in,allocations,ideaflow_sub,created_at,updated_at,source_page\r\n/);
 assert.ok(csv.includes(`"'=cmd@example.com","supporter","300","1"`));
});
test('sign-in is off without its three secrets',async t=>{
 const f=fixture(t);
 assert.deepEqual(await(await f.get('/api/patron-session')).json(),{enabled:false,signedIn:false,email:''});
 for(const p of ['/auth/ideaflow/start','/auth/ideaflow/callback?code=x&state=y'])assert.equal((await f.get(p)).status,404);
 assert.equal((await f.get('/api/patron-session',{Cookie:'hi_patron=abc.def'})).status,200);
});
test('Ideaflow ID sign-in: PKCE start, state-checked callback, signed session, sub stored with the place',async t=>{
 const calls=[];
 const fetchMock=async(url,init={})=>{calls.push({url:String(url),init});
  if(String(url).endsWith('/oauth2/token')){const body=new URLSearchParams(init.body);return body.get('code')==='good'?Response.json({access_token:'at-1'}):new Response('no',{status:400});}
  if(String(url).endsWith('/oauth2/userinfo'))return Response.json({sub:'user-123',email:'Me@Example.com',email_verified:true});
  throw Error('unexpected fetch '+url);};
 const f=fixture(t,{secrets:true,fetchMock});
 assert.equal((await(await f.get('/api/patron-session')).json()).enabled,true);
 const start=await f.get('/auth/ideaflow/start');assert.equal(start.status,302);
 const target=new URL(start.headers.get('Location'));
 assert.equal(target.origin+target.pathname,'https://id.ideaflow.app/api/auth/oauth2/authorize');
 assert.equal(target.searchParams.get('client_id'),'client-1');assert.equal(target.searchParams.get('redirect_uri'),'https://example.com/auth/ideaflow/callback');
 assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.equal(target.searchParams.get('scope'),'openid email');
 assert.ok(!start.headers.get('Location').includes('shh'),'client secret never leaves in a redirect');
 const oauthCookie=start.headers.getSetCookie()[0];assert.match(oauthCookie,/HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
 const pair=oauthCookie.split(';')[0],state=target.searchParams.get('state');
 // wrong state, missing cookie and a refused code all fail closed without a session
 for(const [p,cookie] of [['/auth/ideaflow/callback?code=good&state=wrong',pair],['/auth/ideaflow/callback?code=good&state='+state,''],['/auth/ideaflow/callback?code=bad&state='+state,pair]]){
  const r=await f.get(p,cookie?{Cookie:cookie}:{});assert.equal(r.status,302);assert.match(r.headers.get('Location'),/signin=failed$/);assert.ok(!r.headers.getSetCookie().some(c=>c.startsWith('hi_patron=')&&!c.includes('Max-Age=0')));
 }
 const done=await f.get('/auth/ideaflow/callback?code=good&state='+state,{Cookie:pair});
 assert.equal(done.status,302);assert.equal(done.headers.get('Location'),'https://example.com/patrons');
 const tokenCall=calls.filter(c=>c.url.endsWith('/oauth2/token')).pop(),sent=new URLSearchParams(tokenCall.init.body);
 assert.equal(sent.get('code_verifier'),pair.split('.')[1]);assert.equal(sent.get('client_secret'),'shh');
 const session=done.headers.getSetCookie().find(c=>c.startsWith('hi_patron=')).split(';')[0];
 assert.deepEqual(await(await f.get('/api/patron-session',{Cookie:session})).json(),{enabled:true,signedIn:true,email:'me@example.com'});
 // tampering with the payload or the signature drops the session
 const [name,value]=[session.slice(0,10),session.slice(10)],[body,mac]=value.split('.');
 const forged=Buffer.from(JSON.stringify({sub:'someone-else',email:'x@example.com',exp:Date.now()+1e9})).toString('base64url');
 for(const bad of [name+forged+'.'+mac,name+body+'.'+mac.slice(0,-2)+'xx',name+body])assert.equal((await(await f.get('/api/patron-session',{Cookie:bad})).json()).signedIn,false);
 await f.post({email:'someone-else@example.com',tier:'patron'},{headers:{Cookie:session}});
 assert.equal((await f.rows()).find(r=>r.email==='someone-else@example.com').ideaflow_sub,'','a session cannot attach its account to another email');
 await f.post({email:'me@example.com',tier:'patron'},{headers:{Cookie:session}});
 assert.equal((await f.rows()).find(r=>r.email==='me@example.com').ideaflow_sub,'user-123');
 await f.post({email:'me@example.com',tier:'seed'});
 assert.equal((await f.rows()).find(r=>r.email==='me@example.com').ideaflow_sub,'user-123','a later signed-out update keeps the link');
 const out=await f.send('/auth/ideaflow/signout',{});assert.equal(out.status,200);assert.match(out.headers.get('Set-Cookie'),/^hi_patron=;.*Max-Age=0$/);
 assert.equal((await f.send('/auth/ideaflow/signout',{},{headers:{Origin:'https://evil.example'}})).status,403);
});
test('generated worker: routes on both hosts, strict policy, placeholders intact',async t=>{
 const worker=fs.readFileSync('worker.js','utf8');
 const tmp=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hi-worker-')),'worker.mjs');fs.writeFileSync(tmp,worker);t.after(()=>fs.rmSync(path.dirname(tmp),{recursive:true,force:true}));
 const mod=await import(tmp),hit=async u=>mod.default.fetch(new Request(u),{}, {});
 const type=r=>r.headers.get('Content-Type');
 for(const [u,expected] of [
  ['https://patronage.humanityinfrastructure.com/','text/html'],['https://patronage.humanityinfrastructure.com/beyond','text/html'],
  ['https://patronage.humanityinfrastructure.com/patrons/app.js','application/javascript'],['https://patronage.humanityinfrastructure.com/patrons/lab.js','application/javascript'],
  ['https://patronage.humanityinfrastructure.com/patrons/styles.css','text/css'],['https://patronage.humanityinfrastructure.com/patrons/catalog.json','application/json'],
  ['https://humanityinfrastructure.com/patrons','text/html'],['https://humanityinfrastructure.com/patrons/beyond','text/html'],['https://humanityinfrastructure.com/patrons/lab.js','application/javascript'],['https://humanityinfrastructure.com/','text/html']]){
  const r=await hit(u);assert.equal(r.status,200,u);assert.ok(type(r).startsWith(expected),u+' '+type(r));
 }
 assert.match(await(await hit('https://patronage.humanityinfrastructure.com/beyond')).text(),/<title>Beyond software/);
 assert.match(await(await hit('https://humanityinfrastructure.com/')).text(),/<title>Humanity Infrastructure/);
 const slash=await hit('https://patronage.humanityinfrastructure.com/beyond/');assert.equal(slash.status,302);assert.equal(slash.headers.get('Location'),'https://patronage.humanityinfrastructure.com/beyond');
 const stray=await hit('https://patronage.humanityinfrastructure.com/tools/lastbook');assert.equal(stray.status,302);assert.equal(stray.headers.get('Location'),'https://humanityinfrastructure.com/tools/lastbook');
 for(const u of ['https://patronage.humanityinfrastructure.com/','https://patronage.humanityinfrastructure.com/beyond'])assert.match((await hit(u)).headers.get('Content-Security-Policy'),/default-src 'self'.*script-src 'self'/);
 assert.equal((await mod.default.fetch(new Request('https://patronage.humanityinfrastructure.com/api/patron-session'),{}, {})).status,200);
 for(const name of ['index.html','beyond.html']){
  const html=fs.readFileSync('patrons/'+name,'utf8');
  assert.ok(!/ style="/.test(html),name+': no inline styles (blocked by the page policy)');
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html),name+': no inline scripts');
  assert.ok(!/ on[a-z]+="/.test(html),name+': no inline handlers');
  assert.ok(!html.includes('analytics.ideaflow.app'),name+': no tracker');
  assert.ok(!/tax[- ]deductible/i.test(html.replace(/not tax-deductible|Is this tax-deductible\?|nothing here is tax-deductible/gi,'')),name+': never claims deductibility');
 }
 const html=fs.readFileSync('patrons/index.html','utf8');
 assert.match(html,/<input type="checkbox" name="notify" \/>/,'email opt-in is unticked by default');
 const app=fs.readFileSync('patrons/app.js','utf8');
 assert.match(app,/stripe: \{ seed: null, supporter: null, patron: null, custom: null \}/,'payments stay placeholders until links are approved');
 assert.match(app,/patreon: null/);
 const catalog=JSON.parse(fs.readFileSync('patrons/catalog.json','utf8')),ids=new Set(catalog.entries.map(e=>e.id));
 assert.equal(ids.size,catalog.entries.length,'catalog ids are unique');
 for(const list of catalog.lists)for(const id of list.items)assert.ok(ids.has(id),list.id+' -> '+id);
 for(const e of catalog.entries){assert.match(e.link,/^https:\/\//);if(e.repo)assert.match(e.repo,/^https:\/\//);}
});
