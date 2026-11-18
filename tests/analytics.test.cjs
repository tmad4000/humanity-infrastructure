const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function load(dnt='0') {
  const callbacks={}, calls=[];
  const context={URL,URLSearchParams,Set,Math,location:{origin:'https://humanityinfrastructure.com',hostname:'humanityinfrastructure.com'},navigator:{doNotTrack:dnt},performance:{now:()=>100},document:{addEventListener:(name,fn)=>callbacks[name]=fn},window:{}};
  vm.runInNewContext(fs.readFileSync('analytics.js','utf8'),context);
  context.window.ideaflow={track:(...args)=>calls.push(args)};
  return {...context,callbacks,calls};
}
test('payload strips arbitrary query, fragments, referrer paths and titles; retains agreed acquisition tags',()=>{
 const c=load(); const payload={url:'/?email=private%40example.com&interest=secret&utm_source=x&utm_medium=social&utm_campaign=hi_launch_202611&utm_content=reply_kevinrose_01#private',referrer:'https://example.org/private?token=secret',title:'private title'};
 const out=c.window.hiAnalyticsBeforeSend('event',payload);
 assert.equal(out.url,'/?utm_source=x&utm_medium=social&utm_campaign=hi_launch_202611&utm_content=reply_kevinrose_01');
 assert.equal(out.referrer,'https://example.org');assert.equal(out.title,'Humanity Infrastructure');
 assert.equal(c.window.hiAnalyticsBeforeSend('event',{url:'/unknown-secret?ref=email',referrer:''}).url,'/other');
});
test('DNT and unregistered preview hosts suppress all payloads',()=>{
 assert.equal(load('1').window.hiAnalyticsBeforeSend('event',{}),null);
 const c=load();c.location.hostname='preview.workers.dev';assert.equal(c.window.hiAnalyticsBeforeSend('event',{}),null);
});
test('early interactions queue without predefining wrapper, then flush once',()=>{
 const c=load();delete c.window.ideaflow;c.window.hiTrack('github_click',{placement:'header'});assert.equal(c.window.ideaflow,undefined);
 c.window.ideaflow={track:(...args)=>c.calls.push(args)};c.callbacks.DOMContentLoaded();c.callbacks.DOMContentLoaded();assert.equal(c.calls.length,1);
});

test('feature-owned interest links do not produce a second generic outbound event',()=>{
 const c=load();
 const link={closest:selector=>selector==='#signal-thanks, #letter-context-links'?{}:null};
 c.callbacks.click({target:{closest:()=>link}});
 assert.equal(c.calls.length,0);
 c.window.hiTrack('interest_tweet_intent',{item_key:'lastbook',placement:'tool_card'});
 assert.equal(c.calls.length,1);
 assert.equal(c.calls[0][0],'interest_tweet_intent');
 assert.deepEqual(c.calls[0][1],{item_key:'lastbook',placement:'tool_card'});
});

test('join journey retains only fixed path and approved attribution, never quest free text or hash',()=>{
 const c=load();
 const payload=c.window.hiAnalyticsBeforeSend('event',{url:'/join?quest=private-user-text&email=person%40example.com&utm_source=x#private-context',referrer:'https://humanityinfrastructure.com/join?quest=private-referrer'});
 assert.equal(payload.url,'/join?utm_source=x');
 assert.equal(payload.referrer,'https://humanityinfrastructure.com');
 assert.ok(!JSON.stringify(payload).includes('private'));
 assert.ok(!JSON.stringify(payload).includes('person'));
});

test('tweet-card X link is an X event without listing ID; SignuDoc stays a resource',()=>{
 const c=load();
 function click(href,id,tweet){
  const link={href,dataset:{},matches:()=>false,closest:selector=>selector==='.tweet-card'?(tweet?{}:null):selector==='.card[id]'?{id}:null};
  c.callbacks.click({target:{closest:()=>link}});
 }
 click('https://x.com/jacobcole4000/status/123','lastbook-conversation',true);
 assert.equal(c.calls[0][0],'x_outbound_click');
 assert.equal(c.calls[0][1].destination_host,'x.com');
 assert.equal(Object.hasOwn(c.calls[0][1],'listing_id'),false);
 click('https://github.com/NYLLON-SOFTWARE/SignuDoc','signudoc',false);
 assert.equal(c.calls[1][0],'resource_outbound_click');
 assert.equal(c.calls[1][1].listing_id,'signudoc');
});

test('async wrapper arriving after DOMContentLoaded still receives queued events exactly once',()=>{
 const c=load(); delete c.window.ideaflow;
 c.window.hiTrack('github_click',{placement:'header'});
 c.callbacks.DOMContentLoaded(); // wrapper not loaded yet: events stay queued
 assert.equal(c.calls.length,0);
 c.window.ideaflow={track:(...args)=>c.calls.push(args)}; // async wrapper finishes loading
 c.window.hiAnalyticsFlush(); c.window.hiAnalyticsFlush();
 assert.equal(c.calls.length,1); assert.equal(c.calls[0][0],'github_click');
});

test('shared analytics wrapper loads async on every page so a stalled host never blocks deferred feature scripts',()=>{
 for (const f of ['index.html','classic.html','v2.html','v3.html','versions/v4/index.html']) {
  const html=fs.readFileSync(f,'utf8');
  const tag=html.match(/<script[^>]*src="https:\/\/analytics\.ideaflow\.app\/ideaflow\.js"[^>]*>/);
  assert.ok(tag,f+': wrapper tag present');
  assert.match(tag[0],/\basync\b/,f+': async'); assert.doesNotMatch(tag[0],/\bdefer\b/,f+': not defer');
  assert.match(tag[0],/onload="window\.hiAnalyticsFlush && window\.hiAnalyticsFlush\(\)"/,f+': flush on load');
 }
});
