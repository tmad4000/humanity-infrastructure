const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({crypto:globalThis.crypto, Request, Response, URL, Blob, TextEncoder, Uint8Array, Date});
vm.runInContext(fs.readFileSync('signup.js','utf8') + '\nthis.route = handleSignup; this.csv = signupCsv;', context);
function fixture() {
 const rows = [], rate = new Map();
 const db = { prepare(sql) { return { bind(...args) { this.args = args; return this; }, async first() {const k=this.args[0]; const attempts=(rate.get(k)||0)+1;rate.set(k,attempts);return {attempts};}, async run() {
  if(sql.startsWith('INSERT INTO signups')) { const existing=rows.find(r=>r.email===this.args[1]);if(existing) {if(this.args[10] && this.args[2] && !existing.interest)existing.interest=this.args[2];if(this.args[11])existing.handle=this.args[3];if(!existing.handle)existing.public_opt_in=0;else if(this.args[13])existing.public_opt_in=this.args[14];existing.consent_at=this.args[5];return {meta:{changes:1}};} rows.push(Object.fromEntries(['id','email','interest','handle','public_opt_in','consent_at','source_page','utm','referrer','unsubscribe_token'].map((k,i)=>[k,this.args[i]]))); return {meta:{changes:1}}; }
  if(sql.startsWith('UPDATE signups')) {const row=rows.find(r=>r.unsubscribe_token===this.args[1]);if(row)row.unsubscribed_at=this.args[0];return {meta:{changes:row?1:0}};}
  return {meta:{changes:0}};
 }, async all() { return {results:rows}; } }; } };
 return {rows, env:{SIGNUPS:db,RATE_LIMIT_SALT:'test-salt',ADMIN_EXPORT_TOKEN:'test-admin'}};
}
function request(data, extra={}) {return new Request('https://example.com/api/signup',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...extra},body:JSON.stringify(data)});}
test('signup captures privately, default opt-in off, duplicates retain first interest, refresh consent and preserve opt-out, unsubscribe is idempotent', async()=>{
 const {rows,env}=fixture();
 let result=await context.route(request({email:' TEST@example.com ',interest:'building tools',handle:'@builder',utm:{utm_source:'test',unwanted:'no'}}),env);
 assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
 const originalStatus=result.status, originalHeaders=[...result.headers];
 const originalBody=await result.text();assert.equal(originalBody,'{"ok":true}');
 rows[0].consent_at='2000-01-01T00:00:00.000Z';
 const activeDuplicate=await context.route(request({email:'test@example.com',interest:'updated interest'}),env);assert.equal(activeDuplicate.status,originalStatus);assert.deepEqual([...activeDuplicate.headers],originalHeaders);assert.equal(await activeDuplicate.text(),originalBody);
 assert.equal(rows[0].interest,'building tools');assert.notEqual(rows[0].consent_at,'2000-01-01T00:00:00.000Z');
 const unsubscribeUrl='https://example.com/unsubscribe?t='+rows[0].unsubscribe_token;assert.equal(rows.length,1);assert.equal(rows[0].email,'test@example.com');assert.equal(rows[0].public_opt_in,0);assert.equal(rows[0].utm,'{"utm_source":"test"}');
 result=await context.route(new Request(unsubscribeUrl),env);assert.equal(result.status,200);assert.ok(rows[0].unsubscribed_at);
 assert.equal((await context.route(new Request(unsubscribeUrl),env)).status,200);
 const duplicate=await context.route(request({email:'test@example.com',interest:'opted-out interest'}),env);assert.equal(duplicate.status,originalStatus);assert.deepEqual([...duplicate.headers],originalHeaders);assert.equal(await duplicate.text(),originalBody);assert.equal(rows[0].public_opt_in,0);assert.ok(rows[0].unsubscribed_at);assert.equal(rows[0].interest,'building tools');
});
test('rejects bad email, long interest, invalid handle, oversized and cross-origin requests',async()=>{
 for(const payload of [{email:'bad'}, {email:'ok@example.com',interest:'a'.repeat(201)},{email:'ok@example.com',handle:'not a handle'}]) assert.equal((await context.route(request(payload),fixture().env)).status,400);
 assert.equal((await context.route(request({email:'ok@example.com',interest:'x'.repeat(5000)}),fixture().env)).status,413);
 assert.equal((await context.route(request({email:'ok@example.com'},{Origin:'https://evil.example'}),fixture().env)).status,403);
});
test('honeypot stores nothing; rate limit uses IP and blocks after five attempts',async()=>{
 const {rows,env}=fixture();assert.equal((await context.route(request({website:'spam'}),env)).status,200);assert.equal(rows.length,0);
 for(let i=0;i<5;i++) assert.equal((await context.route(request({email:'bad'}),env)).status,400);
 assert.equal((await context.route(request({email:'ok@example.com'}),env)).status,429);assert.equal(rows.length,0);
});
test('CSV requires bearer secret, escapes formulas, includes opt-outs and unsubscribe links',async()=>{
 const {env}=fixture();await context.route(request({email:'ok@example.com',interest:'=SUM(A1)',handle:'builder',public_opt_in:true}),env);
 assert.equal((await context.route(new Request('https://example.com/admin/signups.csv'),env)).status,401);
 const res=await context.route(new Request('https://example.com/admin/signups.csv',{headers:{Authorization:'Bearer test-admin'}}),env);assert.equal(res.status,200);
 const csv=await res.text();assert.match(csv,/'=SUM\(A1\)/);assert.match(csv,/unsubscribe\?t=/);assert.equal(res.headers.get('Cache-Control'),'no-store');
});

test('query prefills only known own keys, ignores arbitrary and inherited properties',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const snippet=html.slice(html.indexOf('const signupInterestLabels ='),html.indexOf("const signupDialog ="));
 for(const [key,expected] of Object.entries({'unlinked':'Unlinked','superconnector':'Superconnector','openchat':'OpenChat','ideaflow-index':'Ideaflow apps index','open-recordings':'Open Recordings','bookshelves':'Bookshelves','unknown':'','<script>':'','constructor':'','__proto__':'','toString':''}).concat([['__proto__','']])) {
  const field={value:''};vm.runInNewContext(snippet,{URLSearchParams,location:{search:'?interest='+encodeURIComponent(key)},document:{getElementById:()=>field}});assert.equal(field.value,expected,key);
 }
});

