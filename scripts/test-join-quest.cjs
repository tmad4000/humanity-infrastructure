// Browser-only preview verification; fetch is stubbed before form interaction.
// No signup, subscriber or credential reads/writes. Chrome sandbox stays enabled.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const origin = process.argv[2];
if (!origin) throw Error('Usage: node scripts/test-join-quest.cjs <preview-origin>');
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
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sid);
    async function open(route){await send('Page.navigate',{url:origin+route},sid);for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('#letter-dialog[open]')"))return;await new Promise(r=>setTimeout(r,50));}throw Error('Join modal did not open');}
    await open('/join');assert.equal(await evaluate('document.activeElement.id'),'letter-email');assert.equal(await evaluate("document.getElementById('letter-interest').value"),'I want to join World Quest Guild');assert.match(await evaluate("document.getElementById('letter-description').textContent"),/World Quest Guild welcomes/);
    await open('/join?quest=open-document-signing');assert.equal(await evaluate("document.getElementById('letter-interest').value"),'I want to join the quest: open document signing');
    await evaluate("window.joinRequests=[];window.fetch=async(url,options)=>{if(url==='/api/signup'){joinRequests.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})}}return {ok:true,json:async()=>({counts:{}})}};document.getElementById('letter-email').value='join-test@example.com';document.getElementById('letter-form').requestSubmit()");await new Promise(r=>setTimeout(r,100));
    const payload=await evaluate('joinRequests[0]');assert.equal(payload.interest,'I want to join the quest: open document signing');assert.equal(payload.source_page,'/join');assert.equal(payload.email,'join-test@example.com');
    assert.equal(await evaluate("document.getElementById('letter-details-step').hidden"),false);await evaluate("document.querySelector('[data-signup-skip]').click()");assert.equal(await evaluate("document.getElementById('letter-dialog').open"),false);
    await open('/?interest=world-quest-guild&quest=best-in-class-tool-registry#letter');assert.equal(await evaluate("document.getElementById('letter-interest').value"),'I want to join the quest: best in class tool registry');
    await open('/join?quest='+encodeURIComponent('<img src=x onerror=alert(1)> '+ 'a'.repeat(500)));
    const safe=await evaluate("document.getElementById('letter-interest').value");assert.doesNotMatch(safe,/[<>]/);assert.ok(safe.length<=200);assert.equal(await evaluate("document.getElementById('letter-description').children.length"),0);assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"),false);
    await evaluate("openSignupWithInterest('safe','safe',[{label:'bad',href:'javascript:alert(1)'},{label:'bad',href:'https://evil.example/'}])");assert.equal(await evaluate("document.getElementById('letter-context-links').children.length"),0);
    const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('/tmp/hi-join-quest-mobile.png',Buffer.from(shot.result.data,'base64'));
    console.log('PASS Join-a-Quest: generic and two URL forms, sanitized/capped text-only context, first email includes intent even on Skip, malicious text/link safety and mobile; signup fetch stubbed');
  } finally {
    try {await send('Browser.close');} catch {}
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>child.kill(),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    await new Promise(resolve=>setTimeout(resolve,200));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
