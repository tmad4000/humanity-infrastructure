(() => {
  const items = __INTEREST_ITEMS__;
  let counts = {}, selected = null, trigger = null, busy = false, followedHash = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'letter signal-dialog';
  dialog.setAttribute('aria-labelledby','signal-title');
  dialog.setAttribute('aria-describedby','signal-description');
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
  function showCounts(){document.querySelectorAll('[data-interest-count]').forEach(el=>{const count=counts[el.dataset.interestCount];const text=count>=3?count+' want signals':'Be the first';if(el.textContent!==text)el.textContent=text;});}
  async function loadCounts(){try{const response=await fetch('/api/interest/counts');if(response.ok){counts=(await response.json()).counts || {};showCounts();}}catch{/* Signals remain usable without a count response. */}}
  function mount(){document.querySelectorAll('[data-interest-item]').forEach(card=>{
    const key=card.dataset.interestItem;if(!Object.hasOwn(items,key) || card.querySelector('.signal-actions'))return;
    const actions=document.createElement('div');actions.className='signal-actions';
    for(const [kind,label] of [['want','I want this'],['building',"I'm building this"]]){const button=document.createElement('button');button.type='button';button.className='btn ghost';button.dataset.signalKind=kind;button.dataset.signalItem=key;button.textContent=label;button.setAttribute('aria-label',label+': '+items[key]);actions.append(button);}
    const count=document.createElement('span');count.className='signal-count';count.dataset.interestCount=key;actions.append(count);card.append(actions);
  });showCounts();if(!followedHash){let key='';try{key=decodeURIComponent(location.hash.slice(1));}catch{}if(Object.hasOwn(items,key)){const card=document.getElementById(key);if(card){card.scrollIntoView({block:'start'});followedHash=true;}}}}
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-signal-kind]');if(!button || busy)return;
    const key=button.dataset.signalItem;if(!Object.hasOwn(items,key))return;
    selected={item_key:key,kind:button.dataset.signalKind};trigger=button;form.reset();form.hidden=false;thanks.hidden=true;status.textContent='';
    dialog.querySelector('#signal-title').textContent=(selected.kind==='want'?'I want this: ':"I'm building this: ")+items[key];
    dialog.querySelector('#signal-description').textContent=selected.kind==='building'?'Tell the maintainer privately. Your builder signal is not included in public counts.':'Add your interest signal. Contact details are optional.';
    dialog.showModal();form.elements.email.focus();
  });
  dialog.querySelector('[data-signal-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const fields=[...dialog.querySelectorAll('button,input,a[href]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getClientRects().length && !el.closest('[hidden],.trap'));
    const first=fields[0],last=fields[fields.length-1];
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
  });
  dialog.querySelector('#signal-updates').addEventListener('click',()=>{
    const label=items[selected.item_key];dialog.close();
    setTimeout(()=>{if(typeof finishSignup==='function')finishSignup();const field=document.getElementById('letter-interest');if(field)field.value=label;if(typeof openSignup==='function')openSignup();},0);
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !selected || !form.reportValidity())return;
    busy=true;const submitted={...selected},button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='Saving…';
    const utm={},params=new URLSearchParams(location.search);for(const key of ['source','medium','campaign','term','content'])if(params.has('utm_'+key))utm['utm_'+key]=params.get('utm_'+key);
    try{
      const response=await fetch('/api/interest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...submitted,email:form.elements.email.value,handle:form.elements.handle.value,letter_opt_in:form.elements.letter_opt_in.checked,website:form.elements.website.value,source_page:location.pathname,utm,referrer:document.referrer})});
      const data=await response.json();if(!response.ok)throw Error(data.error || 'Please try again later.');
      await loadCounts();form.hidden=true;thanks.hidden=false;status.textContent='';
      const count=counts[submitted.item_key];dialog.querySelector('#signal-summary').textContent=submitted.kind==='building'?'Thanks. Builder signals are private; only the first signal for each item each day is saved.':'Thanks for your interest.'+(count>=3?' '+count+' want signals so far.':'');
      const share=new URL('https://humanityinfrastructure.com/');share.searchParams.set('ref','x-interest');share.hash=submitted.item_key;
      const text='I want '+items[submitted.item_key]+'.'+(count>=3?' '+count+' interest signals so far.':'')+' Who is building it?';
      const intent=new URL('https://twitter.com/intent/tweet');intent.searchParams.set('text',text);intent.searchParams.set('url',share.href);
      dialog.querySelector('#signal-tweet').href=intent.href;
      if(dialog.open)dialog.querySelector('#signal-tweet').focus();
    }catch(error){status.textContent=error.message || 'Could not connect. Please try again.';}
    finally{busy=false;button.disabled=false;}
  });
  mount();const grid=document.getElementById('buildgrid'),quests=document.getElementById('witgrid');
  const observer=new MutationObserver(mount);for(const node of [grid,quests])if(node)observer.observe(node,{childList:true,subtree:true});
  loadCounts();
})();
