// Browser-only preview verification; fetch is stubbed before form interaction.
// No signup, subscriber or credential reads/writes. Chrome sandbox stays enabled.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const origin = process.argv[2];
if (!origin) throw Error('Usage: node scripts/test-signup-modal.cjs <preview-origin>');
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
    await send('Page.navigate',{url:origin+'/?interest=openchat#letter'},sid);
    for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('#letter-dialog[open]')"))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await evaluate("document.activeElement.id"),'letter-email');
    assert.equal(await evaluate("document.getElementById('letter-interest').value"),'OpenChat');
    assert.equal(await evaluate("document.getElementById('letter-details-step').hidden"),true);
    assert.equal(await evaluate("document.getElementById('letter-form').elements.public_opt_in.checked"),false);
    assert.equal(await evaluate("document.querySelectorAll('[data-signup-open]').length"),2);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"),false);
    assert.equal(await evaluate("document.getElementById('letter-dialog').getBoundingClientRect().width <= innerWidth"),true);
    await evaluate("document.querySelector('#letter-email-step button').focus()");await key('Tab');
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'Close signup');
    await key('Tab',true);assert.equal(await evaluate("document.activeElement.textContent"),'Submit');
    await key('Escape');assert.equal(await evaluate("document.getElementById('letter-dialog').open"),false);
    await evaluate("document.querySelector('[data-signup-open]').focus();document.querySelector('[data-signup-open]').click()");
    await evaluate("window.signupRequests=[];window.signupFail=true;window.fetch=async (url,options)=>{signupRequests.push({url,...JSON.parse(options.body)});if(signupFail){signupFail=false;return {ok:false,json:async()=>({error:'Please retry.'})}}return {ok:true,json:async()=>({ok:true})}};document.getElementById('letter-email').value='modal-test@example.com';document.getElementById('letter-form').requestSubmit()");
    await new Promise(r=>setTimeout(r,50));
    assert.equal(await evaluate("document.querySelector('#letter-form .status').textContent"),'Please retry.');
    assert.equal(await evaluate("document.getElementById('letter-details-step').hidden"),true);
    await evaluate("document.getElementById('letter-form').requestSubmit()");await new Promise(r=>setTimeout(r,50));
    assert.equal(await evaluate("document.getElementById('letter-email-step').hidden"),true);
    assert.equal(await evaluate("document.activeElement.id"),'letter-interest');
    assert.equal(await evaluate("document.getElementById('letter-title').textContent"),'Thanks! Optionally, tell us what you’re interested in');
    assert.equal(await evaluate("Object.hasOwn(signupRequests[1],'interest')"),false);
    const screenshot=await send('Page.captureScreenshot',{format:'png'},sid);
    fs.writeFileSync('/tmp/hi-signup-modal-mobile.png',Buffer.from(screenshot.result.data,'base64'));
    await evaluate("document.getElementById('letter-handle').value='@builder';document.getElementById('letter-form').elements.public_opt_in.checked=true;document.getElementById('letter-form').requestSubmit()");await new Promise(r=>setTimeout(r,50));
    assert.equal(await evaluate("document.getElementById('letter-dialog').open"),false);
    const requests=await evaluate('signupRequests');assert.equal(requests.length,3);assert.equal(requests[2].email,requests[1].email);assert.equal(requests[2].interest,'OpenChat');assert.equal(requests[2].handle,'@builder');assert.equal(requests[2].public_opt_in,true);assert.equal(requests[2].url,'/api/signup');assert.equal(requests[2].website,'');
    assert.equal(await evaluate("document.activeElement.hasAttribute('data-signup-open')"),true);
    await evaluate("document.querySelector('[data-signup-open]').click();document.querySelector('#letter-details-step [data-signup-close]').click()");
    assert.equal(await evaluate('signupRequests.length'),3);assert.equal(await evaluate("document.getElementById('letter-dialog').open"),false);
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},sid);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"),false);
    console.log('PASS mobile/desktop: email-only, labels, focus trap, Escape, restore focus, retry, optional details/prefill, same-email uniform API, Save and Skip; no real submissions');
  } finally {
    try {await send('Browser.close');} catch {} child.kill();
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