test('email-only then details stores X consent; retry email preserves details and opted-out status',async()=>{
 const {rows,env}=fixture();
 for(const data of [{email:'step@example.com'},{email:'step@example.com',interest:'building',handle:'@builder',public_opt_in:true},{email:'step@example.com'}]) {
  const response=await context.route(request(data),env);assert.equal(await response.text(),'{"ok":true}');
 }
 assert.equal(rows.length,1);assert.equal(rows[0].interest,'building');assert.equal(rows[0].handle,'builder');assert.equal(rows[0].public_opt_in,1);
 rows[0].unsubscribed_at='2020-01-01';
 await context.route(request({email:'step@example.com',interest:'updated',handle:'',public_opt_in:false}),env);
 assert.equal(rows[0].unsubscribed_at,'2020-01-01');assert.equal(rows[0].handle,'');assert.equal(rows[0].public_opt_in,0);
});

test('handle-only and publicity-only patches respect independent presence and require an effective handle',async()=>{
 const {rows,env}=fixture();
 for(const data of [{email:'patch@example.com',handle:'builder',public_opt_in:true},{email:'patch@example.com',handle:'newhandle'}]) await context.route(request(data),env);
 assert.equal(rows[0].handle,'newhandle');assert.equal(rows[0].public_opt_in,1);
 await context.route(request({email:'patch@example.com',public_opt_in:false}),env);assert.equal(rows[0].public_opt_in,0);assert.equal(rows[0].handle,'newhandle');
 await context.route(request({email:'patch@example.com',public_opt_in:true}),env);assert.equal(rows[0].public_opt_in,1);
 await context.route(request({email:'patch@example.com',handle:''}),env);assert.equal(rows[0].public_opt_in,0);
 const empty=fixture();await context.route(request({email:'empty@example.com',public_opt_in:true}),empty.env);assert.equal(empty.rows[0].public_opt_in,0);
 await context.route(request({email:'empty@example.com',public_opt_in:true}),empty.env);assert.equal(empty.rows[0].public_opt_in,0);
});

test('omitted, empty, whitespace and replacement interests preserve the first nonempty value',async()=>{
 for(const data of [{},{interest:''},{interest:'   '},{interest:'replacement'}]) {
  const {rows,env}=fixture();await context.route(request({email:'keep@example.com',interest:'first interest'}),env);
  const token=rows[0].unsubscribe_token;rows[0].consent_at='2000-01-01';
  const response=await context.route(request({email:'keep@example.com',...data}),env);
  assert.equal(await response.text(),'{"ok":true}');assert.equal(rows[0].interest,'first interest');assert.equal(rows[0].unsubscribe_token,token);assert.notEqual(rows[0].consent_at,'2000-01-01');
 }
 const empty=fixture();await context.route(request({email:'fill@example.com',interest:'  '}),empty.env);
 await context.route(request({email:'fill@example.com',interest:'  first useful interest  '}),empty.env);
 assert.equal(empty.rows[0].interest,'first useful interest');
});
