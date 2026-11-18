// Optional transactional mail. Disabled unless the owner binds both explicit gates.
// No delivery data, errors, contacts or tokens enter public signup responses/logs.
const WELCOME_SUBJECT = 'Thanks for signing up for the interest list';
const WELCOME_COPY = `Thanks for signing up for the Humanity Infrastructure interest list.

We'll send you a short, occasional letter about tools for human flourishing and the people building them.

Follow Jacob on X:
https://x.com/jacobcole4000

Explore the Ideaflow apps:
https://index.ideaflow.app

Build your own app in the Ideaflow ecosystem.
Own your mind. Own your networks.

You received this because you signed up at humanityinfrastructure.com.
Unsubscribe any time: {{unsubscribe_url}}

--
Humanity Infrastructure
https://humanityinfrastructure.com`;
function welcomeEnabled(env, ctx, origin) {
  return origin === 'https://humanityinfrastructure.com' && typeof ctx?.waitUntil === 'function' && env.WELCOME_EMAIL_ENABLED === 'true' && typeof env.HI_RESEND_API_KEY === 'string' && !!env.HI_RESEND_API_KEY;
}
function welcomeStatement(env, id) {
  // The randomly proposed ID matches only a newly inserted signup, never a duplicate.
  return env.SIGNUPS.prepare("INSERT INTO welcome_deliveries (signup_id,created_at,status,attempts) SELECT id,?,'pending',0 FROM signups WHERE id=? AND unsubscribed_at IS NULL ON CONFLICT(signup_id) DO NOTHING").bind(new Date().toISOString(),id);
}
function scheduleWelcome(env, ctx, id) {
  // Keep provider latency/failure off the public response path.
  try { ctx.waitUntil(deliverWelcome(env,id).catch(()=>{})); } catch { /* Optional mail never blocks signup. */ }
}
async function deliverWelcome(env,id) {
  // Two bounded attempts with the SAME provider idempotency key. A failure stays private.
  for(let attempt=0;attempt<2;attempt++) {
    const claimed=await env.SIGNUPS.prepare("UPDATE welcome_deliveries SET status='sending',attempts=attempts+1 WHERE signup_id=? AND status IN ('pending','retry') AND attempts<2 RETURNING signup_id").bind(id).first();
    if(!claimed)return;
    const row=await env.SIGNUPS.prepare('SELECT email,unsubscribe_token,unsubscribed_at FROM signups WHERE id=?').bind(id).first();
    if(!row || row.unsubscribed_at) {
      await env.SIGNUPS.prepare("UPDATE welcome_deliveries SET status='cancelled' WHERE signup_id=?").bind(id).run();return;
    }
    const unsubscribe='https://humanityinfrastructure.com/unsubscribe?t='+row.unsubscribe_token;
    const text=WELCOME_COPY.replace('{{unsubscribe_url}}',unsubscribe);
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.HI_RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'hi-welcome-'+id},body:JSON.stringify({from:'Humanity Infrastructure <noreply@id.ideaflow.app>',to:[row.email],subject:WELCOME_SUBJECT,text,headers:{'List-Unsubscribe':'<'+unsubscribe+'>'}}),signal:AbortSignal.timeout(8000)});
      if(response.ok) {
        await env.SIGNUPS.prepare("UPDATE welcome_deliveries SET status='sent',sent_at=? WHERE signup_id=?").bind(new Date().toISOString(),id).run();return;
      }
      // Do not retry rejected addresses/keys/payloads; retry only transient failures.
      const retry=response.status===429 || response.status>=500;
      await env.SIGNUPS.prepare('UPDATE welcome_deliveries SET status=? WHERE signup_id=?').bind(retry && attempt===0?'retry':'failed',id).run();
      if(!retry)return;
    } catch {
      await env.SIGNUPS.prepare('UPDATE welcome_deliveries SET status=? WHERE signup_id=?').bind(attempt===0?'retry':'failed',id).run();
    }
  }
}
