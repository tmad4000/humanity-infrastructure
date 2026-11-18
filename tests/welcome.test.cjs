const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const python=`import json,sqlite3,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.execute('PRAGMA foreign_keys=ON');c.row_factory=sqlite3.Row;out=[]
with c:
 for s in p['statements']:
  q=c.execute(s['sql'],s['args']);rows=[dict(r)for r in q.fetchall()] if q.description else [];out.append({'results':rows,'meta':{'changes':max(q.rowcount,0)}})
print(json.dumps(out))`;
function fixture(t,send=async()=>new Response('{}')){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hi-welcome-sql-')),file=path.join(dir,'db.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const init=spawnSync('python3',['-c',"import sqlite3,sys;sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())",file],{input:['0001_signups','0002_interest_signals','0003_welcome_deliveries'].map(x=>fs.readFileSync('migrations/'+x+'.sql','utf8')).join('\n')});assert.equal(init.status,0);
 const exec=statements=>{const r=spawnSync('python3',['-c',python],{input:JSON.stringify({file,statements}),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout);};
 const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){return exec([this])[0];},async first(){return exec([this])[0].results[0]||null;},async all(){return exec([this])[0];}};},async batch(statements){return exec(statements);}};
 const calls=[],jobs=[];let counter=0;
 const context=vm.createContext({crypto:globalThis.crypto,Request,Response,URL,Blob,TextEncoder,Uint8Array,Date,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return send(url,options);}});
 vm.runInContext('const INTEREST_ITEMS='+fs.readFileSync('interest-items.json','utf8')+';\n'+['welcome.js','signup.js','interest.js'].map(x=>fs.readFileSync(x,'utf8')).join('\n')+'\nthis.signup=handleSignup;this.interest=handleInterest;this.deliver=deliverWelcome;',context);
 const env={SIGNUPS:db,RATE_LIMIT_SALT:'test-salt',ADMIN_EXPORT_TOKEN:'owner',HI_RESEND_API_KEY:'test-not-a-real-key',WELCOME_EMAIL_ENABLED:'true'},ctx={waitUntil(job){jobs.push(job);}};
 const request=(data,route='/api/signup',origin='https://humanityinfrastructure.com')=>new Request(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(++counter)},body:JSON.stringify(data)});
 return {db,env,ctx,calls,jobs,context,request,submit:(data,origin)=>context.signup(request(data,'/api/signup',origin),env,ctx),flush:async()=>{await Promise.all(jobs);}};
}
test('welcome disabled by default and on previews/missing execution context; no delivery table writes or sends',async t=>{
 const f=fixture(t);delete f.env.WELCOME_EMAIL_ENABLED;assert.equal((await f.submit({email:'disabled@example.com'})).status,200);f.env.WELCOME_EMAIL_ENABLED='true';
 assert.equal((await f.submit({email:'preview@example.com'},'https://preview.workers.dev')).status,200);
 assert.equal((await f.context.signup(f.request({email:'noctx@example.com'}),f.env)).status,200);await f.flush();
 assert.equal(f.calls.length,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM welcome_deliveries').first()).n,0);
});
test('new/active/opted-out responses identical; only new signup sends once with private unsubscribe and approved fixed copy',async t=>{
 const f=fixture(t),responses=[];
 for(let i=0;i<2;i++){const r=await f.submit({email:'person@example.com',interest:'private text'});responses.push([r.status,[...r.headers],await r.text()]);await f.flush();}
 const row=await f.db.prepare('SELECT * FROM signups').first();await f.context.signup(new Request('https://humanityinfrastructure.com/unsubscribe?t='+row.unsubscribe_token),f.env,f.ctx);
 const r=await f.submit({email:'person@example.com'});responses.push([r.status,[...r.headers],await r.text()]);await f.flush();assert.deepEqual(responses[0],responses[1]);assert.deepEqual(responses[0],responses[2]);assert.equal(responses[0][2],'{"ok":true}');
 assert.equal(f.calls.length,1);const {url,options}=f.calls[0],mail=JSON.parse(options.body);assert.equal(url,'https://api.resend.com/emails');assert.equal(mail.from,'Humanity Infrastructure <noreply@id.ideaflow.app>');assert.deepEqual(mail.to,['person@example.com']);assert.equal(mail.subject,'Thanks for signing up for the interest list');assert.match(mail.text,/https:\/\/x.com\/jacobcole4000/);assert.match(mail.text,/https:\/\/index.ideaflow.app/);assert.match(mail.text,/Own your mind\. Own your networks\./);assert.ok(mail.text.includes('/unsubscribe?t='+row.unsubscribe_token));assert.doesNotMatch(mail.text,/private text|\{\{/);assert.equal((await f.db.prepare('SELECT status FROM welcome_deliveries').first()).status,'sent');
});
test('provider latency is background-only and concurrent duplicate signups enqueue one receipt/send',async t=>{
 let release;const f=fixture(t,()=>new Promise(resolve=>{release=()=>resolve(new Response('{}'));}));
 const first=await f.submit({email:'race@example.com'});assert.equal(first.status,200);for(let i=0;i<10&&!release;i++)await Promise.resolve();assert.equal(typeof release,'function');
 const second=await f.submit({email:'race@example.com'});assert.equal(await second.text(),'{"ok":true}');release();await f.flush();assert.equal(f.calls.length,1);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM welcome_deliveries').first()).n,1);
});
test('explicit interest letter consent sends welcome; contact-only signal does not subscribe or send',async t=>{
 const f=fixture(t);
 for(const data of [{item_key:'paxi',kind:'building',email:'contact@example.com'},{item_key:'bookshelves',kind:'building',email:'consent@example.com',letter_opt_in:true}])assert.equal((await f.context.interest(f.request(data,'/api/interest'),f.env,f.ctx)).status,200);
 await f.flush();assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(f.calls[0].options.body).to,['consent@example.com']);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM signups').first()).n,1);
});
test('transient provider failure retries boundedly with identical body/idempotency key; permanent failure stays private',async t=>{
 let attempt=0;const f=fixture(t,async()=>new Response('{}',{status:++attempt===1?503:200}));assert.equal((await f.submit({email:'retry@example.com'})).status,200);await f.flush();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.equal((await f.db.prepare('SELECT attempts FROM welcome_deliveries').first()).attempts,2);
 const bad=fixture(t,async()=>new Response('{}',{status:422}));assert.equal(await(await bad.submit({email:'reject@example.com'})).text(),'{"ok":true}');await bad.flush();assert.equal(bad.calls.length,1);assert.equal((await bad.db.prepare('SELECT status FROM welcome_deliveries').first()).status,'failed');
 const network=fixture(t,async()=>{throw Error('provider failed');});assert.equal((await network.submit({email:'network@example.com'})).status,200);await network.flush();assert.equal(network.calls.length,2);assert.equal((await network.db.prepare('SELECT status FROM welcome_deliveries').first()).status,'failed');
});
test('unsubscribe before delivery cancels; deleting synthetic signup cascades receipt; disabled migration rollback is harmless',async t=>{
 const f=fixture(t);delete f.env.WELCOME_EMAIL_ENABLED;await f.submit({email:'cancel@example.com'});const row=await f.db.prepare('SELECT * FROM signups').first();
 await f.db.prepare("INSERT INTO welcome_deliveries(signup_id,created_at,status) VALUES (?,?,'pending')").bind(row.id,'now').run();await f.db.prepare('UPDATE signups SET unsubscribed_at=? WHERE id=?').bind('now',row.id).run();await f.context.deliver(f.env,row.id);assert.equal(f.calls.length,0);assert.equal((await f.db.prepare('SELECT status FROM welcome_deliveries').first()).status,'cancelled');
 await f.db.prepare('DELETE FROM signups WHERE id=?').bind(row.id).run();assert.equal((await f.db.prepare('SELECT count(*) AS n FROM welcome_deliveries').first()).n,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM signups').first()).n,0);
});
