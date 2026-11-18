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
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hi-signals-sql-')),file=path.join(dir,'test.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const init=spawnSync('python3',['-c',"import sqlite3,sys;sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())",file],{input:fs.readFileSync('migrations/0001_signups.sql','utf8')+fs.readFileSync('migrations/0002_interest_signals.sql','utf8')});assert.equal(init.status,0);
 const exec=statements=>{const result=spawnSync('python3',['-c',python],{input:JSON.stringify({file,statements}),encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout);};
 const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){return exec([this])[0];},async first(){return exec([this])[0].results[0] || null;},async all(){return exec([this])[0];}};},async batch(statements){return exec(statements);}};
 let now=Date.now(),counter=0;class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context=vm.createContext({crypto:globalThis.crypto,Request,Response,URL,Blob,TextEncoder,Uint8Array,Date:Clock});
 vm.runInContext('const INTEREST_ITEMS='+fs.readFileSync('interest-items.json','utf8')+';\n'+fs.readFileSync('signup.js','utf8')+'\n'+fs.readFileSync('interest.js','utf8')+'\nthis.route=handleInterest;this.signup=handleSignup;',context);
 const env={SIGNUPS:db,RATE_LIMIT_SALT:'test-salt',ADMIN_EXPORT_TOKEN:'test-secret'};
 const request=(data,ip='192.0.2.'+(++counter),headers={})=>new Request('https://example.com/api/interest',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(data)});
 return {db,env,context,request,route:async(data,ip,headers)=>context.route(request(data,ip,headers),env),get:p=>context.route(new Request('https://example.com'+p),env),advance:ms=>{now+=ms;}};
}
test('anonymous lifecycle; threshold of three; builders/private fields never enter public counts; deletion',async t=>{
 const f=fixture(t);
 for(let i=1;i<=3;i++){
  const r=await f.route({item_key:'signudoc',kind:'want'});assert.equal(r.status,200);assert.equal(await r.text(),'{"ok":true}');
  const body=await(await f.get('/api/interest/counts')).json();assert.deepEqual(body,i<3?{counts:{}}:{counts:{signudoc:3}});
 }
 await f.route({item_key:'paxi',kind:'building',email:'private@example.com',handle:'@private'});
 assert.deepEqual(await(await f.get('/api/interest/counts')).json(),{counts:{signudoc:3}});
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM signups').first()).n,0);
 const row=await f.db.prepare("SELECT * FROM interest_signals WHERE kind='building'").first();assert.equal(row.email,'private@example.com');assert.equal(row.handle,'private');assert.equal(row.letter_opt_in,0);assert.ok(row.consent_at);assert.notEqual(row.ip_hash,'192.0.2.4');
 await f.db.prepare('DELETE FROM interest_signals WHERE item_key=?').bind('signudoc').run();assert.deepEqual(await(await f.get('/api/interest/counts')).json(),{counts:{}});
 await f.db.prepare('DELETE FROM interest_signals').run();assert.equal((await f.db.prepare('SELECT count(*) AS n FROM interest_signals').first()).n,0);
});
test('atomic one-per-item/IP/day across both kinds, daily reset; five/hour shared with signup',async t=>{
 const f=fixture(t),ip='192.0.2.10',payload={item_key:'unlinked',kind:'want'};
 for(const kind of ['want','want','building'])assert.equal((await f.route({...payload,kind},ip)).status,200);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM interest_signals').first()).n,1);
 const signup=new Request('https://example.com/api/signup',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({email:'shared@example.com'})});
 assert.equal((await f.context.signup(signup,f.env)).status,200);assert.equal((await f.route({item_key:'openchat',kind:'want'},ip)).status,200);
 const limited=await f.route(payload,ip);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'3600');
 f.advance(86400000);assert.equal((await f.route(payload,ip)).status,200);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM interest_signals WHERE item_key=?').bind('unlinked').first()).n,2);
});
test('honeypot, same-origin, allowlist, kind, optional contact validation and size caps',async t=>{
 const f=fixture(t);assert.equal((await f.route({website:'bot'})).status,200);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM signup_rate_limits').first()).n,0);
 assert.equal((await f.route({item_key:'paxi',kind:'want'},undefined,{Origin:'https://evil.example'})).status,403);
 const noOrigin=f.request({item_key:'paxi',kind:'want'});noOrigin.headers.delete('Origin');assert.equal((await f.context.route(noOrigin,f.env)).status,403);
 for(const data of [{item_key:'constructor',kind:'want'},{item_key:'unknown',kind:'want'},{item_key:'paxi',kind:'other'},{item_key:'paxi',kind:'want',email:'bad'},{item_key:'paxi',kind:'want',handle:'bad handle'},{item_key:'paxi',kind:'want',letter_opt_in:true}])assert.equal((await f.route(data)).status,400);
 assert.equal((await f.route({item_key:'paxi',kind:'want',extra:'x'.repeat(5000)})).status,413);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM interest_signals').first()).n,0);
});
test('explicit letter consent; uniform duplicate response; existing unsubscribe/token/details preserved',async t=>{
 const f=fixture(t),data={item_key:'lastbook',kind:'building',email:'letter@example.com',handle:'@maker',letter_opt_in:true};
 const first=await f.route(data,'192.0.2.1');assert.equal(await first.text(),'{"ok":true}');
 const row=await f.db.prepare('SELECT * FROM signups').first();assert.equal(row.public_opt_in,0);assert.equal(row.handle,'maker');assert.equal(row.interest,'Lastbook');
 assert.equal((await f.context.signup(new Request('https://example.com/unsubscribe?t='+row.unsubscribe_token),f.env)).status,200);
 const duplicate=await f.route({...data,handle:'replacement'},'192.0.2.1');assert.equal(duplicate.status,200);assert.equal(await duplicate.text(),'{"ok":true}');
 const after=await f.db.prepare('SELECT * FROM signups').first();assert.ok(after.unsubscribed_at);assert.equal(after.unsubscribe_token,row.unsubscribe_token);assert.equal(after.handle,'maker');assert.equal(after.interest,row.interest);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM interest_signals').first()).n,1);
 await f.db.batch([f.db.prepare('DELETE FROM interest_signals'),f.db.prepare('DELETE FROM signups')]);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM signups').first()).n,0);
});
test('owner export only, builder contacts private, formula escaping and draft-only milestone text',async t=>{
 const f=fixture(t);await f.route({item_key:'paxi',kind:'building',email:'=private@example.com',handle:'maker'});
 assert.equal((await f.get('/admin/interest.csv')).status,401);
 const req=new Request('https://example.com/admin/interest.csv',{headers:{Authorization:'Bearer test-secret'}});
 const result=await f.context.route(req,f.env);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
 const csv=await result.text();assert.match(csv,/building/);assert.match(csv,/'=private@example.com/);assert.match(csv,/maker/);assert.doesNotMatch(csv,/ip_hash/);
 const publicBody=await(await f.get('/api/interest/counts')).text();assert.doesNotMatch(publicBody,/private|maker|building/);
});

test('catalogue-backed source preserves original layout access and draft-only milestone exports',async t=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/href="\/classic"/);assert.match(fs.readFileSync('scripts/build.py','utf8'),/path === '\/classic'/);
 const f=fixture(t);
 for(let i=0;i<10;i++)await f.db.prepare('INSERT INTO interest_signals (id,item_key,kind,ip_hash,day,consent_at,source_page,utm,referrer) VALUES (?,?,?,?,?,?,?,?,?)').bind('seed-'+i,'lastbook','want','synthetic-'+i,1,'now','/','{}','').run();
 const result=await f.context.route(new Request('https://example.com/admin/interest.csv',{headers:{Authorization:'Bearer test-secret'}}),f.env);assert.match(await result.text(),/10 interest signals for Lastbook/);
 await f.db.prepare('DELETE FROM interest_signals').run();assert.deepEqual(await(await f.get('/api/interest/counts')).json(),{counts:{}});
});
