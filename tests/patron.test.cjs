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
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hi-patron-sql-')),file=path.join(dir,'test.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const schema=['0001_signups.sql','0002_interest_signals.sql','0004_patron_interest.sql'].map(name=>fs.readFileSync('migrations/'+name,'utf8')).join('\n');
 const init=spawnSync('python3',['-c',"import sqlite3,sys;sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())",file],{input:schema});assert.equal(init.status,0);
 const exec=statements=>{const result=spawnSync('python3',['-c',python],{input:JSON.stringify({file,statements}),encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout);};
 const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){return exec([this])[0];},async first(){return exec([this])[0].results[0] || null;},async all(){return exec([this])[0];}};},async batch(statements){return exec(statements);}};
 const context=vm.createContext({crypto:globalThis.crypto,Request,Response,URL,Blob,TextEncoder,Uint8Array,Date});
 vm.runInContext(fs.readFileSync('signup.js','utf8')+'\n'+fs.readFileSync('patron.js','utf8')+'\nthis.route=handlePatron;',context);
 const env={SIGNUPS:db,RATE_LIMIT_SALT:'test-salt',ADMIN_EXPORT_TOKEN:'test-secret'};
 let counter=0;
 const post=(data,{ip='192.0.2.'+(++counter),headers={}}={})=>context.route(new Request('https://example.com/api/patron-interest',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(data)}),env);
 const rows=async()=>(await db.prepare('SELECT * FROM patron_interest ORDER BY created_at').all()).results;
 return {db,env,context,post,rows,get:(p,headers={})=>context.route(new Request('https://example.com'+p,{headers}),env)};
}
test('other paths are not handled',async t=>{
 const f=fixture(t);assert.equal(await f.get('/patrons'),null);assert.equal(await f.get('/api/interest'),null);
});
test('stores email, level and consent privately; fixed levels set the amount',async t=>{
 const f=fixture(t);
 const r=await f.post({email:' Person@Example.com ',tier:'patron',notify:true,amount:99999,source_page:'/patrons'});
 assert.equal(r.status,200);assert.equal(await r.text(),'{"ok":true}');assert.equal(r.headers.get('Cache-Control'),'no-store');
 const [row]=await f.rows();
 assert.equal(row.email,'person@example.com');assert.equal(row.tier,'patron');assert.equal(row.amount_cents,1000);assert.equal(row.notify_opt_in,1);assert.equal(row.source_page,'/patrons');
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
 assert.equal((await f.post({email:'a@example.com',tier:'patron',pad:'x'.repeat(3000)})).status,413);
 assert.equal((await f.get('/api/patron-interest')).status,405);
 assert.equal((await f.rows()).length,0);
});
test('honeypot is accepted and stores nothing',async t=>{
 const f=fixture(t);const r=await f.post({email:'bot@example.com',tier:'patron',website:'x'});
 assert.equal(r.status,200);assert.equal((await f.rows()).length,0);
});
test('five attempts per hashed address per hour; raw address never stored',async t=>{
 const f=fixture(t);
 for(let i=0;i<5;i++)assert.equal((await f.post({email:'r'+i+'@example.com',tier:'seed'},{ip:'198.51.100.7'})).status,200);
 const blocked=await f.post({email:'r6@example.com',tier:'seed'},{ip:'198.51.100.7'});
 assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'3600');
 assert.equal((await f.rows()).length,5);
 const dump=JSON.stringify([(await f.db.prepare('SELECT * FROM signup_rate_limits').all()).results,await f.rows()]);
 assert.ok(!dump.includes('198.51.100.7'));
});
test('owner export needs the bearer token and neutralises spreadsheet formulas',async t=>{
 const f=fixture(t);
 await f.post({email:'=cmd@example.com',tier:'supporter',notify:true});
 assert.equal((await f.get('/admin/patron-interest.csv')).status,401);
 assert.equal((await f.get('/admin/patron-interest.csv?token=test-secret')).status,401);
 const ok=await f.get('/admin/patron-interest.csv',{Authorization:'Bearer test-secret'});
 assert.equal(ok.status,200);const csv=await ok.text();
 assert.match(csv,/^id,email,tier,amount_cents,notify_opt_in,created_at,updated_at,source_page\r\n/);
 assert.ok(csv.includes(`"'=cmd@example.com","supporter","300","1"`));
});
test('generated worker serves the page, its assets and a strict policy',async t=>{
 const worker=fs.readFileSync('worker.js','utf8');
 for(const needle of ["path === '/patrons'","PATRONS_ASSETS","handlePatron(request, env, ctx)","/patrons/catalog.json","script-src 'self'"])assert.ok(worker.includes(needle),needle);
 const html=fs.readFileSync('patrons/index.html','utf8');
 assert.ok(!/ style="/.test(html),'no inline styles (blocked by the page policy)');
 assert.ok(!/<script(?![^>]*\bsrc=)/.test(html),'no inline scripts');
 assert.ok(!html.includes('analytics.ideaflow.app'),'no tracker on the patrons page');
 assert.match(html,/<input type="checkbox" name="notify" \/>/,'email opt-in is unticked by default');
 assert.ok(worker.includes("url.hostname === 'patronage.humanityinfrastructure.com'"),'subdomain is routed');
 const app=fs.readFileSync('patrons/app.js','utf8');
 assert.match(app,/stripe: \{ seed: null, supporter: null, patron: null, custom: null \}/,'payments stay placeholders until links are approved');
 assert.match(app,/patreon: null/);
});
