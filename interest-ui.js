(() => {
  const items = __INTEREST_ITEMS__, storageKey = 'hi-item-likes-v1';
  const placement = key => key.startsWith('quest-') ? 'quest_card' : key.startsWith('build-') ? 'build_list' : 'tool_card';
  function trackSignal(name, signal){try{if(typeof window.hiTrack==='function')window.hiTrack(name,{item_key:signal.item_key,placement:placement(signal.item_key)});}catch{/* Analytics never blocks a signal. */}}
  function liked(key){try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');return Object.hasOwn(saved,key) && saved[key]===Math.floor(Date.now()/86400000);}catch{return false;}}
  function rememberLike(key){try{const day=Math.floor(Date.now()/86400000),old=JSON.parse(localStorage.getItem(storageKey)||'{}');const saved=Object.fromEntries(Object.entries(old).filter(([key,value])=>Object.hasOwn(items,key) && value===day));saved[key]=day;localStorage.setItem(storageKey,JSON.stringify(saved));}catch{/* Server-side daily dedup remains active when storage is unavailable. */}}
  let counts = {}, selected = null, trigger = null, busy = false, followedHash = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'letter signal-dialog';
  dialog.setAttribute('aria-labelledby','signal-title');dialog.setAttribute('aria-describedby','signal-description');
  dialog.innerHTML = `<button class="close" type="button" aria-label="Close interest form" data-signal-close>×</button>
    <h2 id="signal-title"></h2><p id="signal-description"></p>
    <form id="signal-form">
      <label for="signal-email">Email (optional)</label><input id="signal-email" name="email" type="email" maxlength="254" autocomplete="email">
      <label class="consent"><input type="checkbox" name="letter_opt_in"> Send me the occasional letter by email</label>
      <label for="signal-handle">X handle (optional, private)</label><input id="signal-handle" name="handle" maxlength="16" autocomplete="off" placeholder="@yourhandle">
      <small>Email and handles stay private. No handles are published in this version. One signal per item per day; you can leave all fields blank.</small>
      <div class="trap" aria-hidden="true"><label for="signal-website">Website</label><input id="signal-website" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="actions"><button type="submit" class="btn primary">Send signal</button></div>
    </form>
    <div id="signal-thanks" hidden><p id="signal-summary"></p><div class="actions"><a class="btn primary" id="signal-tweet" target="_blank" rel="noopener noreferrer">Tweet that you want this</a><button class="btn ghost" type="button" id="signal-updates">Get updates by email</button></div><small>You choose whether to post on X. Nothing is posted automatically.</small></div>
    <div class="status" role="status" aria-live="polite"></div>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'), thanks=dialog.querySelector('#signal-thanks'), status=dialog.querySelector('.status');
  function showCounts(){
    document.querySelectorAll('[data-interest-count]').forEach(el=>{const count=counts[el.dataset.interestCount],text=count>=3?count+' want signals':'Be the first';if(el.textContent!==text)el.textContent=text;});
    document.querySelectorAll('[data-signal-kind="want"]').forEach(button=>{const saved=liked(button.dataset.signalItem),text=saved?'♥ Liked':'♥ Like';if(button.textContent!==text)button.textContent=text;button.setAttribute('aria-pressed',String(saved));});
  }
  async function loadCounts(){try{const response=await fetch('/api/interest/counts');if(response.ok){counts=(await response.json()).counts || {};showCounts();}}catch{/* Signals remain usable without counts. */}}
  function mount(){
    document.querySelectorAll('[data-interest-item], .card[id]').forEach(card=>{
      const key=card.dataset.interestItem || card.id;if(!Object.hasOwn(items,key) || card.querySelector('.signal-actions'))return;
      const actions=document.createElement('div');actions.className='signal-actions';
      for(const [kind,label] of [['want','♥ Like'],['building',"I'm building this"]]){const button=document.createElement('button');button.type='button';button.className='btn ghost';button.dataset.signalKind=kind;button.dataset.signalItem=key;button.textContent=label;button.setAttribute('aria-label',label+': '+items[key]);actions.append(button);}
      const count=document.createElement('span');count.className='signal-count';count.dataset.interestCount=key;actions.append(count);
      const feedback=document.createElement('span');feedback.className='signal-count';feedback.dataset.signalFeedback=key;feedback.setAttribute('role','status');actions.append(feedback);let host=card.querySelector(':scope > .resource-actions');if(!host){host=document.createElement('div');host.className='resource-actions';card.append(host);}host.append(actions);
    });showCounts();
    if(!followedHash){let key='';try{key=decodeURIComponent(location.hash.slice(1));}catch{}if(Object.hasOwn(items,key)){const card=document.getElementById(key);if(card){card.scrollIntoView({block:'start'});followedHash=true;}}}
  }
  function tweetLink(signal){
    const share=new URL('https://humanityinfrastructure.com/');share.searchParams.set('ref','x-interest');share.hash=signal.item_key;
    const count=counts[signal.item_key],text='I want '+items[signal.item_key]+'.'+(count>=3?' '+count+' interest signals so far.':'')+' Who is building it?';
    const intent=new URL('https://twitter.com/intent/tweet');intent.searchParams.set('text',text);intent.searchParams.set('url',share.href);return intent.href;
  }
  async function postSignal(signal,extra={}){
    const response=await fetch('/api/interest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...signal,...extra})});
    const data=await response.json();if(!response.ok || data.ok!==true)throw Error(data.error || 'Please try again later.');
    trackSignal(signal.kind==='building'?'interest_building':'interest_want',signal);return data;
  }
  function emailPopup(signal,card){
    const links=[{label:'Tweet that you want this',href:tweetLink(signal),onClick:()=>trackSignal('interest_tweet_intent',signal)}];
    if(card?.dataset.questUrl)links.unshift({label:'View this quest on World Issue Tracker ↗',href:card.dataset.questUrl});
    if(typeof openSignupWithInterest==='function')openSignupWithInterest(items[signal.item_key],'Updates for '+items[signal.item_key]+'. Email is optional; close this window to skip.',links);
  }
  async function itemLike(button,key){
    const signal={item_key:key,kind:'want'},card=button.closest('[data-interest-item],.card'),feedback=button.parentElement.querySelector('[data-signal-feedback]');
    if(liked(key)){button.focus();emailPopup(signal,card);return;}
    busy=true;button.disabled=true;feedback.textContent='Saving…';
    try{await postSignal(signal,{website:''});rememberLike(key);await loadCounts();showCounts();feedback.textContent='Liked. Email updates are optional.';button.disabled=false;button.focus();emailPopup(signal,card);}
    catch(error){feedback.textContent=error.message || 'Could not connect. Please try again.';}
    finally{busy=false;button.disabled=false;}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-signal-kind]');if(!button || busy || dialog.open)return;
    const key=button.dataset.signalItem;if(!Object.hasOwn(items,key))return;
    if(button.dataset.signalKind==='want'){itemLike(button,key);return;}
    selected={item_key:key,kind:button.dataset.signalKind};trigger=button;form.reset();form.hidden=false;thanks.hidden=true;status.textContent='';
    dialog.querySelector('#signal-title').textContent=(selected.kind==='want'?'I want this: ':"I'm building this: ")+items[key];
    dialog.querySelector('#signal-description').textContent=selected.kind==='building'?'Tell the maintainer privately. Your builder signal is not included in public counts.':'Add your interest signal. Contact details are optional.';
    dialog.showModal();form.elements.email.focus();
  });
  dialog.querySelector('[data-signal-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;const fields=[...dialog.querySelectorAll('button,input,a[href]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getClientRects().length && !el.closest('[hidden],.trap'));
    const first=fields[0],last=fields[fields.length-1];if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
  });
  dialog.querySelector('#signal-updates').addEventListener('click',()=>{const submitted={...selected};dialog.close();setTimeout(()=>emailPopup(submitted),0);});
  dialog.querySelector('#signal-tweet').addEventListener('click',()=>{if(selected)trackSignal('interest_tweet_intent',selected);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !selected || !form.reportValidity())return;busy=true;
    const submitted={...selected},button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='Saving…';
    const utm={},params=new URLSearchParams(location.search);for(const key of ['source','medium','campaign','term','content'])if(params.has('utm_'+key))utm['utm_'+key]=params.get('utm_'+key);
    try{
      await postSignal(submitted,{email:form.elements.email.value,handle:form.elements.handle.value,letter_opt_in:form.elements.letter_opt_in.checked,website:form.elements.website.value,source_page:location.pathname,utm,referrer:document.referrer});
      await loadCounts();form.hidden=true;thanks.hidden=false;status.textContent='';const count=counts[submitted.item_key];
      dialog.querySelector('#signal-summary').textContent=submitted.kind==='building'?'Thanks. Builder signals are private; only the first signal for each item each day is saved.':'Thanks for your interest.'+(count>=3?' '+count+' want signals so far.':'');
      dialog.querySelector('#signal-tweet').href=tweetLink(submitted);if(dialog.open)dialog.querySelector('#signal-tweet').focus();
    }catch(error){status.textContent=error.message || 'Could not connect. Please try again.';}finally{busy=false;button.disabled=false;}
  });
  mount();const observer=new MutationObserver(mount);for(const node of [document.getElementById('buildgrid'),document.getElementById('witgrid')])if(node)observer.observe(node,{childList:true,subtree:true});loadCounts();
})();
