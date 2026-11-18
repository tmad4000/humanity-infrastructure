// Browser-only preview verification; fetch is stubbed before form interaction.
// No signup, subscriber or credential reads/writes. Chrome sandbox stays enabled.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const origin = process.argv[2];
if (!origin) throw Error('Usage: node scripts/test-interest-ui.cjs <preview-origin>');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-modal-browser-'));
  const child = spawn(process.env.CHROME_BIN || '/opt/google/chrome/chrome', ['--headless','--disable-gpu','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'], {stdio:['ignore','ignore','ignore','pipe','pipe']});
  let id=0, buffer='', pending=new Map();
  child.stdio[4].on('data', data => {buffer+=data.toString();let i;while((i=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}});
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},15000);pending.set(n,m=>{clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m);});child.stdio[3].write(JSON.stringify({id:n,method,params,sessionId})+'\0');});}
  let sid;
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.text);return r.result.result.value;}
  async function key(key,shift=false){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='Escape'?27:9,modifiers:shift?8:0},sid);}
  try {
    const t=await send('Target.createTarget',{url:'about:blank'});sid=(await send('Target.attachToTarget',{targetId:t.result.targetId,flatten:true})).result.sessionId;
    const items=JSON.parse(fs.readFileSync('interest-items.json','utf8')),quest=Object.keys(items).find(key=>key.startsWith('quest-'));
    const stub=`window.signalRequests=[];window.signalFail=false;const realFetch=window.fetch;window.fetch=async(url,options)=>{if(url==='/api/interest/counts')return {ok:true,json:async()=>({counts:{lastbook:signalRequests.length?3:2,signudoc:3}})};if(url==='/api/interest'){signalRequests.push(JSON.parse(options.body));if(signalFail){signalFail=false;return {ok:false,json:async()=>({error:'Too many attempts. Please try again in an hour.'})}}return {ok:true,json:async()=>({ok:true})}}if(String(url).includes('get-issues'))return {json:async()=>({issues:[{slug:${JSON.stringify(quest.slice(6))},title:${JSON.stringify(items[quest])},description:'Browser fixture',status:'open',votes:0}]})};return realFetch(url,options);};`;
    await send('Page.enable',{},sid);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:stub},sid);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sid);
    await send('Page.navigate',{url:origin+'/?utm_source=ui-test'},sid);
    for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('#lastbook [data-signal-kind]')"))break;await new Promise(r=>setTimeout(r,50));}
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await evaluate("document.querySelector('#lastbook [data-interest-count]').textContent"),'Be the first');
    assert.equal(await evaluate("document.querySelector('#signudoc [data-interest-count]').textContent"),'3 want signals');
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"),false);
    assert.equal(await evaluate("document.querySelectorAll('a [data-signal-kind]').length"),0);
    await evaluate("document.querySelector('#lastbook [data-signal-kind=want]').click()");
    assert.equal(await evaluate('document.activeElement.id'),'signal-email');
    assert.equal(await evaluate("document.querySelector('#signal-form').elements.letter_opt_in.checked"),false);
    await evaluate("document.getElementById('signal-form').requestSubmit()");await new Promise(r=>setTimeout(r,100));
    assert.equal(await evaluate("document.getElementById('signal-thanks').hidden"),false);
    const anonymous=await evaluate('signalRequests[0]');assert.equal(anonymous.item_key,'lastbook');assert.equal(anonymous.kind,'want');assert.equal(anonymous.email,'');assert.equal(anonymous.letter_opt_in,false);assert.equal(anonymous.utm.utm_source,'ui-test');
    const intent=new URL(await evaluate("document.getElementById('signal-tweet').href"));assert.equal(intent.hostname,'twitter.com');const shared=new URL(intent.searchParams.get('url'));assert.equal(shared.searchParams.get('ref'),'x-interest');assert.equal(shared.hash,'#lastbook');
    assert.equal(await evaluate("document.querySelector('#lastbook [data-interest-count]').textContent"),'3 want signals');
    await evaluate("document.getElementById('signal-updates').focus()");await key('Tab');assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'Close interest form');await key('Escape');
    await evaluate("document.querySelector('#paxi [data-signal-kind=building]').click();document.getElementById('signal-email').value='builder@example.com';document.getElementById('signal-handle').value='@maker';document.getElementById('signal-form').elements.letter_opt_in.checked=true;window.signalFail=true;document.getElementById('signal-form').requestSubmit()");await new Promise(r=>setTimeout(r,100));
    assert.match(await evaluate("document.querySelector('.signal-dialog .status').textContent"),/Too many attempts/);
    await evaluate("document.getElementById('signal-form').requestSubmit()");await new Promise(r=>setTimeout(r,100));
    assert.match(await evaluate("document.getElementById('signal-summary').textContent"),/private/);
    const builder=await evaluate('signalRequests[2]');assert.equal(builder.kind,'building');assert.equal(builder.email,'builder@example.com');assert.equal(builder.handle,'@maker');assert.equal(builder.letter_opt_in,true);assert.equal(Object.hasOwn(builder,'public_opt_in'),false);
    const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('/tmp/hi-interest-signal-mobile.png',Buffer.from(shot.result.data,'base64'));
    await evaluate("document.getElementById('signal-updates').click()");await new Promise(r=>setTimeout(r,100));
    assert.equal(await evaluate("document.getElementById('letter-dialog').open"),true);assert.equal(await evaluate('document.activeElement.id'),'letter-email');assert.equal(await evaluate("document.getElementById('letter-interest').value"),'Paxi');await key('Escape');
    await evaluate("document.querySelector('#filters [data-f=idea]').click()");await new Promise(r=>setTimeout(r,100));
    assert.equal(await evaluate("[...document.querySelectorAll('#buildgrid [data-interest-item]')].every(card=>card.querySelectorAll('[data-signal-kind]').length===2)"),true);
    assert.equal(await evaluate("document.querySelectorAll('#witgrid [data-signal-kind]').length"),2);
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},sid);assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"),false);
    assert.equal(await evaluate("!!document.querySelector('footer a[href=\"/classic\"]')"),true);
    console.log('PASS interest UI: every static/local/allowlisted-quest card, anonymous/contact flow, count threshold, private builders, retry, focus/Escape, tweet intent/referral, email-modal handoff, filters and mobile/desktop; fetch stubbed, no posts or subscriber writes');
  } finally {
    try {await send('Browser.close');} catch {}
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>child.kill(),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    await new Promise(resolve=>setTimeout(resolve,200));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
