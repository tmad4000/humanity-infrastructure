// Private interest signals. The generated INTEREST_ITEMS catalogue is the only allowlist.
async function handleInterest(request, env) {
  const url = new URL(request.url);
  if (!['/api/interest', '/api/interest/counts', '/admin/interest.csv'].includes(url.pathname)) return null;
  try {
    if (url.pathname === '/api/interest/counts') {
      if (request.method !== 'GET') return signupResponse({error:'Method not allowed'},405);
      const rows = await env.SIGNUPS.prepare("SELECT item_key, COUNT(*) AS total FROM interest_signals WHERE kind = 'want' GROUP BY item_key HAVING COUNT(*) >= 3").all();
      return signupResponse({counts:Object.fromEntries(rows.results.filter(row => Object.hasOwn(INTEREST_ITEMS,row.item_key)).map(row => [row.item_key,row.total]))});
    }
    if (url.pathname === '/admin/interest.csv') {
      if (request.method !== 'GET') return signupResponse({error:'Method not allowed'},405);
      if (!env.ADMIN_EXPORT_TOKEN || await signupHash(request.headers.get('Authorization') || '') !== await signupHash('Bearer '+env.ADMIN_EXPORT_TOKEN)) return signupResponse({error:'Unauthorized'},401);
      const rows = await env.SIGNUPS.prepare('SELECT id,item_key,kind,email,handle,letter_opt_in,consent_at,source_page,utm,referrer FROM interest_signals ORDER BY consent_at').all();
      const totals = await env.SIGNUPS.prepare("SELECT item_key, COUNT(*) AS total FROM interest_signals WHERE kind = 'want' GROUP BY item_key").all();
      const counts = Object.fromEntries(totals.results.map(row => [row.item_key,row.total]));
      const columns = ['id','item_key','kind','email','handle','letter_opt_in','consent_at','source_page','utm','referrer','want_signals','milestone','tweet_draft'];
      const csv = [columns.join(','),...rows.results.map(row => {
        const count = counts[row.item_key] || 0, milestone = [100,50,25,10].find(n => count >= n) || '';
        const entry = {...row,want_signals:count,milestone,tweet_draft:milestone ? count+' interest signals for '+INTEREST_ITEMS[row.item_key]+'. Who is building it? https://humanityinfrastructure.com/?ref=x-interest#'+row.item_key : ''};
        return columns.map(key => signupCsv(entry[key])).join(',');
      })].join('\r\n');
      return new Response(csv,{headers:{...PRIVATE_HEADERS,'Content-Type':'text/csv;charset=UTF-8','Content-Disposition':'attachment; filename="hi-interest.csv"'}});
    }
    if (request.method !== 'POST') return signupResponse({error:'Method not allowed'},405);
    if (request.headers.get('Origin') !== url.origin) return signupResponse({error:'Please send your signal from this site.'},403);
    if (!env.SIGNUPS || !env.RATE_LIMIT_SALT) return signupResponse({error:'Interest signals temporarily unavailable.'},503);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return signupResponse({error:'Expected JSON'},415);
    if (Number(request.headers.get('Content-Length')) > 4096) return signupResponse({error:'Submission too large'},413);
    const reader=request.body?.getReader();if(!reader)return signupResponse({error:'Empty submission'},400);
    let size=0;const chunks=[];
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return signupResponse({error:'Submission too large'},413);}chunks.push(value);}
    let data;try{data=JSON.parse(await new Blob(chunks).text());}catch{return signupResponse({error:'Invalid submission'},400);}
    if(!data || typeof data!=='object' || Array.isArray(data))return signupResponse({error:'Invalid submission'},400);
    if(data.website)return signupResponse({ok:true});
    const ip=request.headers.get('CF-Connecting-IP');if(!ip)return signupResponse({error:'Interest signals temporarily unavailable.'},503);
    const hash=await signupHash(env.RATE_LIMIT_SALT+':'+ip), hour=Math.floor(Date.now()/3600000), day=Math.floor(Date.now()/86400000);
    // Same atomic table/key and five-attempt budget as /api/signup.
    const rate=await env.SIGNUPS.prepare('INSERT INTO signup_rate_limits (ip_hash, window, attempts) VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window = excluded.window THEN attempts + 1 ELSE 1 END, window = excluded.window RETURNING attempts').bind(hash,hour).first();
    if(rate.attempts>5)return signupResponse({error:'Too many attempts. Please try again in an hour.'},429,{'Retry-After':'3600'});
    await env.SIGNUPS.prepare('DELETE FROM signup_rate_limits WHERE window < ?').bind(hour-24).run();
    if(typeof data.item_key!=='string' || !Object.hasOwn(INTEREST_ITEMS,data.item_key) || !['want','building'].includes(data.kind))return signupResponse({error:'Choose a listed item and signal type.'},400);
    const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
    const handle=typeof data.handle==='string'?data.handle.trim().replace(/^@/,''):'';
    if(email && (email.length>254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)))return signupResponse({error:'Please enter a valid email address or leave it blank.'},400);
    if(handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle))return signupResponse({error:'Please enter a valid X handle or leave it blank.'},400);
    const optIn=data.letter_opt_in===true;
    if(optIn && !email)return signupResponse({error:'Enter an email for updates, or leave updates unchecked.'},400);
    const source=typeof data.source_page==='string'?data.source_page.slice(0,300):'/';
    const utm=JSON.stringify(Object.fromEntries(Object.entries(data.utm || {}).filter(([key,value])=>/^utm_(source|medium|campaign|term|content)$/.test(key) && typeof value==='string').map(([key,value])=>[key,value.slice(0,200)])));
    const referrer=typeof data.referrer==='string'?data.referrer.slice(0,500):'', now=new Date().toISOString();
    // First signal wins across both kinds for this item/IP/UTC day. Never disclose duplicates.
    const statements=[env.SIGNUPS.prepare('INSERT INTO interest_signals (id,item_key,kind,ip_hash,day,email,handle,letter_opt_in,consent_at,source_page,utm,referrer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_key,ip_hash,day) DO NOTHING').bind(crypto.randomUUID(),data.item_key,data.kind,hash,day,email,handle,optIn?1:0,now,source,utm,referrer)];
    if(optIn){
      const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
      // Explicit letter consent only; never re-enable an unsubscribed email or replace saved details.
      statements.push(env.SIGNUPS.prepare('INSERT INTO signups (id,email,interest,handle,public_opt_in,consent_at,source_page,utm,referrer,unsubscribe_token) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET consent_at = excluded.consent_at').bind(crypto.randomUUID(),email,INTEREST_ITEMS[data.item_key],handle,0,now,source,utm,referrer,token));
    }
    await env.SIGNUPS.batch(statements);
    return signupResponse({ok:true});
  } catch {return signupResponse({error:'Interest signals temporarily unavailable. Please try again later.'},503);}
}
