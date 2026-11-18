// Private signup routes. No personal data is published to WIT or public APIs.
const PRIVATE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function signupResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json', ...extra } });
}
function signupCsv(value) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+@\-]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
}
async function signupHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
async function handleSignup(request, env) {
  const url = new URL(request.url);
  if (!['/api/signup', '/unsubscribe', '/admin/signups.csv'].includes(url.pathname)) return null;
  try {
    if (url.pathname === '/admin/signups.csv') {
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      const supplied = request.headers.get('Authorization') || '';
      if (!env.ADMIN_EXPORT_TOKEN || await signupHash(supplied) !== await signupHash('Bearer ' + env.ADMIN_EXPORT_TOKEN)) return signupResponse({ error: 'Unauthorized' }, 401);
      const rows = await env.SIGNUPS.prepare('SELECT * FROM signups ORDER BY consent_at').all();
      const columns = ['id','email','interest','handle','public_opt_in','consent_at','source_page','utm','referrer','unsubscribed_at','unsubscribe_url'];
      const csv = [columns.join(','), ...rows.results.map(row => columns.map(key => signupCsv(key === 'unsubscribe_url' ? url.origin + '/unsubscribe?t=' + row.unsubscribe_token : row[key])).join(','))].join('\r\n');
      return new Response(csv, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/csv;charset=UTF-8', 'Content-Disposition': 'attachment; filename="hi-signups.csv"' } });
    }
    if (url.pathname === '/unsubscribe') {
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      const token = url.searchParams.get('t') || '';
      if (!/^[a-f0-9]{64}$/.test(token)) return signupResponse({ error: 'Invalid unsubscribe link' }, 400);
      const result = await env.SIGNUPS.prepare('UPDATE signups SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE unsubscribe_token = ?').bind(new Date().toISOString(), token).run();
      return new Response(result.meta.changes ? 'You are unsubscribed. You will receive no more letters.' : 'This unsubscribe link is not valid.', { status: result.meta.changes ? 200 : 404, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain;charset=UTF-8' } });
    }
    if (request.method !== 'POST') return signupResponse({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return signupResponse({ error: 'Please sign up from this site.' }, 403);
    if (!env.SIGNUPS || !env.RATE_LIMIT_SALT) return signupResponse({ error: 'Signup temporarily unavailable. Please try again later.' }, 503);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return signupResponse({ error: 'Expected JSON' }, 415);
    if (Number(request.headers.get('Content-Length')) > 4096) return signupResponse({ error: 'Submission too large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return signupResponse({ error: 'Empty submission' }, 400);
    let bytes = 0, chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4096) { await reader.cancel(); return signupResponse({ error: 'Submission too large' }, 413); }
      chunks.push(value);
    }
    let data;
    try { data = JSON.parse(await new Blob(chunks).text()); } catch { return signupResponse({ error: 'Invalid submission' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return signupResponse({ error: 'Invalid submission' }, 400);
    if (data.website) return signupResponse({ ok: true });
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return signupResponse({ error: 'Signup temporarily unavailable.' }, 503);
    const hash = await signupHash(env.RATE_LIMIT_SALT + ':' + ip);
    const window = Math.floor(Date.now() / 3600000);
    const rate = await env.SIGNUPS.prepare('INSERT INTO signup_rate_limits (ip_hash, window, attempts) VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window = excluded.window THEN attempts + 1 ELSE 1 END, window = excluded.window RETURNING attempts').bind(hash, window).first();
    if (rate.attempts > 5) return signupResponse({ error: 'Too many attempts. Please try again in an hour.' }, 429, { 'Retry-After': '3600' });
    await env.SIGNUPS.prepare('DELETE FROM signup_rate_limits WHERE window < ?').bind(window - 24).run();
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const interest = typeof data.interest === 'string' ? data.interest.trim() : '';
    const handle = typeof data.handle === 'string' ? data.handle.trim().replace(/^@/, '') : '';
    if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return signupResponse({ error: 'Please enter a valid email address.' }, 400);
    if (interest.length > 200 || (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle))) return signupResponse({ error: 'Use at most 200 characters for your interest and a valid X handle.' }, 400);
    const source = typeof data.source_page === 'string' ? data.source_page.slice(0, 300) : '/';
    const utm = JSON.stringify(Object.fromEntries(Object.entries(data.utm || {}).filter(([k,v]) => /^utm_(source|medium|campaign|term|content)$/.test(k) && typeof v === 'string').map(([k,v]) => [k,v.slice(0,200)])));
    const referrer = typeof data.referrer === 'string' ? data.referrer.slice(0,500) : '';
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    // Record the latest submitted interest and consent timestamp silently.
    // Preserve unsubscribe state, handle publicity and the existing private token.
    await env.SIGNUPS.prepare('INSERT INTO signups (id,email,interest,handle,public_opt_in,consent_at,source_page,utm,referrer,unsubscribe_token) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET interest = excluded.interest, consent_at = excluded.consent_at').bind(crypto.randomUUID(),email,interest,handle,handle && data.public_opt_in === true ? 1 : 0,new Date().toISOString(),source,utm,referrer,token).run();
    // Keep status, body and headers identical for new, duplicate and opted-out emails.
    // Unsubscribe URLs are available only to the owner export for inclusion in letters.
    return signupResponse({ ok: true });
  } catch {
    // Never log submitted fields or tokens.
    return signupResponse({ error: 'Signup temporarily unavailable. Please try again later.' }, 503);
  }
}

export default {
  async fetch(request, env) { return handleRequest(request, env) }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  const signup = await handleSignup(request, env)
  if (signup) return signup
  if (path === '/og-card.png') {
    return new Response(OG_PNG, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } })
  }
  if (path === '/classic' || path.startsWith('/classic/')) {
    return new Response(CLASSIC_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
  }
  if (path === '/v4' || path.startsWith('/v4/')) {
    return new Response(ARCHIVE_V4_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
  }
  if (path === '/v2' || path.startsWith('/v2/')) {
    return new Response(V2_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
  }
  if (path === '/v3' || path.startsWith('/v3/')) {
    return new Response(V3_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
  }
  if (path === '/v1' || path.startsWith('/v1/')) {
    return Response.redirect('https://humanityinfrastructure.com/', 301)
  }
  return new Response(MAIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
}

const MAIN_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Humanity Infrastructure — tools and knowledge for human flourishing</title>
<meta name="description" content="Humanity Infrastructure: a free directory of tools and knowledge for human flourishing. Find tools for practical needs, from offline knowledge to shared civic work. Suggest what belongs." />
<meta property="og:title" content="Humanity Infrastructure — tools and knowledge for human flourishing" />
<meta property="og:description" content="Knowledge is a birthright. So are the tools to use it. A free, open directory of tools and knowledge for human flourishing. Suggest what belongs." />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Humanity Infrastructure" />
<meta property="og:url" content="https://humanityinfrastructure.com/" />
<meta property="og:image" content="https://humanityinfrastructure.com/og-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Humanity Infrastructure: Knowledge is a birthright. So are the tools to use it." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Humanity Infrastructure — tools and knowledge for human flourishing" />
<meta name="twitter:description" content="A free, open directory of tools and knowledge for human flourishing. Suggest what belongs." />
<meta name="twitter:image" content="https://humanityinfrastructure.com/og-card.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>" />
<style>
  :root{
    --bg:#0c0f14; --bg-soft:#12161f; --card:#161b26; --card-hover:#1c2230;
    --text:#e8edf6; --muted:#97a1b3; --faint:#5d6678;
    --accent:#5fd3a8; --accent-2:#7aa2ff; --accent-warm:#f4b860;
    --border:rgba(255,255,255,.08); --border-strong:rgba(255,255,255,.16);
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 30px rgba(0,0,0,.35);
    --max:1080px;
  }
  [data-theme="light"]{
    --bg:#f7f8fa; --bg-soft:#eef1f6; --card:#ffffff; --card-hover:#f3f6fb;
    --text:#16202e; --muted:#566074; --faint:#8a93a6;
    --accent:#0f9d72; --accent-2:#3a64d8; --accent-warm:#c98415;
    --border:rgba(10,20,40,.10); --border-strong:rgba(10,20,40,.18);
    --shadow:0 1px 2px rgba(20,30,50,.06),0 10px 34px rgba(20,30,50,.10);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:80px}
  body{
    margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(900px 500px at 80% -10%,rgba(122,162,255,.10),transparent 60%),radial-gradient(800px 500px at 0% 0%,rgba(95,211,168,.08),transparent 55%);
  }
  a{color:var(--accent-2);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:var(--max);margin:0 auto;padding:0 24px}

  /* nav */
  nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(140%) blur(12px);
    background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--border)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:62px;gap:16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:1.05rem;color:var(--text)}
  .brand span.logo{font-size:1.3rem}
  .nav-links{display:flex;gap:22px;align-items:center}
  .nav-links a{color:var(--muted);font-size:.92rem;font-weight:500;white-space:nowrap}
  .nav-links a:hover{color:var(--text);text-decoration:none}
  .theme-btn{background:var(--card);border:1px solid var(--border-strong);color:var(--text);
    width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:1rem;display:grid;place-items:center}
  .theme-btn:hover{background:var(--card-hover)}
  @media(max-width:1040px){.nav-links a:not(.cta):not(.gh){display:none}}

  /* hero */
  header.hero{padding:88px 0 56px;text-align:center}
  .eyebrow{display:inline-block;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--accent);font-weight:700;border:1px solid var(--border-strong);
    padding:6px 14px;border-radius:999px;margin-bottom:26px;background:var(--bg-soft)}
  h1{font-size:clamp(2.4rem,6vw,4.3rem);line-height:1.04;letter-spacing:-.03em;margin:0 0 22px;font-weight:800}
  h1 .grad{background:linear-gradient(110deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .lede{font-size:clamp(1.1rem,2.4vw,1.4rem);color:var(--muted);max-width:720px;margin:0 auto 18px}
  .sub{font-size:1.02rem;color:var(--faint);max-width:680px;margin:0 auto 36px;font-style:italic}
  .btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:9px;padding:13px 24px;border-radius:12px;
    font-weight:600;font-size:1rem;border:1px solid transparent;cursor:pointer;transition:transform .12s ease}
  .btn:hover{text-decoration:none;transform:translateY(-2px)}
  .btn.primary{background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d}
  .btn.ghost{background:var(--card);border-color:var(--border-strong);color:var(--text)}
  .btn.ghost:hover{background:var(--card-hover)}

  section{padding:64px 0;border-top:1px solid var(--border)}
  .section-head{margin-bottom:36px;max-width:760px}
  .section-head h2{font-size:clamp(1.6rem,3.4vw,2.3rem);letter-spacing:-.02em;margin:0 0 12px;font-weight:800}
  .section-head p{color:var(--muted);font-size:1.06rem;margin:0}
  .kicker{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-warm);font-weight:700;margin-bottom:10px}

  /* manifesto pillars */
  .pillars{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
  .pillar{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
  .pillar .ico{font-size:1.7rem;margin-bottom:12px}
  .pillar h3{margin:0 0 8px;font-size:1.12rem;letter-spacing:-.01em}
  .pillar p{margin:0;color:var(--muted);font-size:.96rem}

  /* tools grid */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
  .card{display:block;background:var(--card);border:1px solid var(--border);border-radius:16px;
    padding:22px;transition:transform .14s ease,border-color .14s ease,background .14s ease;position:relative}
  .card:hover{transform:translateY(-4px);border-color:var(--border-strong);background:var(--card-hover);text-decoration:none;box-shadow:var(--shadow)}
  .card .top{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .card .emoji{font-size:1.5rem;width:42px;height:42px;border-radius:11px;background:var(--bg-soft);display:grid;place-items:center;flex:none}
  .card h3{margin:0;font-size:1.1rem;color:var(--text);letter-spacing:-.01em}
  .card .url{font-size:.8rem;color:var(--accent);font-weight:600}
  .card p{margin:0;color:var(--muted);font-size:.93rem}
  .tag{position:absolute;top:16px;right:16px;font-size:.66rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:4px 9px;border-radius:999px}
  .tag.live{background:rgba(95,211,168,.14);color:var(--accent);border:1px solid rgba(95,211,168,.3)}
  .tag.build{background:rgba(244,184,96,.13);color:var(--accent-warm);border:1px solid rgba(244,184,96,.3)}
  .tag.idea{background:rgba(122,162,255,.13);color:var(--accent-2);border:1px solid rgba(122,162,255,.3)}

  /* build list */
  .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
  .chip{background:var(--card);border:1px solid var(--border-strong);color:var(--muted);
    padding:8px 16px;border-radius:999px;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .12s ease}
  .chip:hover{background:var(--card-hover);color:var(--text)}
  .chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
  .bcard{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;
    display:flex;flex-direction:column;gap:8px;position:relative}
  .bcard .cat{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:700}
  .bcard h3{margin:0;font-size:1.04rem;letter-spacing:-.01em;padding-right:74px}
  .bcard p{margin:0;color:var(--muted);font-size:.9rem;flex:1}
  .bcard .row{display:flex;align-items:center;gap:14px;margin-top:4px}
  .bcard .claim{font-size:.84rem;font-weight:700;color:var(--accent)}
  .bcard a.ext{font-size:.82rem;color:var(--faint)}
  .buildnote{margin-top:26px;color:var(--faint);font-size:.92rem;text-align:center}
  .claim-head{margin:48px 0 22px;text-align:center}
  .claim-head h3{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 8px;display:inline-flex;align-items:center;gap:10px}
  .claim-head p{color:var(--muted);max-width:640px;margin:0 auto;font-size:.98rem}
  .livedot{width:10px;height:10px;border-radius:50%;background:#ef5f5f;display:inline-block;box-shadow:0 0 0 0 rgba(239,95,95,.5);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(239,95,95,.5)}70%{box-shadow:0 0 0 8px rgba(239,95,95,0)}100%{box-shadow:0 0 0 0 rgba(239,95,95,0)}}
  .card.featured .needline{margin-bottom:8px;color:var(--muted);font-size:.84rem;line-height:1.5}
  .need-label{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--accent-warm);margin-right:5px}
  .card.featured .why{margin-top:12px;font-size:.88rem}
  .card.featured .top>div{min-width:0}
  .card.featured h3{padding-right:72px}
  .card.featured h3 a{color:inherit}
  .card.featured .url{overflow-wrap:anywhere}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .badges li{font-size:.7rem;font-weight:650;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);color:var(--muted)}
  .badges li.open{color:var(--accent);border-color:rgba(95,211,168,.35)}
  .why{font-size:.88rem;color:var(--muted);border-left:2px solid var(--accent-2);padding-left:10px;margin:0}
  .why b{color:var(--text);font-weight:650}
  .seemore{font-size:.86rem;font-weight:600;margin-top:auto}
  .direct{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  .direct a{color:var(--muted);text-decoration:underline}
  .witloading{color:var(--faint);padding:30px;grid-column:1/-1;text-align:center}
  .bcard .votes{font-size:.8rem;color:var(--faint);font-weight:600}
  .bcard .claimedby{font-size:.82rem;color:var(--accent-warm);font-weight:700}

  /* quote */
  blockquote{margin:0;background:var(--bg-soft);border:1px solid var(--border);border-left:4px solid var(--accent);
    border-radius:14px;padding:26px 30px;font-size:1.12rem;color:var(--text)}
  blockquote cite{display:block;margin-top:14px;font-size:.92rem;color:var(--faint);font-style:normal}

  /* lists row */
  .links-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .lcol{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px}
  .lcol h4{margin:0 0 12px;font-size:.95rem;color:var(--text)}
  .lcol ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .lcol li a{color:var(--muted);font-size:.9rem}
  .lcol li a:hover{color:var(--accent-2)}

  /* CTA */
  .cta-band{background:linear-gradient(120deg,rgba(95,211,168,.10),rgba(122,162,255,.10));
    border:1px solid var(--border-strong);border-radius:22px;padding:48px;text-align:center}
  .cta-band h2{font-size:clamp(1.6rem,3.4vw,2.2rem);margin:0 0 12px;letter-spacing:-.02em}
  .cta-band p{color:var(--muted);max-width:620px;margin:0 auto 26px;font-size:1.05rem}

  footer{padding:48px 0 60px;border-top:1px solid var(--border);color:var(--faint);font-size:.88rem}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:18px;align-items:center}
  footer a{color:var(--muted)}
  .ver{font-variant-numeric:tabular-nums;opacity:.7}

  /* Contribute modal */
  .modal-overlay{display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px}
  .modal-overlay.open{display:flex;align-items:flex-start;justify-content:center}
  .modal-box{background:var(--bg-soft);border:1px solid var(--border-strong);border-radius:16px;width:100%;max-width:640px;margin:auto;padding:32px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.7)}
  .modal-close{position:absolute;top:16px;right:16px;background:var(--card);border:1px solid var(--border-strong);color:var(--text);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:1.1rem;display:grid;place-items:center;line-height:1}
  .modal-close:hover{background:var(--card-hover)}
  .modal-eyebrow{font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:12px;font-weight:600}
  .modal-title{font-size:1.55rem;font-weight:600;letter-spacing:-.02em;margin-bottom:6px}
  .modal-sub{color:var(--muted);font-size:.92rem;margin-bottom:24px;line-height:1.5}
  .m-field{margin-bottom:16px}
  .m-field label{display:block;font-size:.8rem;color:var(--muted);font-family:monospace;margin-bottom:6px;letter-spacing:.04em}
  .m-field label span{color:var(--faint)}
  .m-field input,.m-field textarea{width:100%;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;color:var(--text);font-family:inherit;font-size:.93rem;padding:10px 14px;outline:none;transition:border-color .15s}
  .m-field input:focus,.m-field textarea:focus{border-color:var(--accent-2)}
  .m-field input::placeholder,.m-field textarea::placeholder{color:var(--faint)}
  .m-field textarea{resize:vertical;min-height:80px;line-height:1.5}
  .m-submit{display:block;width:100%;padding:13px;background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d;font-family:inherit;font-size:.9rem;font-weight:700;border:none;border-radius:8px;cursor:pointer;letter-spacing:.03em;transition:opacity .15s;margin-top:4px}
  .m-submit:hover{opacity:.9}
  .m-submit:disabled{opacity:.38;cursor:not-allowed}
  .m-status{font-family:monospace;font-size:.78rem;color:var(--muted);margin-top:12px;text-align:center;min-height:18px}
  .m-results{margin-top:24px;display:none}
  .m-results.show{display:block}
  .m-profile{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px}
  .m-profile-name{font-size:1.1rem;font-weight:600;margin-bottom:2px}
  .m-profile-role{font-size:.75rem;color:var(--accent-warm);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;font-family:monospace}
  .m-profile-bio{color:var(--muted);font-size:.88rem;line-height:1.6}
  .m-match{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px;transition:border-color .15s}
  .m-match:hover{border-color:var(--border-strong)}
  .m-match-name{font-size:.85rem;font-weight:600;color:var(--accent-2);margin-bottom:4px}
  .m-match-fit{font-size:.87rem;color:var(--text);margin-bottom:8px;line-height:1.5}
  .m-match-quest{font-size:.78rem;color:var(--accent);border-left:2px solid var(--accent);padding-left:10px;line-height:1.45}
  .m-match-link{display:inline-block;margin-top:8px;font-family:monospace;font-size:.72rem;color:var(--faint)}
  .m-save-row{margin-top:20px;padding-top:18px;border-top:1px solid var(--border);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .m-save-btn{padding:9px 20px;background:transparent;border:1px solid var(--accent-2);color:var(--accent-2);font-family:inherit;font-size:.8rem;font-weight:600;border-radius:8px;cursor:pointer;transition:all .15s;white-space:nowrap}
  .m-save-btn:hover{background:var(--accent-2);color:var(--bg)}
  .m-save-note{font-size:.78rem;color:var(--faint);flex:1}
  .m-save-ok{font-family:monospace;font-size:.78rem;color:var(--accent);display:none}
  .m-save-ok.show{display:block}

  .letter{max-width:680px;width:100%;padding:26px;border:1px solid var(--border-strong);border-radius:14px;background:var(--bg-soft);text-align:left;margin:24px auto}
  .letter h2{color:var(--text);font-size:1.3rem;margin:0 0 8px}.letter p{color:var(--muted);margin:8px 0 18px}
  .letter label{display:block;margin:12px 0 5px;color:var(--text);font-size:.9rem}
  .letter input:not([type=checkbox]),.letter textarea{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border-strong);border-radius:7px;padding:10px}
  .letter textarea{resize:vertical}.letter .consent{display:flex;align-items:center;gap:8px}.letter button{margin-top:16px;cursor:pointer;font:inherit}
  .letter .trap{position:absolute;left:-10000px}.letter .status{margin-top:12px}.letter small{display:block;color:var(--muted);margin-top:14px}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#top"><span class="logo">🌍</span> Humanity Infrastructure <span style="color:var(--faint);font-weight:500">· The Codex</span></a>
  <div class="nav-links">
    <a href="#manifesto">Manifesto</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">The Vision</a>
    <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
    <a class="gh" href="https://github.com/tmad4000/humanity-infrastructure" target="_blank" rel="noopener" aria-label="Humanity Infrastructure on GitHub">GitHub ↗</a>
    <button class="theme-btn" id="themeBtn" title="Toggle light/dark" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <span class="eyebrow">Basic Infrastructure for Human Flourishing</span>
  <h1>Knowledge is a <span class="grad">birthright</span>.<br/>So are the tools to use it.</h1>
  <p class="lede">A codex of human know-how as a public resource to humanity — plus the open-source software to coordinate human activity around it. The not-just-engineering equivalent of the open-source movement.</p>
  <p class="sub">“Building tools for the well-intended.” This is how we coordinate as a superorganism.</p>
  <div class="btns">
    <a class="btn primary" href="#tools">Explore the tools →</a>
    <button class="btn ghost" onclick="openContribute()" style="cursor:pointer;font-size:inherit">Find your contribution →</button>
  </div>
  <p class="sub" style="margin-top:24px">A short, occasional letter about tools for human flourishing. No spam; unsubscribe any time. <a href="#letter">I’m interested →</a></p>
</div></header>

<section id="manifesto"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Premise</div>
    <h2>Imagine it were everyone's birthright to access the sum-total of human know-how.</h2>
    <p>The Codex is a hub of knowledge resources and open-source infrastructure — built to bring human flourishing into every person's reach. We envision something most of the developed world eventually becomes part of, to a greater or lesser degree.</p>
  </div>
  <div class="pillars">
    <div class="pillar"><div class="ico">📖</div><h3>Knowledge as a public good</h3><p>Survival and thriving guides, medical know-how, open curricula, role-model casting, the craftsmanship that is all software. Shouldn't software from 10 years ago be free by now?</p></div>
    <div class="pillar"><div class="ico">🛠️</div><h3>Tools that make people independent</h3><p>Open reputation systems, collective-action tools, personal-leverage automation, assistive tech. Hacked-together infrastructure that helps people help themselves.</p></div>
    <div class="pillar"><div class="ico">🤝</div><h3>Coordinate as a superorganism</h3><p>Guilds taking on epic quests. Global sense-making. Volunteerism, philanthropy for everyone, and ways to pitch in on the problems that matter — together.</p></div>
    <div class="pillar"><div class="ico">🌱</div><h3>Flourishing in reach for all</h3><p>From "how to thrive as a highly sensitive person on a budget" to "how to rebuild society from scratch." Compassionate, practical, and free.</p></div>
  </div>
</div></section>

<section id="tools"><div class="wrap">
  <div class="section-head">
    <div class="kicker">Tools</div>
    <h2>Pieces of the infrastructure that already exist</h2>
    <p>Find tools for practical needs, from offline knowledge to shared civic work. Free to use. Open where possible. Featured listings show license, platform and maker. <a href="#submit">Suggest a resource →</a></p>
  </div>
  <div class="grid">
    <article class="card featured" id="lastbook">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">📖</span><div><h3><a href="https://lastbook.org" target="_blank" rel="noopener">Lastbook</a></h3><div class="url">lastbook.org</div></div></div>
      <p class="needline"><span class="need-label">Need</span> Knowledge that survives when the internet doesn't</p>
      <p>A free, open-source offline library of practical manuals, videos and maps, with optional local AI. Knowledge for preparedness and rebuilding, available after setup without an internet connection.</p>
      <ul class="badges"><li class="open">Open source · MIT</li><li>Mac · Windows · Linux</li><li>By farbood &amp; contributors</li></ul>
      <p class="why"><b>Editor's Note:</b> when the network goes down, the knowledge shouldn't. A library you can hand to a neighbour on a drive.</p>
    </article>
    <a class="card" href="https://nvctranslator.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🕊️</span><div><h3>NVC Translator</h3><div class="url">nvctranslator.com</div></div></div>
      <p>Translate any text into Marshall Rosenberg's Nonviolent Communication — observations, feelings, needs, requests. How can AI make us more compassionate?</p>
    </a>
    <a class="card" href="https://globalbr.ai" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🧠</span><div><h3>Noos</h3><div class="url">globalbr.ai</div></div></div>
      <p>A universal knowledge graph — the "codex" backend. Capture, connect, and query human know-how with per-node privacy.</p>
    </a>
    <a class="card" href="https://wikihub.md" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">📚</span><div><h3>WikiHub</h3><div class="url">wikihub.md</div></div></div>
      <p>GitHub for LLM wikis. Hosting for open, agent-native markdown knowledge bases — forkable, shareable, version-controlled.</p>
    </a>
    <a class="card" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🌐</span><div><h3>World Issue Tracker</h3><div class="url">worldissuetracker.com</div></div></div>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
    </a>
    <a class="card" href="https://tmad4000.github.io/brainstorms/" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">💡</span><div><h3>Idea List</h3><div class="url">tmad4000.github.io/brainstorms</div></div></div>
      <p>An open idea bank — projects, hackathon ideas, and easily-solvable world problems, free for anyone to take and build.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/claude-mind" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🔬</span><div><h3>Claude Mind</h3><div class="url">github.com/tmad4000/claude-mind</div></div></div>
      <p>Collaborative AI–human exploration of open problems — research rabbits and guilds working the quests, Polymath-style.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/vibe-coding-guide" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">⚡</span><div><h3>Vibe Coding Guide</h3><div class="url">github.com/tmad4000/vibe-coding-guide</div></div></div>
      <p>Open guide to AI-assisted coding — making the craftsmanship of software buildable by everyone.</p>
    </a>
    <article class="card featured" id="signudoc">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">✍️</span><div><h3><a href="https://github.com/NYLLON-SOFTWARE/SignuDoc" target="_blank" rel="noopener">SignuDoc</a></h3><div class="url">github.com/NYLLON-SOFTWARE/SignuDoc</div></div></div>
      <p class="needline"><span class="need-label">Need</span> Open document signing infrastructure</p>
      <p>Open-source e-signatures. Send, sign and seal documents from your own cloud at $0 per seat, with audit trails and tamper-evident seals.</p>
      <ul class="badges"><li class="open">Open source · MIT</li><li>Self-hosted on your Vercel account</li><li>By Kevin Rose / NYLLON</li></ul>
      <p class="why"><b>Editor's Note:</b> agreeing on things is basic civic plumbing. Signing a PDF shouldn't need a per-seat licence or someone else's cloud.</p>
    </article>
    <article class="card featured" id="paxi">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">🚕</span><div><h3><a href="https://paxi.fyi" target="_blank" rel="noopener">Paxi</a></h3><div class="url">paxi.fyi</div></div></div>
      <p class="needline"><span class="need-label">Need</span> Use the best service for each task, without interface lock-in</p>
      <p>Compares live ride prices and times across Uber, Lyft, Waymo, Tesla, Zoox, Curb and more, then books the one you choose. Your logins stay on your phone.</p>
      <ul class="badges"><li>Free · closed source</li><li>iPhone (iOS 17+)</li><li>By Doug Feigelson, a friend of the maintainer</li></ul>
      <p class="why"><b>Editor's Note:</b> every app wants to be the only door. You should be able to compare providers, choose the best one for each job and switch freely. <a href="https://github.com/tmad4000/humanity-infrastructure/issues/2" target="_blank" rel="noopener">Community submission #2</a>.</p>
    </article>
  </div>
</div></section>

<section><div class="wrap">
  <blockquote>
    “We need these tools, all of them, and to be honest with you, they need to be in the hands of everybody… When humans come into guilds to do epic quests, they're problem-solving, they're inventing a solution. That's how this planet's going to get fixed.”
    <cite>— Jack Park, on guilds &amp; global sense-making</cite>
  </blockquote>
</div></section>

<section id="buildlist"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Open Build List</div>
    <h2>What still needs to be built</h2>
    <p>The infrastructure for human flourishing is mostly <em>not built yet</em>. Below is the running list — ideas, works-in-progress, and what's done. Lifted from the Codex master doc; we'll keep pulling in more from across the lists. See one you want to build? <strong>Claim it.</strong></p>
  </div>
  <div class="filters" id="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="idea">💡 Ideas</button>
    <button class="chip" data-f="building">🔨 In progress</button>
    <button class="chip" data-f="done">✅ Done</button>
  </div>
  <div class="grid" id="buildgrid"></div>
  <p class="buildnote">This list is open. Add an idea or claim one on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Missing Civilization Infrastructure</a> board — or email <a href="mailto:jacob@ideaflow.io?subject=Open%20Build%20List">jacob@ideaflow.io</a>.</p>

  <div class="claim-head">
    <h3><span class="livedot"></span> Claim a quest — live from the tracker</h3>
    <p>These ideas are filed as real, public issues on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">World Issue Tracker</a>. Vote, discuss, or claim one to build — updates here in real time.</p>
  </div>
  <div class="grid" id="witgrid"><div class="witloading">Loading open quests from the tracker…</div></div>
</div></section>

<section id="vision"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Living Document</div>
    <h2>The full vision — and where to add to it</h2>
    <p>The Codex is an open, growing document. These are the canonical sources behind this page. Add yourself, add a project, add a resource.</p>
  </div>
  <div class="links-cols">
    <div class="lcol">
      <h4>📜 Read the source</h4>
      <ul>
        <li><a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Humanity 3.0 &amp; the Dharmic blueprint (Notion)</a></li>
        <li><a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">The Codex — master doc (Google Docs)</a></li>
        <li><a href="https://plausible-text-76b.notion.site/Cody-s-Healing-List-v4-b05b097d529c4c54b5d62f87f55b1f6f" target="_blank" rel="noopener">Healing Resources — "Cody Codex" (Notion)</a></li>
        <li><a href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">World Quest Guild — add yourself</a><span class="direct">Short link: <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</span></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="https://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="https://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="https://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="https://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="https://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="https://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="https://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="https://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="https://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="https://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="submit"><div class="wrap">
  <h2>What else should be featured?</h2>
  <p>Help grow Humanity Infrastructure. Suggest useful tools, open knowledge, practical guides or projects that help people flourish. You do not need to be a developer.</p>
  <p>Send the name, link, a short description and who it helps. Include access or licensing details and any affiliation. We review suggestions before featuring them.</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0">
    <a class="btn primary" href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml">Suggest a resource on GitHub →</a>
    <a class="btn ghost" href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure%20resource%20suggestion&amp;body=Name%3A%0ALink%3A%0AWho%20it%20helps%3A%0AAccess%20or%20license%3A%0AMy%20affiliation%3A">Suggest by email</a>
    <a class="btn ghost" href="https://github.com/tmad4000/humanity-infrastructure/blob/main/CONTRIBUTING.md">Contribute a pull request →</a>
  </div>
  <p><a href="https://github.com/tmad4000/humanity-infrastructure">Browse the website source on GitHub</a> · <a href="https://index.ideaflow.app/build" target="_blank" rel="noopener">Build on Ideaflow</a> · <a href="https://index.ideaflow.app" target="_blank" rel="noopener">Ideaflow apps index</a> · <a href="https://worldissuetracker.com/tracker/lastbook">Lastbook community feedback and fixes</a></p>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band">
    <h2>If you're not part of this, what are you doing with your life?</h2>
    <p>We're building the more general, not-just-engineering equivalent of the open-source movement. There's an enormous amount of low-hanging fruit — and we're looking for designers, engineers, writers, healers, and well-intended humans of every kind.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="mailto:jacob@ideaflow.io?subject=Joining%20the%20Codex%20%2F%20Humanity%20Infrastructure">Get involved →</a>
      <a class="btn ghost" href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">Join a guild</a>
    </div>
    <span class="direct">World Quest Guild · short link <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</span>
  </div>
</div></section>

<footer><div class="wrap"><section class="letter" id="letter"><h2>A letter from Humanity Infrastructure</h2>
<p>A short, occasional letter about tools for human flourishing. No spam; unsubscribe any time.</p>
<form id="letter-form">
<label for="letter-email">Email <span aria-hidden="true">*</span></label><input id="letter-email" name="email" type="email" maxlength="254" autocomplete="email" required>
<label for="letter-interest">What are you interested in / building? <span>(optional, 200 characters)</span></label><textarea id="letter-interest" name="interest" maxlength="200" rows="2"></textarea>
<label for="letter-handle">X handle <span>(optional)</span></label><input id="letter-handle" name="handle" maxlength="16" placeholder="@yourhandle" autocomplete="off">
<label class="consent"><input name="public_opt_in" type="checkbox"> Show my handle publicly</label>
<div class="trap" aria-hidden="true"><label for="letter-website">Website</label><input id="letter-website" name="website" tabindex="-1" autocomplete="off"></div>
<button class="btn primary" type="submit">I'm interested →</button><div class="status" role="status" aria-live="polite"></div>
<small>By signing up, you agree to receive this occasional letter. Your email and interest stay private. Your handle stays private unless you opt in. Unsubscribe with one click in any letter.</small>
</form></section>
<p style="width:100%;color:var(--muted)">Privacy: signup details are stored privately for this letter, never in the public issue tracker. Contact <a href="mailto:jacob@ideaflow.io">jacob@ideaflow.io</a> to request deletion.</p>
  <div>
    <strong style="color:var(--text)">Humanity Infrastructure · The Codex</strong> — basic infrastructure for human flourishing.<br/>
    Free to use. Open where possible. Featured listings show their license. <a href="https://github.com/tmad4000/humanity-infrastructure">Source on GitHub</a> · Contact <a href="mailto:jacob@ideaflow.io">jacob@ideaflow.io</a>
  </div>
  <div style="text-align:right">
    <a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Blueprint (Notion)</a> ·
    <a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">Master doc</a><br/>
    <span class="ver">v0.5.2 · 2026-11-18</span>
  </div>
</div>
  <!-- Design versions + legacy -->
  <div style="border-top:1px solid var(--border);margin-top:48px;padding-top:24px;display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;opacity:.5;font-size:.78rem;">
    <span style="font-family:monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);">Design versions →</span>
    <a href="/" style="color:var(--accent-2);">v1 — Original / Dark (current)</a>
    <a href="/v2" style="color:var(--accent-2);">v2 — Editorial / Red</a>
    <a href="/v3" style="color:var(--accent-2);">v3 — Dark Blueprint</a>
    <a href="/v4" style="color:var(--accent-2);">v4 — Archived format</a>
    <a href="/classic" style="color:var(--accent-2);">Classic — Original layout</a>
    <a href="https://github.com/tmad4000/humanity-infrastructure/blob/main/VERSION_LOG.md" style="color:var(--accent-2);">Version log &amp; screenshots</a>
  </div>
</footer>

<!-- Contribute modal -->
<div class="modal-overlay" id="contributeModal" onclick="closeContributeIfBg(event)">
  <div class="modal-box">
    <button class="modal-close" onclick="closeContribute()" aria-label="Close">✕</button>
    <div class="modal-eyebrow">Find your quest</div>
    <div class="modal-title">How can you contribute?</div>
    <div class="modal-sub">Share a bit about yourself and we'll match you to the open infrastructure projects where you'd have the most impact.</div>
    <div class="m-field">
      <label for="m-twitter">X / Twitter handle <span>(optional)</span></label>
      <input id="m-twitter" type="text" placeholder="@handle or x.com/handle"/>
    </div>
    <div class="m-field">
      <label for="m-linkedin">LinkedIn URL <span>(optional)</span></label>
      <input id="m-linkedin" type="url" placeholder="linkedin.com/in/yourname"/>
    </div>
    <div class="m-field">
      <label for="m-homepage">Personal website or portfolio <span>(optional)</span></label>
      <input id="m-homepage" type="url" placeholder="https://yoursite.com"/>
    </div>
    <div class="m-field">
      <label for="m-about">About you <span>(work, interests, what you want to build)</span></label>
      <textarea id="m-about" placeholder="e.g. I'm a therapist who's been thinking about AI and nonviolent communication…"></textarea>
    </div>
    <button class="m-submit" id="m-analyzeBtn" onclick="mRunAnalysis()">Find my contribution →</button>
    <div class="m-status" id="m-status"></div>
    <div class="m-results" id="m-results">
      <div class="m-profile" id="m-profile"></div>
      <div id="m-matches"></div>
      <div class="m-save-row">
        <button class="m-save-btn" id="m-saveBtn" onclick="mSave()">Save to World Issue Tracker →</button>
        <span class="m-save-note">Creates a public profile in the HI Contributors tracker</span>
        <span class="m-save-ok" id="m-saveOk"></span>
      </div>
    </div>
  </div>
</div>

<script>

// Shelf links use /?interest=<key>#letter. Keep this independent of shelf markup.
const signupInterestLabels = {
  'unlinked': 'Unlinked', 'superconnector': 'Superconnector', 'openchat': 'OpenChat',
  'ideaflow-index': 'Ideaflow apps index', 'open-recordings': 'Open Recordings'
};
const signupInterestParam = new URLSearchParams(location.search).get('interest');
if (Object.hasOwn(signupInterestLabels, signupInterestParam)) document.getElementById('letter-interest').value = signupInterestLabels[signupInterestParam];

document.getElementById('letter-form').addEventListener('submit', async function(event) {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button'), status = form.querySelector('.status');
  button.disabled = true; status.textContent = 'Saving…';
  const fields = new FormData(form), params = new URLSearchParams(location.search), utm = {};
  ['source','medium','campaign','term','content'].forEach(key => { if (params.has('utm_' + key)) utm['utm_' + key] = params.get('utm_' + key); });
  try {
    const response = await fetch('/api/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:fields.get('email'),interest:fields.get('interest'),handle:fields.get('handle'),public_opt_in:fields.has('public_opt_in'),website:fields.get('website'),source_page:location.pathname,utm,referrer:document.referrer}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Please try again later.');
    status.textContent = 'Thank you. If this email is new, you’re on the list.';
    form.reset();
  } catch(error) { status.textContent = error.message || 'Could not connect. Please try again.'; }
  finally { button.disabled = false; }
});

  // ---- Open Build List data (lifted from the Codex master doc) ----
  var BUILD=[
    {c:"Collective Action",t:"ThunderPledge",s:"idea",u:"https://thunderpledge.jacobcole.net",d:"Kickstarter for collective action: pledge to go vegetarian, vote, or boycott — but only once a critical mass also commits. Variants: ThunderVote, ThunderBoycott ('Kickstopper')."},
    {c:"Collective Action",t:"Zero-Sum Redirect",s:"idea",d:"A clearinghouse for opposing political donations — matched contributions cancel out and the saved money goes to charity instead."},
    {c:"Collective Action",t:"Government Suggestion Box",s:"idea",d:"A suggestion-box platform for governments, including the ability to donate toward implementing specific suggestions."},
    {c:"Collective Action",t:"Everyone-a-Philanthropist",s:"idea",d:"Infrastructure so communities can pool resources to fill missing government functions — help a neighbor afford insurance, get a kid a laptop."},
    {c:"Collective Action",t:"Resource-Sharing Platform",s:"idea",u:"https://favorverse.jacobcole.net/",d:"Let people share what they can lend — tools, a U-Haul, time. Related: Favorverse & VolunteerForce."},
    {c:"Reputation & Trust",t:"Open Reputation System",s:"idea",d:"A portable, open reputation layer — the missing primitive for trust in online coordination."},
    {c:"Reputation & Trust",t:"Trust Layer / Meta-Brands",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A trust layer for the web — 'meta-brands' that vouch for quality and integrity."},
    {c:"Reputation & Trust",t:"Fact-Check Extension",s:"idea",u:"https://factcheck.jacobcole.net/",d:"A browser extension surfacing fact-checks and provenance inline."},
    {c:"Fixing the Internet",t:"Open Forum Software",s:"building",u:"https://github.com/gulkily/pollyanna",d:"Forum software that is transparent, consensual, and open-source (Pollyanna)."},
    {c:"Fixing the Internet",t:"Minimalist Homepages",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A better way to make calm, minimalist personal homepages."},
    {c:"Fixing the Internet",t:"ThoughtfulWeb",s:"idea",u:"https://thoughtfulweb.jacobcole.net",d:"A directory of places on the web that are thoughtful, artful, and mindful — an oasis of good taste."},
    {c:"Personal Leverage",t:"'Camel's Eye' Email Agent",s:"idea",d:"An agent that filters and triages email on your behalf (from Permutation City). Reclaim your attention."},
    {c:"Personal Leverage",t:"Shortcut / Macro Coach",s:"idea",d:"Watches your actions and occasionally suggests a shortcut, auto-writing the macro for you."},
    {c:"Personal Leverage",t:"Open Automation Tools",s:"idea",d:"Great open-source macro & browser-automation frameworks (Browserflow-style) for everyone."},
    {c:"Personal Leverage",t:"Shopping Coach",s:"idea",d:"A service that shops on your behalf — finds the best, most ethical option so you don't have to."},
    {c:"Open Knowledge",t:"Open Meditation Curricula",s:"building",u:"https://meditation.jacobcole.net/",d:"Basic open curricula for meditation and working with your body. Lists exist; needs a real course."},
    {c:"Open Knowledge",t:"Open Medical Knowledge",s:"building",u:"https://chronicpain.jacobcole.net/",d:"How to treat chronic pain, RSI, and more — patient-first medical know-how. Lists started."},
    {c:"Open Knowledge",t:"Open Academic Education",s:"idea",d:"University-level math, an open algorithms tutor, and interactive self-teaching programming resources."},
    {c:"Open Knowledge",t:"Open Work Templates",s:"idea",d:"Open templates for every kind of work — invoices, gantt charts, proposals."},
    {c:"Open Knowledge",t:"Role-Model Casting",s:"idea",u:"https://foodslist.jacobcole.net/",d:"For people without good role models — emulate the routines of healthy, effective people (e.g. foods lists)."},
    {c:"Open Knowledge",t:"Motivation Database",s:"idea",u:"https://whyisitawesome.jacobcole.net/",d:"A wiki of why all the awesome things in the world are awesome — fuel for motivation."},
    {c:"Open Knowledge",t:"'Books to Grow Up On'",s:"idea",u:"https://kidactivities.jacobcole.net",d:"An open list of literature that builds good mental models — plus kids' games & activities."},
    {c:"Assistive Tech",t:"Hands-Free Voice Interfaces",s:"idea",d:"Good hands-free voice-recognition hooks into common sites (Gmail, etc.) for quadriplegics and others. Lots of low-hanging fruit."},
    {c:"Assistive Tech",t:"Cueing App for Brain Injuries",s:"idea",d:"A cueing/reminder app for people recovering from brain injuries."},
    {c:"Assistive Tech",t:"Better Foot Mouse",s:"idea",d:"A better foot-operated mouse for people who can't use their hands."},
    {c:"Coordination Infra",t:"On-the-Fly Knowledge Capture",s:"building",u:"https://globalbr.ai",d:"Frictionless personal knowledge capture + a graph query engine. Being built as Noos."},
    {c:"Coordination Infra",t:"Global Idea Bank",s:"building",u:"https://tmad4000.github.io/brainstorms/",d:"An open bank of ideas & hackathon projects anyone can take and build. Live as the Idea List."},
    {c:"Coordination Infra",t:"Open Research Repository",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A global, open repository for research — make the world's findings freely usable."},
    {c:"Care & Society",t:"Adult 'Foster' Support Network",s:"idea",d:"Ubiquitous support — 'extra parents' — for adults facing challenges so no one falls through the cracks."},
    {c:"Care & Society",t:"Non-Emergency Help Button",s:"idea",d:"A button to request non-emergency help: a compassionate responder for mental-health crises, a care coordinator, a 'life figure-outer'."},
    {c:"Care & Society",t:"Database of Survival Guides",s:"idea",d:"'How to survive/thrive' guides across many contexts — including for highly sensitive people on a budget."},
    {c:"Care & Society",t:"Database of Human Ideals",s:"idea",d:"Documenting the multiplicity of happy cultures and ways of being."},
    {c:"Done",t:"OpenLibrary",s:"done",u:"https://openlibrary.org",d:"Open, universal catalog of books. Exists — and it's wonderful."},
    {c:"Done",t:"Internet Archive",s:"done",u:"https://archive.org",d:"Humanity's library and memory. Exists — support it."},
    {c:"Done",t:"Concentration Music",s:"done",d:"Open 'music for concentration' playlists everyone can access. Largely solved."},
    {c:"Fixing the Internet",t:"Cross-Site Hashtag Search",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Search a hashtag uniformly across every social platform and website at once."},
    {c:"Fixing the Internet",t:"Universal Comments Layer",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Attach comment threads to any webpage, email, or chat, viewable by anyone."},
    {c:"Fixing the Internet",t:"Universal Web Annotations",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared highlight-and-note layer that pins annotations onto any page across the web."},
    {c:"Open Knowledge",t:"Canonical Debate Lab",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A structured platform that organizes contested claims and their arguments toward resolution."},
    {c:"Open Knowledge",t:"Scientific Assertions Database",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A machine-readable repository of scientific claims with their dependencies and evidence mapped."},
    {c:"Open Knowledge",t:"Collaborative Theorem Prover",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared workspace where mathematicians jointly build and verify formal proofs."},
    {c:"Open Knowledge",t:"Negative Results Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"An archive of failed experiments and null results so research isn't needlessly duplicated."},
    {c:"Open Knowledge",t:"Argument Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A searchable database of debate outlines and reusable argumentative frameworks."},
    {c:"Coordination Infra",t:"Policy & Science Simulator",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A sandbox for safely testing policy changes and hypotheses before real-world rollout."},
    {c:"Personal Leverage",t:"Unified Feed Control",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A single interface managing emails, texts, calls, and feeds with user-defined routing rules."},
    {c:"Fixing the Internet",t:"Soundbite Propagation Tracker",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Audio-fingerprinting that traces how a specific quote or claim spreads across media."},
    {c:"Civic & Government",t:"Global Goals Dashboard",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A public dashboard visualizing humanity's measured progress on major shared objectives."},
    {c:"Collective Action",t:"Conditional Voting Pledge",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Citizens commit to vote only if enough peers in their district also pledge, then all activate together."},
    {c:"Care & Society",t:"Favor-Matching Network",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Maps friends' skills so people can request and exchange favors locally."},
    {c:"Health & Body",t:"ICU & Ventilator Tracker",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A real-time map of available ventilators and ICU beds across hospitals during a crisis."},
    {c:"Care & Society",t:"Proximity Hangout Suggester",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Alerts you to nearby friends and suggests a meetup without persistent location tracking."},
    {c:"Fixing the Internet",t:"Political Bias Classifier",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"An ML tool that detects and labels politically biased content in social feeds."},
    {c:"Climate & Sustainability",t:"Wildfire Satellite Detection",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A model that flags forest fires early from satellite imagery."},
    {c:"Personal Leverage",t:"Ingredient Recipe Finder",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Recommends recipes from what's in your kitchen and pairs you with a cooking partner."},
    {c:"Reputation & Trust",t:"Used-Car History Database",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A verified repository of repair and inspection histories for used vehicles."},
    {c:"Open Knowledge",t:"Idea Graph IDE",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A graph workspace that links hackathon and startup ideas by relationship."},
    {c:"Open Knowledge",t:"Curiosity Thread Maps",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A platform charting question-to-question sequences that lead from curiosity to expertise."},
    {c:"Open Knowledge",t:"Best-in-Class Tool Registry",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A curated directory of the top tool for each purpose, organized by use case."},
    {c:"Coordination Infra",t:"Curated List Publishing",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Lets curators easily publish and distribute thematic lists and recommendations."},
    {c:"Personal Leverage",t:"Context Engineering Prize",s:"idea",u:"https://jacobcole.ai/brainstorms/",d:"A competition to get small models to frontier-level performance through better context."}
  ];
  (function(){
    var grid=document.getElementById('buildgrid'), filters=document.getElementById('filters');
    var labels={idea:["idea","💡 Idea"],building:["build","🔨 In progress"],done:["done","✅ Done"]};
    function render(f){
      grid.innerHTML='';
      BUILD.filter(function(b){return f==='all'||b.s===f}).forEach(function(b){
        var lab=labels[b.s]||["idea","Idea"];
        var ext=b.u?'<a class="ext" href="'+b.u+'" target="_blank" rel="noopener">↗ link</a>':'';
        var claim='<a class="claim" href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Claim →</a>';
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+lab[0]+'">'+lab[1]+'</span><div class="cat">'+b.c+'</div><h3>'+b.t+'</h3><p>'+b.d+'</p><div class="row">'+claim+ext+'</div>';
        grid.appendChild(el);
      });
    }
    filters.addEventListener('click',function(e){
      if(e.target.classList.contains('chip')){
        [].forEach.call(filters.children,function(c){c.classList.remove('active')});
        e.target.classList.add('active');
        render(e.target.getAttribute('data-f'));
      }
    });
    render('all');
  })();

  // ---- Live WIT-backed claim grid ----
  (function(){
    var WIT="https://api.worldissuetracker.com/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100";
    var grid=document.getElementById('witgrid');
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
    function issueUrl(i){try{return new URL(i.canonical_issue_url || ('/issue/'+encodeURIComponent(i.slug||'')), 'https://worldissuetracker.com').href}catch(e){return 'https://worldissuetracker.com/tracker/missing-civ-infrastructure'}}
    fetch(WIT).then(function(r){return r.json()}).then(function(d){
      var issues=(d.issues||d.data||[]).filter(function(i){return !i.deleted_at && i.status!=='closed'});
      if(!issues.length){grid.innerHTML='<div class="witloading">No open quests yet — <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">file the first one →</a></div>';return}
      issues.sort(function(a,b){return (b.votes||0)-(a.votes||0)});
      grid.innerHTML='';
      issues.forEach(function(i){
        var assignee=i.assignee_display_name;
        var action=assignee
          ? '<span class="claimedby">✓ Claimed by '+esc(assignee)+'</span>'
          : '<a class="claim" href="'+issueUrl(i)+'" target="_blank" rel="noopener">Claim →</a>';
        var votes=(i.votes!=null)?'<span class="votes">▲ '+i.votes+'</span>':'';
        var desc=esc((i.description||'').split(' Part of the Humanity')[0]).slice(0,150);
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+(assignee?'build':'idea')+'">'+(assignee?'🔨 Claimed':'💡 Open')+'</span>'
          +'<div class="cat">'+esc(i.category||'infrastructure')+'</div>'
          +'<h3><a href="'+issueUrl(i)+'" target="_blank" rel="noopener" style="color:inherit">'+esc(i.title)+'</a></h3>'
          +'<p>'+desc+'</p>'
          +'<div class="row">'+action+votes+'<a class="ext" href="'+issueUrl(i)+'" target="_blank" rel="noopener">↗ discuss</a></div>';
        grid.appendChild(el);
      });
    }).catch(function(){
      grid.innerHTML='<div class="witloading">Couldn’t load the live tracker. <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Open it directly →</a></div>';
    });
  })();

  (function(){
    var root=document.documentElement, btn=document.getElementById('themeBtn');
    var saved=null; try{saved=localStorage.getItem('h3-theme')}catch(e){}
    if(saved){root.setAttribute('data-theme',saved)}
    function sync(){btn.textContent=root.getAttribute('data-theme')==='dark'?'☀️':'🌙'}
    sync();
    btn.addEventListener('click',function(){
      var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
      root.setAttribute('data-theme',next);
      try{localStorage.setItem('h3-theme',next)}catch(e){}
      sync();
    });
  })();

  // ---- Contribute modal ----
  var mResult = null;
  function openContribute(){
    document.getElementById('contributeModal').classList.add('open');
    document.body.style.overflow='hidden';
  }
  function closeContribute(){
    document.getElementById('contributeModal').classList.remove('open');
    document.body.style.overflow='';
  }
  function closeContributeIfBg(e){
    if(e.target===document.getElementById('contributeModal')) closeContribute();
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape') closeContribute();});

  async function mRunAnalysis(){
    var btn=document.getElementById('m-analyzeBtn');
    var status=document.getElementById('m-status');
    var results=document.getElementById('m-results');
    var twitter=document.getElementById('m-twitter').value.trim();
    var linkedin=document.getElementById('m-linkedin').value.trim();
    var homepage=document.getElementById('m-homepage').value.trim();
    var about=document.getElementById('m-about').value.trim();
    if(!twitter&&!linkedin&&!homepage&&!about){status.textContent='Please fill in at least one field.';return;}
    btn.disabled=true;
    status.textContent='Gathering your profile data…';
    results.classList.remove('show');
    try{
      var res=await fetch('/contribute/analyze',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({twitter_handle:twitter,linkedin_url:linkedin,homepage_url:homepage,about_text:about})
      });
      var data=await res.json();
      if(data.error){status.textContent='⚠ '+data.error;btn.disabled=false;return;}
      mResult=data;
      mRenderResults(data);
      status.textContent=data.sources&&data.sources.length?'Analyzed from: '+data.sources.join(', '):'';
      results.classList.add('show');
    }catch(e){status.textContent='Something went wrong. Try again?';}
    btn.disabled=false;
  }

  function mRenderResults(data){
    document.getElementById('m-profile').innerHTML=
      '<div class="m-profile-name">'+(data.name||'You')+'</div>'
      +'<div class="m-profile-role">'+(data.top_role||'')+'</div>'
      +'<div class="m-profile-bio">'+(data.summary||'')+'</div>';
    document.getElementById('m-matches').innerHTML=(data.matches||[]).map(function(m){
      return '<div class="m-match">'
        +'<div class="m-match-name">'+m.project+'</div>'
        +'<div class="m-match-fit">'+m.fit+'</div>'
        +'<div class="m-match-quest">Quest: '+m.quest+'</div>'
        +'<a class="m-match-link" href="'+m.url+'" target="_blank" rel="noopener">'+m.url+' ↗</a>'
        +'</div>';
    }).join('');
  }

  function mSaveFallback(ok){
    var r=mResult||{};var title='Contributor profile: '+(r.name||document.getElementById('m-twitter').value.trim()||'new contributor');
    var body='## About me\\n'+(r.summary||'')+'\\n\\n## Role\\n'+(r.top_role||'')+'\\n\\n(Posted from humanityinfrastructure.com because saving to the tracker failed.)';
    var gh='https://github.com/tmad4000/humanity-infrastructure/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    var mail='mailto:jacob@ideaflow.io?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    ok.innerHTML='Couldn’t save to the tracker right now. Your profile isn’t lost: <a href="'+gh+'" target="_blank" rel="noopener">post it as a GitHub issue</a> or <a href="'+mail+'">email it to us</a>.';
    ok.classList.add('show');
  }
  async function mSave(){
    var btn=document.getElementById('m-saveBtn');
    var ok=document.getElementById('m-saveOk');
    if(!mResult) return;
    btn.disabled=true; btn.textContent='Saving…';
    try{
      var res=await fetch('/contribute/save',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({},mResult,{handle:document.getElementById('m-twitter').value.trim()||document.getElementById('m-linkedin').value.trim()}))
      });
      var data=await res.json();
      if(data.success){btn.style.display='none';ok.textContent='✓ Saved! View at worldissuetracker.com/tracker/hi-contributors';ok.classList.add('show');}
      else{btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
    }catch(e){btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
  }
</script>
</body>
</html>
`
const V2_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Humanity Infrastructure — Open Infrastructure for Human Flourishing</title>
<meta name="description" content="We build the missing civilization layer. Tools, knowledge systems and coordination infrastructure: free to use, open where possible." />
<meta property="og:title" content="Humanity Infrastructure" />
<meta property="og:description" content="Open infrastructure for human flourishing. We build the missing civilization layer." />
<meta property="og:type" content="website" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,700;1,6..72,300;1,6..72,400&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --bg: #0b0e15;
  --bg-2: #101520;
  --bg-3: #161d2b;
  --card: #131929;
  --card-h: #192034;
  --text: #e2e6ef;
  --muted: #7e8ba3;
  --faint: #434d63;
  --a1: #e8b84b;   /* amber */
  --a2: #5b9cf6;   /* blue */
  --a3: #5fd3a8;   /* green */
  --border: rgba(255,255,255,.07);
  --border2: rgba(255,255,255,.13);
  --max: 1100px;
  --serif: 'Newsreader', Georgia, serif;
  --mono: 'IBM Plex Mono', monospace;
  --sans: 'IBM Plex Sans', -apple-system, sans-serif;
}
[data-theme="light"] {
  --bg: #f5f4ef;
  --bg-2: #eeede6;
  --bg-3: #e7e5db;
  --card: #ffffff;
  --card-h: #f7f6f0;
  --text: #131620;
  --muted: #4a5370;
  --faint: #9097ac;
  --a1: #b8860b;
  --a2: #2a5bc4;
  --a3: #0a7a52;
  --border: rgba(0,0,0,.09);
  --border2: rgba(0,0,0,.17);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 96px; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

/* ── Blueprint grid background ─────────────────────────── */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(91,156,246,.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(91,156,246,.04) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  z-index: 0;
}
[data-theme="light"] body::before {
  background-image:
    linear-gradient(rgba(42,91,196,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42,91,196,.05) 1px, transparent 1px);
}

a { color: var(--a2); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: var(--max); margin: 0 auto; padding: 0 28px; position: relative; z-index: 1; }

/* ── Nav ────────────────────────────────────────────────── */
nav {
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: saturate(180%) blur(14px);
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  border-bottom: 1px solid var(--border);
}
nav .wrap {
  display: flex; align-items: center;
  justify-content: space-between; height: 64px; gap: 16px;
}
.brand {
  display: flex; align-items: center; gap: 12px;
  font-family: var(--mono); font-size: .92rem;
  font-weight: 600; color: var(--text); letter-spacing: .01em;
}
.brand-mark {
  width: 34px; height: 34px;
  background: var(--a1);
  border-radius: 8px;
  display: grid; place-items: center;
  font-size: .9rem; flex: none;
}
.brand-name { line-height: 1.2; }
.brand-name em { display: block; font-style: normal; font-size: .65rem; color: var(--muted); font-weight: 400; letter-spacing: .06em; text-transform: uppercase; }
.nav-links { display: flex; gap: 24px; align-items: center; }
.nav-links a { color: var(--muted); font-size: .88rem; font-weight: 500; font-family: var(--mono); transition: color .12s; white-space: nowrap; }
.nav-links a:hover { color: var(--text); text-decoration: none; }
.theme-btn {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--text); width: 36px; height: 36px; border-radius: 9px;
  cursor: pointer; font-size: .95rem; display: grid; place-items: center;
  transition: background .12s;
}
.theme-btn:hover { background: var(--card-h); }
@media(max-width:1040px) { .nav-links a:not(.cta):not(.gh) { display: none; } }

/* ── Hero ───────────────────────────────────────────────── */
header.hero {
  padding: 100px 0 72px;
  position: relative;
  overflow: hidden;
}
header.hero::after {
  content: '';
  position: absolute;
  top: -60px; right: -120px;
  width: 700px; height: 700px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232,184,75,.08) 0%, transparent 70%);
  pointer-events: none;
}
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: .72rem; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; color: var(--a1);
  border: 1px solid rgba(232,184,75,.25);
  padding: 7px 14px; border-radius: 4px;
  margin-bottom: 30px; background: rgba(232,184,75,.06);
}
.eyebrow::before {
  content: ''; width: 6px; height: 6px;
  background: var(--a1); border-radius: 50%;
  animation: blink 2s ease-in-out infinite;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

h1 {
  font-family: var(--serif); font-size: clamp(3rem,7vw,5.5rem);
  font-weight: 300; line-height: 1.02; letter-spacing: -.02em;
  margin: 0 0 28px; max-width: 840px;
}
h1 strong { font-weight: 700; color: var(--a1); }
h1 em { font-style: italic; color: var(--text); }

.lede {
  font-size: clamp(1.05rem,2.2vw,1.3rem); color: var(--muted);
  max-width: 680px; margin: 0 0 14px; line-height: 1.7;
  font-family: var(--serif);
}
.sub {
  font-family: var(--mono); font-size: .82rem; color: var(--faint);
  margin: 0 0 40px;
}
.btns { display: flex; gap: 12px; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 22px; border-radius: 6px; font-weight: 600;
  font-size: .95rem; font-family: var(--mono); border: 1px solid transparent;
  cursor: pointer; transition: transform .12s ease, box-shadow .12s ease;
  text-decoration: none;
}
.btn:hover { transform: translateY(-2px); text-decoration: none; }
.btn.primary {
  background: var(--a1); color: #0b0e15;
  box-shadow: 0 4px 20px rgba(232,184,75,.3);
}
.btn.primary:hover { box-shadow: 0 6px 28px rgba(232,184,75,.4); }
.btn.ghost {
  background: transparent; border-color: var(--border2); color: var(--text);
}
.btn.ghost:hover { background: var(--card); }

/* ── Section chrome ─────────────────────────────────────── */
section { padding: 72px 0; border-top: 1px solid var(--border); position: relative; z-index: 1; }
.sect-label {
  font-family: var(--mono); font-size: .68rem; font-weight: 600;
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--a1); margin-bottom: 14px;
  display: flex; align-items: center; gap: 10px;
}
.sect-label::after {
  content: ''; flex: 1; max-width: 60px; height: 1px; background: rgba(232,184,75,.3);
}
.sect-h {
  font-family: var(--serif); font-size: clamp(1.8rem,3.8vw,2.8rem);
  font-weight: 400; letter-spacing: -.02em; margin: 0 0 14px; line-height: 1.1;
}
.sect-h em { font-style: italic; color: var(--a1); }
.sect-p { color: var(--muted); font-size: 1.02rem; max-width: 680px; margin: 0 0 44px; font-family: var(--serif); }

/* ── Pillars ────────────────────────────────────────────── */
.pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.pillar {
  background: var(--card); padding: 28px 26px;
  transition: background .14s;
}
.pillar:hover { background: var(--card-h); }
.pillar-num {
  font-family: var(--mono); font-size: .68rem; color: var(--a1);
  font-weight: 600; letter-spacing: .1em; margin-bottom: 16px;
}
.pillar h3 {
  font-family: var(--serif); font-size: 1.15rem; font-weight: 400;
  margin: 0 0 10px; line-height: 1.25;
}
.pillar p { color: var(--muted); font-size: .9rem; line-height: 1.6; }

/* ── Tools grid ─────────────────────────────────────────── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.tcard {
  display: block; background: var(--card); padding: 24px;
  transition: background .14s ease; position: relative;
  text-decoration: none;
}
.tcard:hover { background: var(--card-h); text-decoration: none; }
.tcard-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.tcard-icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: var(--bg-2); display: grid; place-items: center;
  font-size: 1.4rem; flex: none; border: 1px solid var(--border);
}
.tag {
  font-family: var(--mono); font-size: .6rem; font-weight: 600;
  letter-spacing: .07em; text-transform: uppercase;
  padding: 4px 9px; border-radius: 4px;
}
.tag.live { background: rgba(95,211,168,.1); color: var(--a3); border: 1px solid rgba(95,211,168,.25); }
.tag.build { background: rgba(232,184,75,.1); color: var(--a1); border: 1px solid rgba(232,184,75,.25); }
.tag.idea { background: rgba(91,156,246,.1); color: var(--a2); border: 1px solid rgba(91,156,246,.25); }
.tcard h3 { font-family: var(--serif); font-size: 1.12rem; font-weight: 400; color: var(--text); margin: 0 0 6px; }
.tcard .url { font-family: var(--mono); font-size: .72rem; color: var(--a2); margin-bottom: 10px; display: block; }
.tcard p { color: var(--muted); font-size: .88rem; line-height: 1.55; }

/* ── Build list ─────────────────────────────────────────── */
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
.chip {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--muted); padding: 7px 16px; border-radius: 4px;
  font-size: .8rem; font-weight: 600; font-family: var(--mono);
  cursor: pointer; transition: all .12s ease;
}
.chip:hover { background: var(--card-h); color: var(--text); }
.chip.active { background: var(--a1); color: #0b0e15; border-color: var(--a1); }
.bcard {
  background: var(--card); border-top: 1px solid var(--border);
  padding: 18px 20px; display: flex; flex-direction: column;
  gap: 6px; position: relative; transition: background .12s;
}
.bcard:hover { background: var(--card-h); }
.bcard:first-child { border-radius: 8px 8px 0 0; border-top: none; }
.bcard .cat { font-family: var(--mono); font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
.bcard h3 { font-family: var(--serif); margin: 0; font-size: 1rem; font-weight: 400; padding-right: 80px; }
.bcard p { margin: 0; color: var(--muted); font-size: .87rem; }
.bcard .row { display: flex; align-items: center; gap: 14px; margin-top: 2px; }
.bcard .claim { font-family: var(--mono); font-size: .78rem; font-weight: 600; color: var(--a3); }
.bcard a.ext { font-family: var(--mono); font-size: .76rem; color: var(--faint); }
.bcards-wrap { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.buildnote { margin-top: 24px; color: var(--faint); font-size: .88rem; text-align: center; font-family: var(--mono); }
.claim-head { margin: 52px 0 20px; }
.claim-head h3 {
  font-family: var(--serif); font-size: 1.5rem; font-weight: 400;
  margin: 0 0 8px; display: flex; align-items: center; gap: 12px;
}
.claim-head p { color: var(--muted); font-size: .95rem; font-family: var(--serif); }
.livedot {
  width: 9px; height: 9px; border-radius: 50%; background: #ef5f5f; display: inline-block;
  box-shadow: 0 0 0 0 rgba(239,95,95,.5); animation: pulse 2s infinite;
}
@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(239,95,95,.5)} 70%{box-shadow:0 0 0 8px rgba(239,95,95,0)} 100%{box-shadow:0 0 0 0 rgba(239,95,95,0)} }
.witloading { color: var(--faint); padding: 32px; text-align: center; font-family: var(--mono); font-size: .85rem; }

/* ── Blockquote ─────────────────────────────────────────── */
blockquote {
  margin: 0; background: var(--card); border: 1px solid var(--border);
  border-left: 3px solid var(--a1); border-radius: 0 10px 10px 0;
  padding: 28px 32px;
  font-family: var(--serif); font-size: 1.15rem; font-weight: 300;
  color: var(--text); font-style: italic; line-height: 1.65;
}
blockquote cite {
  display: block; margin-top: 16px; font-size: .88rem;
  color: var(--faint); font-style: normal; font-family: var(--mono);
}

/* ── Resource links ─────────────────────────────────────── */
.links-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.lcol { background: var(--card); padding: 22px; }
.lcol h4 { font-family: var(--mono); font-size: .75rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 14px; }
.lcol ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.lcol li a { color: var(--muted); font-size: .88rem; font-family: var(--serif); transition: color .12s; }
.lcol li a:hover { color: var(--a2); }

/* ── CTA band ───────────────────────────────────────────── */
.cta-band {
  border: 1px solid var(--border2); border-radius: 14px;
  padding: 52px 48px; text-align: center;
  background: linear-gradient(135deg, rgba(232,184,75,.06) 0%, rgba(91,156,246,.05) 100%);
  position: relative; overflow: hidden;
}
.cta-band::before {
  content: '';
  position: absolute; bottom: -60px; right: -60px;
  width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle, rgba(91,156,246,.08) 0%, transparent 70%);
}
.cta-band h2 { font-family: var(--serif); font-size: clamp(1.6rem,3.5vw,2.4rem); font-weight: 300; margin: 0 0 14px; letter-spacing: -.02em; }
.cta-band h2 strong { font-weight: 700; }
.cta-band p { color: var(--muted); max-width: 600px; margin: 0 auto 30px; font-size: 1.02rem; font-family: var(--serif); }

/* ── Footer ─────────────────────────────────────────────── */
footer { padding: 48px 0 60px; border-top: 1px solid var(--border); }
footer .wrap { display: flex; flex-direction: column; gap: 36px; }
.footer-top { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.footer-brand { display: flex; align-items: center; gap: 10px; }
.footer-brand .brand-mark { width: 28px; height: 28px; font-size: .75rem; border-radius: 6px; }
.footer-brand span { font-family: var(--mono); font-size: .88rem; color: var(--muted); }
.footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
.footer-links a { font-family: var(--mono); font-size: .8rem; color: var(--faint); }
.footer-links a:hover { color: var(--muted); }

/* ── Humanity³ legacy section ───────────────────────────── */
.legacy {
  border-top: 1px solid var(--border);
  padding: 28px 0 0; margin-top: 8px;
}
.legacy-inner {
  display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 6px 20px; opacity: .55;
}
.legacy-label {
  font-family: var(--mono); font-size: .68rem; letter-spacing: .12em;
  text-transform: uppercase; color: var(--faint);
}
.legacy-links { display: flex; flex-wrap: wrap; gap: 14px; }
.legacy-links a { font-family: var(--mono); font-size: .75rem; color: var(--faint); }
.legacy-links a:hover { color: var(--muted); opacity: 1; }

/* ── Scroll entrance ────────────────────────────────────── */
.reveal { opacity: 0; transform: translateY(16px); transition: opacity .5s ease, transform .5s ease; }
.reveal.in { opacity: 1; transform: none; }
</style>
</head>
<body>

<nav><div class="wrap">
  <a class="brand" href="#top">
    <div class="brand-mark">⚡</div>
    <div class="brand-name">
      Humanity Infrastructure
      <em>Open Civilization Layer</em>
    </div>
  </a>
  <div class="nav-links">
    <a class="gh" href="https://github.com/tmad4000/humanity-infrastructure" target="_blank" rel="noopener">GitHub ↗</a>
    <a href="#mission">Mission</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">Resources</a>
    <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <div class="eyebrow">Infrastructure for Human Flourishing</div>
  <h1>We build the missing<br/><em>civilization layer.</em></h1>
  <p class="lede">Tools, knowledge systems and coordination infrastructure: free to use, open where possible. The not-just-engineering equivalent of the open-source movement.</p>
  <p class="sub">// knowledge as a birthright · tools that make people independent · coordinating as a superorganism</p>
  <div class="btns">
    <a class="btn primary" href="#tools">Explore the infrastructure →</a>
    <a class="btn ghost" href="#mission">Read the mission</a>
  </div>
</div></header>

<section id="mission"><div class="wrap">
  <div class="sect-label">The Mission</div>
  <h2 class="sect-h">Imagine it were everyone's birthright<br/>to access the <em>sum-total of human know-how.</em></h2>
  <p class="sect-p">Humanity Infrastructure is a hub of knowledge resources and open-source tools — built to bring flourishing into every person's reach. We envision something most of the developed world eventually becomes part of, to a greater or lesser degree.</p>
  <div class="pillars reveal">
    <div class="pillar">
      <div class="pillar-num">01 — Knowledge</div>
      <h3>Knowledge as a public good</h3>
      <p>Survival and thriving guides, medical know-how, open curricula, role-model casting, the craftsmanship of software. Shouldn't tools from 10 years ago be free by now?</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">02 — Tools</div>
      <h3>Tools that make people independent</h3>
      <p>Open reputation systems, collective-action infrastructure, personal-leverage automation, assistive tech. Hacked-together infrastructure that helps people help themselves.</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">03 — Coordination</div>
      <h3>Coordinate as a superorganism</h3>
      <p>Guilds taking on epic quests. Global sense-making. Volunteerism and philanthropy for everyone — ways to pitch in on the problems that matter, together.</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">04 — Flourishing</div>
      <h3>Flourishing in reach for all</h3>
      <p>From "how to thrive as a highly sensitive person on a budget" to "how to rebuild society from scratch." Compassionate, practical, and free.</p>
    </div>
  </div>
</div></section>

<section id="tools"><div class="wrap">
  <div class="sect-label">Working Infrastructure</div>
  <h2 class="sect-h">Pieces that <em>already exist.</em></h2>
  <p class="sect-p">Find tools for practical needs. Free to use. Open where possible. Featured listings show their license. <a href="#submit">Suggest a resource →</a></p>
  <div class="grid reveal">
    <a id="lastbook" class="tcard" href="https://lastbook.org" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📖</div><span class="tag live">Featured</span></div>
      <h3>Lastbook</h3><span class="url">lastbook.org</span>
      <p>A free, open-source offline library of practical manuals, videos and maps, with optional local AI. Knowledge for preparedness and rebuilding, available after setup without an internet connection.</p>
      <p>Knowledge that survives when the internet doesn't. Open source (MIT) · Mac, Windows, Linux.</p>
    </a>
    <a id="paxi" class="tcard" href="https://paxi.fyi" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🚕</div><span class="tag live">Featured</span></div>
      <h3>Paxi</h3><span class="url">paxi.fyi</span>
      <p>Compares live ride prices and times across Uber, Lyft, Waymo, Tesla, Zoox, Curb and more, then books the one you choose.</p>
      <p>Use the best service for each task, without interface lock-in. Free · closed source · iPhone · by Doug Feigelson, a friend of the maintainer.</p>
    </a>
    <a class="tcard" href="https://nvctranslator.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🕊️</div><span class="tag live">Live</span></div>
      <h3>NVC Translator</h3>
      <span class="url">nvctranslator.com</span>
      <p>Translate any text into Marshall Rosenberg's Nonviolent Communication. How can AI make us more compassionate?</p>
    </a>
    <a class="tcard" href="https://globalbr.ai" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🧠</div><span class="tag live">Live</span></div>
      <h3>Noos</h3>
      <span class="url">globalbr.ai</span>
      <p>A universal knowledge graph — the "codex" backend. Capture, connect, and query human know-how with per-node privacy.</p>
    </a>
    <a class="tcard" href="https://wikihub.md" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📚</div><span class="tag live">Live</span></div>
      <h3>WikiHub</h3>
      <span class="url">wikihub.md</span>
      <p>GitHub for LLM wikis. Hosting for open, agent-native markdown knowledge bases — forkable, shareable, version-controlled.</p>
    </a>
    <a class="tcard" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🌐</div><span class="tag live">Live</span></div>
      <h3>World Issue Tracker</h3>
      <span class="url">worldissuetracker.com</span>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
    </a>
    <a id="signudoc" class="tcard" href="https://github.com/NYLLON-SOFTWARE/SignuDoc" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">✍️</div><span class="tag live">Featured</span></div>
      <h3>SignuDoc</h3><span class="url">github.com/NYLLON-SOFTWARE/SignuDoc</span>
      <p>Open-source e-signatures. Send, sign and seal documents from your own cloud at $0 per seat, with audit trails and tamper-evident seals.</p>
      <p>Open document signing infrastructure. Open source (MIT) · self-hosted on Vercel · by Kevin Rose / NYLLON.</p>
    </a>
    <a class="tcard" href="https://tmad4000.github.io/brainstorms/" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">💡</div><span class="tag live">Live</span></div>
      <h3>Idea List</h3>
      <span class="url">tmad4000.github.io/brainstorms</span>
      <p>An open idea bank — projects, hackathon ideas, and easily-solvable world problems, free for anyone to take and build.</p>
    </a>
    <a class="tcard" href="https://github.com/tmad4000/claude-mind" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🔬</div><span class="tag live">Live</span></div>
      <h3>Claude Mind</h3>
      <span class="url">github.com/tmad4000/claude-mind</span>
      <p>Collaborative AI–human exploration of open problems — guilds working the quests, Polymath-style.</p>
    </a>
    <a class="tcard" href="https://github.com/tmad4000/vibe-coding-guide" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">⚡</div><span class="tag live">Live</span></div>
      <h3>Vibe Coding Guide</h3>
      <span class="url">github.com/tmad4000/vibe-coding-guide</span>
      <p>Open guide to AI-assisted coding — making the craftsmanship of software buildable by everyone.</p>
    </a>
  </div>
</div></section>

<section><div class="wrap">
  <blockquote class="reveal">
    "We need these tools, all of them, and to be honest with you, they need to be in the hands of everybody… When humans come into guilds to do epic quests, they're problem-solving, they're inventing a solution. That's how this planet's going to get fixed."
    <cite>— Jack Park, on guilds &amp; global sense-making</cite>
  </blockquote>
</div></section>

<section id="buildlist"><div class="wrap">
  <div class="sect-label">The Open Build List</div>
  <h2 class="sect-h">What still needs to <em>be built.</em></h2>
  <p class="sect-p">The infrastructure for human flourishing is mostly <em>not built yet.</em> Below is the running list — ideas, works-in-progress, and what's done. See one you want to build? <strong>Claim it.</strong></p>
  <div class="filters" id="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="idea">💡 Ideas</button>
    <button class="chip" data-f="building">🔨 In progress</button>
    <button class="chip" data-f="done">✅ Done</button>
  </div>
  <div class="bcards-wrap">
    <div id="buildgrid"></div>
  </div>
  <p class="buildnote">This list is open. Add an idea or claim one on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Missing Civilization Infrastructure</a> board — or email <a href="mailto:jacobcole4000@gmail.com">jacobcole4000@gmail.com</a>.</p>

  <div class="claim-head reveal">
    <h3><span class="livedot"></span> &nbsp;Claim a quest — live from the tracker</h3>
    <p>These ideas are filed as real, public issues on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">World Issue Tracker</a>. Vote, discuss, or claim one to build — updates in real time.</p>
  </div>
  <div class="bcards-wrap" style="margin-top:16px">
    <div id="witgrid"><div class="witloading">Loading open quests from the tracker…</div></div>
  </div>
</div></section>

<section id="vision"><div class="wrap">
  <div class="sect-label">The Living Document</div>
  <h2 class="sect-h">The full vision — and <em>where to add to it.</em></h2>
  <p class="sect-p">Humanity Infrastructure is an open, growing project. These are the canonical sources. Add yourself, add a project, add a resource.</p>
  <div class="links-cols reveal">
    <div class="lcol">
      <h4>📜 Read the source</h4>
      <ul>
        <li><a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Humanity 3.0 &amp; the Dharmic blueprint</a></li>
        <li><a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">The Codex — master doc (Google Docs)</a></li>
        <li><a href="https://plausible-text-76b.notion.site/Cody-s-Healing-List-v4-b05b097d529c4c54b5d62f87f55b1f6f" target="_blank" rel="noopener">Healing Resources — "Cody Codex"</a></li>
        <li><a href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">World Quest Guild — add yourself</a><br/><small>Short link: <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</small></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="https://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="https://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="https://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="https://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="https://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="https://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="https://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="https://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="https://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="https://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
        <li><a href="https://education.jacobcole.net" target="_blank" rel="noopener">Education resources</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="submit"><div class="wrap">
  <h2>What else should be featured?</h2>
  <p>Help grow Humanity Infrastructure. Suggest useful tools, open knowledge, practical guides or projects that help people flourish. You do not need to be a developer.</p>
  <p>Send the name, link, a short description and who it helps. Include access or licensing details and any affiliation. We review suggestions before featuring them.</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0">
    <a class="btn primary" href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml">Suggest a resource on GitHub →</a>
    <a class="btn ghost" href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure%20resource%20suggestion&amp;body=Name%3A%0ALink%3A%0AWho%20it%20helps%3A%0AAccess%20or%20license%3A%0AMy%20affiliation%3A">Suggest by email</a>
    <a class="btn ghost" href="https://github.com/tmad4000/humanity-infrastructure/blob/main/CONTRIBUTING.md">Contribute a pull request →</a>
  </div>
  <p><a href="https://github.com/tmad4000/humanity-infrastructure">Browse the website source on GitHub</a> · <a href="https://worldissuetracker.com/tracker/lastbook">Lastbook community feedback and fixes</a></p>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band reveal">
    <h2>Help us build the <strong>missing infrastructure.</strong></h2>
    <p>This project is open to contributors, builders, and anyone who believes the tools for flourishing should be free. Pick a quest, claim an idea, or just use the tools and tell others.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Browse open quests →</a>
      <a class="btn ghost" href="mailto:jacobcole4000@gmail.com">Get in touch</a>
    </div>
  </div>
</div></section>

<footer><div class="wrap">
  <p>v0.4.0 · 2026-11-17</p>
  <div class="footer-top">
    <div class="footer-brand">
      <div class="brand-mark">⚡</div>
      <span>Humanity Infrastructure</span>
    </div>
    <div class="footer-links">
      <a href="#mission">Mission</a>
      <a href="#tools">Tools</a>
      <a href="#buildlist">Build List</a>
      <a href="#vision">Resources</a>
      <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
      <a href="mailto:jacobcole4000@gmail.com">Contact</a>
    </div>
  </div>

  <!-- Humanity³ legacy links — subtle -->
  <div class="legacy">
    <div class="legacy-inner" style="flex-direction:column;gap:12px;align-items:flex-start;">
      <div style="display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;">
        <span class="legacy-label">Design versions →</span>
        <div class="legacy-links">
          <a href="/v2">v2 — Editorial / Red (current)</a>
          <a href="/v3">v3 — Dark Blueprint</a>
          <a href="/">v1 — Original / Dark</a>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;">
        <span class="legacy-label">Previously at humanity3.earth →</span>
        <div class="legacy-links">
          <a href="https://humanity3.earth" target="_blank" rel="noopener">humanity3.earth</a>
          <a href="https://humanity3.earth#manifesto" target="_blank" rel="noopener">The Codex</a>
          <a href="https://humanity3.earth#tools" target="_blank" rel="noopener">Tools</a>
          <a href="https://humanity3.earth#buildlist" target="_blank" rel="noopener">Build List</a>
          <a href="https://humanity3.earth#vision" target="_blank" rel="noopener">Vision</a>
        </div>
      </div>
    </div>
  </div>
</div></footer>

<script>
/* ── Theme toggle ── */
const themeBtn = document.getElementById('themeBtn');
const stored = localStorage.getItem('hi-theme');
if (stored) { document.documentElement.setAttribute('data-theme', stored); themeBtn.textContent = stored === 'light' ? '🌙' : '☀️'; }
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
  localStorage.setItem('hi-theme', next);
});

/* ── Scroll reveal ── */
const observer = new IntersectionObserver(els => {
  els.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); } });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── Build list data ── */
const BUILD_ITEMS = [
  { cat:'knowledge', title:'Universal survival guide', desc:'From food & shelter to emotional regulation — the knowledge every human needs, in every language.', status:'idea' },
  { cat:'coordination', title:'Open reputation system', desc:'Portable, cross-platform reputation that travels with you — not locked to one silo.', status:'idea' },
  { cat:'health', title:'Open chronic-pain protocol', desc:'Aggregated evidence-based treatments for common chronic conditions, freely editable.', status:'building', url:'https://chronicpain.jacobcole.net/' },
  { cat:'coordination', title:'Volunteerism marketplace', desc:'Match people who want to help with tasks that need doing — a Craigslist for good deeds.', status:'idea' },
  { cat:'knowledge', title:'Open meditation curricula', desc:'Secular, evidence-based meditation courses — from beginner to advanced, free forever.', status:'done', url:'https://meditation.jacobcole.net/' },
  { cat:'tools', title:'Collective action toolkit', desc:'Lower the barrier to coordinating groups around shared goals — pledges, commitments, accountability.', status:'building', url:'https://thunderpledge.jacobcole.net' },
  { cat:'knowledge', title:'How to eat well (open guide)', desc:'Evidence-based nutrition guide with community editing and regional adaptations.', status:'done', url:'https://foodslist.jacobcole.net/' },
  { cat:'tools', title:'Personal knowledge graph for everyone', desc:'Noos but for non-technical users — a simple interface for connected notes and learning.', status:'building', url:'https://globalbr.ai' },
  { cat:'coordination', title:'Open skill-matching', desc:'Connect people who need help with people who have the skill — like LinkedIn but free and open.', status:'idea' },
  { cat:'tools', title:'NVC Translator for teams', desc:'Extend NVC Translator to async team contexts — Slack/email de-escalation at scale.', status:'idea' },
];

let activeFilter = 'all';
const filterMap = { idea:['idea'], building:['building'], done:['done'] };

function renderBuildList() {
  const grid = document.getElementById('buildgrid');
  const items = activeFilter === 'all' ? BUILD_ITEMS : BUILD_ITEMS.filter(i => (filterMap[activeFilter]||[]).includes(i.status));
  if (!items.length) { grid.innerHTML = '<div class="witloading">No items in this category yet.</div>'; return; }
  grid.innerHTML = items.map(item => \`
    <div class="bcard" data-status="\${item.status}">
      <div class="cat">\${item.cat}</div>
      <h3>\${item.title}</h3>
      \${item.desc ? \`<p>\${item.desc}</p>\` : ''}
      <div class="row">
        <span class="claim">\${item.status === 'done' ? '✅ Done' : item.status === 'building' ? '🔨 In progress' : '→ Available to claim'}</span>
        \${item.url ? \`<a class="ext" href="\${item.url}" target="_blank" rel="noopener">↗ See it</a>\` : ''}
      </div>
    </div>\`).join('');
}

document.getElementById('filters').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeFilter = chip.dataset.f;
  renderBuildList();
});

renderBuildList();

/* ── Live WIT issues ── */
async function loadWIT() {
  const grid = document.getElementById('witgrid');
  try {
    const res = await fetch('https://api.worldissuetracker.com/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const issues = (data.issues || data.data || []).filter(i => !i.deleted_at && i.status !== 'closed')
      .sort((a,b) => (b.votes||0) - (a.votes||0)).slice(0, 6)
      .map(i => ({ ...i, title: esc(i.title), description: esc((i.description||'').split(' Part of the Humanity')[0]), url: (() => { try { return new URL(i.canonical_issue_url || ('/issue/' + encodeURIComponent(i.slug || '')), 'https://worldissuetracker.com').href } catch { return 'https://worldissuetracker.com/tracker/missing-civ-infrastructure' } })(), id: '' }));
    if (!issues.length) { grid.innerHTML = '<div class="witloading">No open quests right now — check back soon.</div>'; return; }
    grid.innerHTML = issues.map(i => \`
      <div class="bcard">
        <div class="cat">Open quest</div>
        <h3>\${i.title}</h3>
        \${i.description ? \`<p>\${i.description.slice(0,180)}\${i.description.length>180?'…':''}</p>\` : ''}
        <div class="row">
          <span class="claim">→ Available to claim</span>
          <a class="ext" href="\${i.url||'https://missing-civ-infrastructure.worldissuetracker.com/'}" target="_blank" rel="noopener">↗ View on WIT</a>
        </div>
      </div>\`).join('');
  } catch {
    grid.innerHTML = '<div class="witloading">Could not load live quests — <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">view them on the tracker ↗</a></div>';
  }
}
loadWIT();
</script>
</body>
</html>
`
const V3_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Humanity Infrastructure — Open Infrastructure for Human Flourishing</title>
<meta name="description" content="We build the missing civilization layer. Tools, knowledge systems and coordination infrastructure: free to use, open where possible." />
<meta property="og:title" content="Humanity Infrastructure" />
<meta property="og:description" content="Open infrastructure for human flourishing. We build the missing civilization layer." />
<meta property="og:type" content="website" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,700;1,6..72,300;1,6..72,400&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --bg: #0b0e15;
  --bg-2: #101520;
  --bg-3: #161d2b;
  --card: #131929;
  --card-h: #192034;
  --text: #e2e6ef;
  --muted: #7e8ba3;
  --faint: #434d63;
  --a1: #e8b84b;   /* amber */
  --a2: #5b9cf6;   /* blue */
  --a3: #5fd3a8;   /* green */
  --border: rgba(255,255,255,.07);
  --border2: rgba(255,255,255,.13);
  --max: 1100px;
  --serif: 'Newsreader', Georgia, serif;
  --mono: 'IBM Plex Mono', monospace;
  --sans: 'IBM Plex Sans', -apple-system, sans-serif;
}
[data-theme="light"] {
  --bg: #f5f4ef;
  --bg-2: #eeede6;
  --bg-3: #e7e5db;
  --card: #ffffff;
  --card-h: #f7f6f0;
  --text: #131620;
  --muted: #4a5370;
  --faint: #9097ac;
  --a1: #b8860b;
  --a2: #2a5bc4;
  --a3: #0a7a52;
  --border: rgba(0,0,0,.09);
  --border2: rgba(0,0,0,.17);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 96px; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

/* ── Blueprint grid background ─────────────────────────── */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(91,156,246,.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(91,156,246,.04) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  z-index: 0;
}
[data-theme="light"] body::before {
  background-image:
    linear-gradient(rgba(42,91,196,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42,91,196,.05) 1px, transparent 1px);
}

a { color: var(--a2); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: var(--max); margin: 0 auto; padding: 0 28px; position: relative; z-index: 1; }

/* ── Nav ────────────────────────────────────────────────── */
nav {
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: saturate(180%) blur(14px);
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  border-bottom: 1px solid var(--border);
}
nav .wrap {
  display: flex; align-items: center;
  justify-content: space-between; height: 64px; gap: 16px;
}
.brand {
  display: flex; align-items: center; gap: 12px;
  font-family: var(--mono); font-size: .92rem;
  font-weight: 600; color: var(--text); letter-spacing: .01em;
}
.brand-mark {
  width: 34px; height: 34px;
  background: var(--a1);
  border-radius: 8px;
  display: grid; place-items: center;
  font-size: .9rem; flex: none;
}
.brand-name { line-height: 1.2; }
.brand-name em { display: block; font-style: normal; font-size: .65rem; color: var(--muted); font-weight: 400; letter-spacing: .06em; text-transform: uppercase; }
.nav-links { display: flex; gap: 24px; align-items: center; }
.nav-links a { color: var(--muted); font-size: .88rem; font-weight: 500; font-family: var(--mono); transition: color .12s; white-space: nowrap; }
.nav-links a:hover { color: var(--text); text-decoration: none; }
.theme-btn {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--text); width: 36px; height: 36px; border-radius: 9px;
  cursor: pointer; font-size: .95rem; display: grid; place-items: center;
  transition: background .12s;
}
.theme-btn:hover { background: var(--card-h); }
@media(max-width:1040px) { .nav-links a:not(.cta):not(.gh) { display: none; } }

/* ── Hero ───────────────────────────────────────────────── */
header.hero {
  padding: 100px 0 72px;
  position: relative;
  overflow: hidden;
}
header.hero::after {
  content: '';
  position: absolute;
  top: -60px; right: -120px;
  width: 700px; height: 700px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232,184,75,.08) 0%, transparent 70%);
  pointer-events: none;
}
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: .72rem; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; color: var(--a1);
  border: 1px solid rgba(232,184,75,.25);
  padding: 7px 14px; border-radius: 4px;
  margin-bottom: 30px; background: rgba(232,184,75,.06);
}
.eyebrow::before {
  content: ''; width: 6px; height: 6px;
  background: var(--a1); border-radius: 50%;
  animation: blink 2s ease-in-out infinite;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

h1 {
  font-family: var(--serif); font-size: clamp(3rem,7vw,5.5rem);
  font-weight: 300; line-height: 1.02; letter-spacing: -.02em;
  margin: 0 0 28px; max-width: 840px;
}
h1 strong { font-weight: 700; color: var(--a1); }
h1 em { font-style: italic; color: var(--text); }

.lede {
  font-size: clamp(1.05rem,2.2vw,1.3rem); color: var(--muted);
  max-width: 680px; margin: 0 0 14px; line-height: 1.7;
  font-family: var(--serif);
}
.sub {
  font-family: var(--mono); font-size: .82rem; color: var(--faint);
  margin: 0 0 40px;
}
.btns { display: flex; gap: 12px; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 22px; border-radius: 6px; font-weight: 600;
  font-size: .95rem; font-family: var(--mono); border: 1px solid transparent;
  cursor: pointer; transition: transform .12s ease, box-shadow .12s ease;
  text-decoration: none;
}
.btn:hover { transform: translateY(-2px); text-decoration: none; }
.btn.primary {
  background: var(--a1); color: #0b0e15;
  box-shadow: 0 4px 20px rgba(232,184,75,.3);
}
.btn.primary:hover { box-shadow: 0 6px 28px rgba(232,184,75,.4); }
.btn.ghost {
  background: transparent; border-color: var(--border2); color: var(--text);
}
.btn.ghost:hover { background: var(--card); }

/* ── Section chrome ─────────────────────────────────────── */
section { padding: 72px 0; border-top: 1px solid var(--border); position: relative; z-index: 1; }
.sect-label {
  font-family: var(--mono); font-size: .68rem; font-weight: 600;
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--a1); margin-bottom: 14px;
  display: flex; align-items: center; gap: 10px;
}
.sect-label::after {
  content: ''; flex: 1; max-width: 60px; height: 1px; background: rgba(232,184,75,.3);
}
.sect-h {
  font-family: var(--serif); font-size: clamp(1.8rem,3.8vw,2.8rem);
  font-weight: 400; letter-spacing: -.02em; margin: 0 0 14px; line-height: 1.1;
}
.sect-h em { font-style: italic; color: var(--a1); }
.sect-p { color: var(--muted); font-size: 1.02rem; max-width: 680px; margin: 0 0 44px; font-family: var(--serif); }

/* ── Pillars ────────────────────────────────────────────── */
.pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.pillar {
  background: var(--card); padding: 28px 26px;
  transition: background .14s;
}
.pillar:hover { background: var(--card-h); }
.pillar-num {
  font-family: var(--mono); font-size: .68rem; color: var(--a1);
  font-weight: 600; letter-spacing: .1em; margin-bottom: 16px;
}
.pillar h3 {
  font-family: var(--serif); font-size: 1.15rem; font-weight: 400;
  margin: 0 0 10px; line-height: 1.25;
}
.pillar p { color: var(--muted); font-size: .9rem; line-height: 1.6; }

/* ── Tools grid ─────────────────────────────────────────── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.tcard {
  display: block; background: var(--card); padding: 24px;
  transition: background .14s ease; position: relative;
  text-decoration: none;
}
.tcard:hover { background: var(--card-h); text-decoration: none; }
.tcard-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.tcard-icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: var(--bg-2); display: grid; place-items: center;
  font-size: 1.4rem; flex: none; border: 1px solid var(--border);
}
.tag {
  font-family: var(--mono); font-size: .6rem; font-weight: 600;
  letter-spacing: .07em; text-transform: uppercase;
  padding: 4px 9px; border-radius: 4px;
}
.tag.live { background: rgba(95,211,168,.1); color: var(--a3); border: 1px solid rgba(95,211,168,.25); }
.tag.build { background: rgba(232,184,75,.1); color: var(--a1); border: 1px solid rgba(232,184,75,.25); }
.tag.idea { background: rgba(91,156,246,.1); color: var(--a2); border: 1px solid rgba(91,156,246,.25); }
.tcard h3 { font-family: var(--serif); font-size: 1.12rem; font-weight: 400; color: var(--text); margin: 0 0 6px; }
.tcard .url { font-family: var(--mono); font-size: .72rem; color: var(--a2); margin-bottom: 10px; display: block; }
.tcard p { color: var(--muted); font-size: .88rem; line-height: 1.55; }

/* ── Build list ─────────────────────────────────────────── */
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
.chip {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--muted); padding: 7px 16px; border-radius: 4px;
  font-size: .8rem; font-weight: 600; font-family: var(--mono);
  cursor: pointer; transition: all .12s ease;
}
.chip:hover { background: var(--card-h); color: var(--text); }
.chip.active { background: var(--a1); color: #0b0e15; border-color: var(--a1); }
.bcard {
  background: var(--card); border-top: 1px solid var(--border);
  padding: 18px 20px; display: flex; flex-direction: column;
  gap: 6px; position: relative; transition: background .12s;
}
.bcard:hover { background: var(--card-h); }
.bcard:first-child { border-radius: 8px 8px 0 0; border-top: none; }
.bcard .cat { font-family: var(--mono); font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
.bcard h3 { font-family: var(--serif); margin: 0; font-size: 1rem; font-weight: 400; padding-right: 80px; }
.bcard p { margin: 0; color: var(--muted); font-size: .87rem; }
.bcard .row { display: flex; align-items: center; gap: 14px; margin-top: 2px; }
.bcard .claim { font-family: var(--mono); font-size: .78rem; font-weight: 600; color: var(--a3); }
.bcard a.ext { font-family: var(--mono); font-size: .76rem; color: var(--faint); }
.bcards-wrap { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.buildnote { margin-top: 24px; color: var(--faint); font-size: .88rem; text-align: center; font-family: var(--mono); }
.claim-head { margin: 52px 0 20px; }
.claim-head h3 {
  font-family: var(--serif); font-size: 1.5rem; font-weight: 400;
  margin: 0 0 8px; display: flex; align-items: center; gap: 12px;
}
.claim-head p { color: var(--muted); font-size: .95rem; font-family: var(--serif); }
.livedot {
  width: 9px; height: 9px; border-radius: 50%; background: #ef5f5f; display: inline-block;
  box-shadow: 0 0 0 0 rgba(239,95,95,.5); animation: pulse 2s infinite;
}
@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(239,95,95,.5)} 70%{box-shadow:0 0 0 8px rgba(239,95,95,0)} 100%{box-shadow:0 0 0 0 rgba(239,95,95,0)} }
.witloading { color: var(--faint); padding: 32px; text-align: center; font-family: var(--mono); font-size: .85rem; }

/* ── Blockquote ─────────────────────────────────────────── */
blockquote {
  margin: 0; background: var(--card); border: 1px solid var(--border);
  border-left: 3px solid var(--a1); border-radius: 0 10px 10px 0;
  padding: 28px 32px;
  font-family: var(--serif); font-size: 1.15rem; font-weight: 300;
  color: var(--text); font-style: italic; line-height: 1.65;
}
blockquote cite {
  display: block; margin-top: 16px; font-size: .88rem;
  color: var(--faint); font-style: normal; font-family: var(--mono);
}

/* ── Resource links ─────────────────────────────────────── */
.links-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.lcol { background: var(--card); padding: 22px; }
.lcol h4 { font-family: var(--mono); font-size: .75rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 14px; }
.lcol ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.lcol li a { color: var(--muted); font-size: .88rem; font-family: var(--serif); transition: color .12s; }
.lcol li a:hover { color: var(--a2); }

/* ── CTA band ───────────────────────────────────────────── */
.cta-band {
  border: 1px solid var(--border2); border-radius: 14px;
  padding: 52px 48px; text-align: center;
  background: linear-gradient(135deg, rgba(232,184,75,.06) 0%, rgba(91,156,246,.05) 100%);
  position: relative; overflow: hidden;
}
.cta-band::before {
  content: '';
  position: absolute; bottom: -60px; right: -60px;
  width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle, rgba(91,156,246,.08) 0%, transparent 70%);
}
.cta-band h2 { font-family: var(--serif); font-size: clamp(1.6rem,3.5vw,2.4rem); font-weight: 300; margin: 0 0 14px; letter-spacing: -.02em; }
.cta-band h2 strong { font-weight: 700; }
.cta-band p { color: var(--muted); max-width: 600px; margin: 0 auto 30px; font-size: 1.02rem; font-family: var(--serif); }

/* ── Footer ─────────────────────────────────────────────── */
footer { padding: 48px 0 60px; border-top: 1px solid var(--border); }
footer .wrap { display: flex; flex-direction: column; gap: 36px; }
.footer-top { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.footer-brand { display: flex; align-items: center; gap: 10px; }
.footer-brand .brand-mark { width: 28px; height: 28px; font-size: .75rem; border-radius: 6px; }
.footer-brand span { font-family: var(--mono); font-size: .88rem; color: var(--muted); }
.footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
.footer-links a { font-family: var(--mono); font-size: .8rem; color: var(--faint); }
.footer-links a:hover { color: var(--muted); }

/* ── Humanity³ legacy section ───────────────────────────── */
.legacy {
  border-top: 1px solid var(--border);
  padding: 28px 0 0; margin-top: 8px;
}
.legacy-inner {
  display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 6px 20px; opacity: .55;
}
.legacy-label {
  font-family: var(--mono); font-size: .68rem; letter-spacing: .12em;
  text-transform: uppercase; color: var(--faint);
}
.legacy-links { display: flex; flex-wrap: wrap; gap: 14px; }
.legacy-links a { font-family: var(--mono); font-size: .75rem; color: var(--faint); }
.legacy-links a:hover { color: var(--muted); opacity: 1; }

/* ── Scroll entrance ────────────────────────────────────── */
.reveal { opacity: 0; transform: translateY(16px); transition: opacity .5s ease, transform .5s ease; }
.reveal.in { opacity: 1; transform: none; }
</style>
</head>
<body>

<nav><div class="wrap">
  <a class="brand" href="#top">
    <div class="brand-mark">⚡</div>
    <div class="brand-name">
      Humanity Infrastructure
      <em>Open Civilization Layer</em>
    </div>
  </a>
  <div class="nav-links">
    <a class="gh" href="https://github.com/tmad4000/humanity-infrastructure" target="_blank" rel="noopener">GitHub ↗</a>
    <a href="#mission">Mission</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">Resources</a>
    <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <div class="eyebrow">Infrastructure for Human Flourishing</div>
  <h1>We build the missing<br/><em>civilization layer.</em></h1>
  <p class="lede">Tools, knowledge systems and coordination infrastructure: free to use, open where possible. The not-just-engineering equivalent of the open-source movement.</p>
  <p class="sub">// knowledge as a birthright · tools that make people independent · coordinating as a superorganism</p>
  <div class="btns">
    <a class="btn primary" href="#tools">Explore the infrastructure →</a>
    <a class="btn ghost" href="#mission">Read the mission</a>
  </div>
</div></header>

<section id="mission"><div class="wrap">
  <div class="sect-label">The Mission</div>
  <h2 class="sect-h">Imagine it were everyone's birthright<br/>to access the <em>sum-total of human know-how.</em></h2>
  <p class="sect-p">Humanity Infrastructure is a hub of knowledge resources and open-source tools — built to bring flourishing into every person's reach. We envision something most of the developed world eventually becomes part of, to a greater or lesser degree.</p>
  <div class="pillars reveal">
    <div class="pillar">
      <div class="pillar-num">01 — Knowledge</div>
      <h3>Knowledge as a public good</h3>
      <p>Survival and thriving guides, medical know-how, open curricula, role-model casting, the craftsmanship of software. Shouldn't tools from 10 years ago be free by now?</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">02 — Tools</div>
      <h3>Tools that make people independent</h3>
      <p>Open reputation systems, collective-action infrastructure, personal-leverage automation, assistive tech. Hacked-together infrastructure that helps people help themselves.</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">03 — Coordination</div>
      <h3>Coordinate as a superorganism</h3>
      <p>Guilds taking on epic quests. Global sense-making. Volunteerism and philanthropy for everyone — ways to pitch in on the problems that matter, together.</p>
    </div>
    <div class="pillar">
      <div class="pillar-num">04 — Flourishing</div>
      <h3>Flourishing in reach for all</h3>
      <p>From "how to thrive as a highly sensitive person on a budget" to "how to rebuild society from scratch." Compassionate, practical, and free.</p>
    </div>
  </div>
</div></section>

<section id="tools"><div class="wrap">
  <div class="sect-label">Working Infrastructure</div>
  <h2 class="sect-h">Pieces that <em>already exist.</em></h2>
  <p class="sect-p">Find tools for practical needs. Free to use. Open where possible. Featured listings show their license. <a href="#submit">Suggest a resource →</a></p>
  <div class="grid reveal">
    <a id="lastbook" class="tcard" href="https://lastbook.org" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📖</div><span class="tag live">Featured</span></div>
      <h3>Lastbook</h3><span class="url">lastbook.org</span>
      <p>A free, open-source offline library of practical manuals, videos and maps, with optional local AI. Knowledge for preparedness and rebuilding, available after setup without an internet connection.</p>
      <p>Knowledge that survives when the internet doesn't. Open source (MIT) · Mac, Windows, Linux.</p>
    </a>
    <a id="paxi" class="tcard" href="https://paxi.fyi" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🚕</div><span class="tag live">Featured</span></div>
      <h3>Paxi</h3><span class="url">paxi.fyi</span>
      <p>Compares live ride prices and times across Uber, Lyft, Waymo, Tesla, Zoox, Curb and more, then books the one you choose.</p>
      <p>Use the best service for each task, without interface lock-in. Free · closed source · iPhone · by Doug Feigelson, a friend of the maintainer.</p>
    </a>
    <a class="tcard" href="https://nvctranslator.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🕊️</div><span class="tag live">Live</span></div>
      <h3>NVC Translator</h3>
      <span class="url">nvctranslator.com</span>
      <p>Translate any text into Marshall Rosenberg's Nonviolent Communication. How can AI make us more compassionate?</p>
    </a>
    <a class="tcard" href="https://globalbr.ai" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🧠</div><span class="tag live">Live</span></div>
      <h3>Noos</h3>
      <span class="url">globalbr.ai</span>
      <p>A universal knowledge graph — the "codex" backend. Capture, connect, and query human know-how with per-node privacy.</p>
    </a>
    <a class="tcard" href="https://wikihub.md" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📚</div><span class="tag live">Live</span></div>
      <h3>WikiHub</h3>
      <span class="url">wikihub.md</span>
      <p>GitHub for LLM wikis. Hosting for open, agent-native markdown knowledge bases — forkable, shareable, version-controlled.</p>
    </a>
    <a class="tcard" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🌐</div><span class="tag live">Live</span></div>
      <h3>World Issue Tracker</h3>
      <span class="url">worldissuetracker.com</span>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
    </a>
    <a id="signudoc" class="tcard" href="https://github.com/NYLLON-SOFTWARE/SignuDoc" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">✍️</div><span class="tag live">Featured</span></div>
      <h3>SignuDoc</h3><span class="url">github.com/NYLLON-SOFTWARE/SignuDoc</span>
      <p>Open-source e-signatures. Send, sign and seal documents from your own cloud at $0 per seat, with audit trails and tamper-evident seals.</p>
      <p>Open document signing infrastructure. Open source (MIT) · self-hosted on Vercel · by Kevin Rose / NYLLON.</p>
    </a>
    <a class="tcard" href="https://tmad4000.github.io/brainstorms/" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">💡</div><span class="tag live">Live</span></div>
      <h3>Idea List</h3>
      <span class="url">tmad4000.github.io/brainstorms</span>
      <p>An open idea bank — projects, hackathon ideas, and easily-solvable world problems, free for anyone to take and build.</p>
    </a>
    <a class="tcard" href="https://github.com/tmad4000/claude-mind" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🔬</div><span class="tag live">Live</span></div>
      <h3>Claude Mind</h3>
      <span class="url">github.com/tmad4000/claude-mind</span>
      <p>Collaborative AI–human exploration of open problems — guilds working the quests, Polymath-style.</p>
    </a>
    <a class="tcard" href="https://github.com/tmad4000/vibe-coding-guide" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">⚡</div><span class="tag live">Live</span></div>
      <h3>Vibe Coding Guide</h3>
      <span class="url">github.com/tmad4000/vibe-coding-guide</span>
      <p>Open guide to AI-assisted coding — making the craftsmanship of software buildable by everyone.</p>
    </a>
  </div>
</div></section>

<section><div class="wrap">
  <blockquote class="reveal">
    "We need these tools, all of them, and to be honest with you, they need to be in the hands of everybody… When humans come into guilds to do epic quests, they're problem-solving, they're inventing a solution. That's how this planet's going to get fixed."
    <cite>— Jack Park, on guilds &amp; global sense-making</cite>
  </blockquote>
</div></section>

<section id="buildlist"><div class="wrap">
  <div class="sect-label">The Open Build List</div>
  <h2 class="sect-h">What still needs to <em>be built.</em></h2>
  <p class="sect-p">The infrastructure for human flourishing is mostly <em>not built yet.</em> Below is the running list — ideas, works-in-progress, and what's done. See one you want to build? <strong>Claim it.</strong></p>
  <div class="filters" id="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="idea">💡 Ideas</button>
    <button class="chip" data-f="building">🔨 In progress</button>
    <button class="chip" data-f="done">✅ Done</button>
  </div>
  <div class="bcards-wrap">
    <div id="buildgrid"></div>
  </div>
  <p class="buildnote">This list is open. Add an idea or claim one on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Missing Civilization Infrastructure</a> board — or email <a href="mailto:jacobcole4000@gmail.com">jacobcole4000@gmail.com</a>.</p>

  <div class="claim-head reveal">
    <h3><span class="livedot"></span> &nbsp;Claim a quest — live from the tracker</h3>
    <p>These ideas are filed as real, public issues on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">World Issue Tracker</a>. Vote, discuss, or claim one to build — updates in real time.</p>
  </div>
  <div class="bcards-wrap" style="margin-top:16px">
    <div id="witgrid"><div class="witloading">Loading open quests from the tracker…</div></div>
  </div>
</div></section>

<section id="vision"><div class="wrap">
  <div class="sect-label">The Living Document</div>
  <h2 class="sect-h">The full vision — and <em>where to add to it.</em></h2>
  <p class="sect-p">Humanity Infrastructure is an open, growing project. These are the canonical sources. Add yourself, add a project, add a resource.</p>
  <div class="links-cols reveal">
    <div class="lcol">
      <h4>📜 Read the source</h4>
      <ul>
        <li><a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Humanity 3.0 &amp; the Dharmic blueprint</a></li>
        <li><a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">The Codex — master doc (Google Docs)</a></li>
        <li><a href="https://plausible-text-76b.notion.site/Cody-s-Healing-List-v4-b05b097d529c4c54b5d62f87f55b1f6f" target="_blank" rel="noopener">Healing Resources — "Cody Codex"</a></li>
        <li><a href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">World Quest Guild — add yourself</a><br/><small>Short link: <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</small></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="https://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="https://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="https://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="https://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="https://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="https://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="https://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="https://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="https://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="https://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
        <li><a href="https://education.jacobcole.net" target="_blank" rel="noopener">Education resources</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="submit"><div class="wrap">
  <h2>What else should be featured?</h2>
  <p>Help grow Humanity Infrastructure. Suggest useful tools, open knowledge, practical guides or projects that help people flourish. You do not need to be a developer.</p>
  <p>Send the name, link, a short description and who it helps. Include access or licensing details and any affiliation. We review suggestions before featuring them.</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0">
    <a class="btn primary" href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml">Suggest a resource on GitHub →</a>
    <a class="btn ghost" href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure%20resource%20suggestion&amp;body=Name%3A%0ALink%3A%0AWho%20it%20helps%3A%0AAccess%20or%20license%3A%0AMy%20affiliation%3A">Suggest by email</a>
    <a class="btn ghost" href="https://github.com/tmad4000/humanity-infrastructure/blob/main/CONTRIBUTING.md">Contribute a pull request →</a>
  </div>
  <p><a href="https://github.com/tmad4000/humanity-infrastructure">Browse the website source on GitHub</a> · <a href="https://worldissuetracker.com/tracker/lastbook">Lastbook community feedback and fixes</a></p>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band reveal">
    <h2>Help us build the <strong>missing infrastructure.</strong></h2>
    <p>This project is open to contributors, builders, and anyone who believes the tools for flourishing should be free. Pick a quest, claim an idea, or just use the tools and tell others.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Browse open quests →</a>
      <a class="btn ghost" href="mailto:jacobcole4000@gmail.com">Get in touch</a>
    </div>
  </div>
</div></section>

<footer><div class="wrap">
  <p>v0.4.0 · 2026-11-17</p>
  <div class="footer-top">
    <div class="footer-brand">
      <div class="brand-mark">⚡</div>
      <span>Humanity Infrastructure</span>
    </div>
    <div class="footer-links">
      <a href="#mission">Mission</a>
      <a href="#tools">Tools</a>
      <a href="#buildlist">Build List</a>
      <a href="#vision">Resources</a>
      <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
      <a href="mailto:jacobcole4000@gmail.com">Contact</a>
    </div>
  </div>

  <!-- Design versions + Humanity³ legacy — subtle -->
  <div class="legacy">
    <div class="legacy-inner" style="flex-direction:column;gap:12px;align-items:flex-start;">
      <div style="display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;">
        <span class="legacy-label">Design mockups →</span>
        <div class="legacy-links">
          <a href="/v3">v3 — Dark Blueprint (current)</a>
          <a href="/v2">v2 — Editorial / Red</a>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;">
        <span class="legacy-label">Previously at humanity3.earth →</span>
        <div class="legacy-links">
          <a href="https://humanity3.earth" target="_blank" rel="noopener">humanity3.earth</a>
          <a href="https://humanity3.earth#manifesto" target="_blank" rel="noopener">The Codex</a>
          <a href="https://humanity3.earth#tools" target="_blank" rel="noopener">Tools</a>
          <a href="https://humanity3.earth#buildlist" target="_blank" rel="noopener">Build List</a>
          <a href="https://humanity3.earth#vision" target="_blank" rel="noopener">Vision</a>
        </div>
      </div>
    </div>
  </div>
</div></footer>

<script>
/* ── Theme toggle ── */
const themeBtn = document.getElementById('themeBtn');
const stored = localStorage.getItem('hi-theme');
if (stored) { document.documentElement.setAttribute('data-theme', stored); themeBtn.textContent = stored === 'light' ? '🌙' : '☀️'; }
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
  localStorage.setItem('hi-theme', next);
});

/* ── Scroll reveal ── */
const observer = new IntersectionObserver(els => {
  els.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); } });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── Build list data ── */
const BUILD_ITEMS = [
  { cat:'knowledge', title:'Universal survival guide', desc:'From food & shelter to emotional regulation — the knowledge every human needs, in every language.', status:'idea' },
  { cat:'coordination', title:'Open reputation system', desc:'Portable, cross-platform reputation that travels with you — not locked to one silo.', status:'idea' },
  { cat:'health', title:'Open chronic-pain protocol', desc:'Aggregated evidence-based treatments for common chronic conditions, freely editable.', status:'building', url:'https://chronicpain.jacobcole.net/' },
  { cat:'coordination', title:'Volunteerism marketplace', desc:'Match people who want to help with tasks that need doing — a Craigslist for good deeds.', status:'idea' },
  { cat:'knowledge', title:'Open meditation curricula', desc:'Secular, evidence-based meditation courses — from beginner to advanced, free forever.', status:'done', url:'https://meditation.jacobcole.net/' },
  { cat:'tools', title:'Collective action toolkit', desc:'Lower the barrier to coordinating groups around shared goals — pledges, commitments, accountability.', status:'building', url:'https://thunderpledge.jacobcole.net' },
  { cat:'knowledge', title:'How to eat well (open guide)', desc:'Evidence-based nutrition guide with community editing and regional adaptations.', status:'done', url:'https://foodslist.jacobcole.net/' },
  { cat:'tools', title:'Personal knowledge graph for everyone', desc:'Noos but for non-technical users — a simple interface for connected notes and learning.', status:'building', url:'https://globalbr.ai' },
  { cat:'coordination', title:'Open skill-matching', desc:'Connect people who need help with people who have the skill — like LinkedIn but free and open.', status:'idea' },
  { cat:'tools', title:'NVC Translator for teams', desc:'Extend NVC Translator to async team contexts — Slack/email de-escalation at scale.', status:'idea' },
];

let activeFilter = 'all';
const filterMap = { idea:['idea'], building:['building'], done:['done'] };

function renderBuildList() {
  const grid = document.getElementById('buildgrid');
  const items = activeFilter === 'all' ? BUILD_ITEMS : BUILD_ITEMS.filter(i => (filterMap[activeFilter]||[]).includes(i.status));
  if (!items.length) { grid.innerHTML = '<div class="witloading">No items in this category yet.</div>'; return; }
  grid.innerHTML = items.map(item => \`
    <div class="bcard" data-status="\${item.status}">
      <div class="cat">\${item.cat}</div>
      <h3>\${item.title}</h3>
      \${item.desc ? \`<p>\${item.desc}</p>\` : ''}
      <div class="row">
        <span class="claim">\${item.status === 'done' ? '✅ Done' : item.status === 'building' ? '🔨 In progress' : '→ Available to claim'}</span>
        \${item.url ? \`<a class="ext" href="\${item.url}" target="_blank" rel="noopener">↗ See it</a>\` : ''}
      </div>
    </div>\`).join('');
}

document.getElementById('filters').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeFilter = chip.dataset.f;
  renderBuildList();
});

renderBuildList();

/* ── Live WIT issues ── */
async function loadWIT() {
  const grid = document.getElementById('witgrid');
  try {
    const res = await fetch('https://api.worldissuetracker.com/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const issues = (data.issues || data.data || []).filter(i => !i.deleted_at && i.status !== 'closed')
      .sort((a,b) => (b.votes||0) - (a.votes||0)).slice(0, 6)
      .map(i => ({ ...i, title: esc(i.title), description: esc((i.description||'').split(' Part of the Humanity')[0]), url: (() => { try { return new URL(i.canonical_issue_url || ('/issue/' + encodeURIComponent(i.slug || '')), 'https://worldissuetracker.com').href } catch { return 'https://worldissuetracker.com/tracker/missing-civ-infrastructure' } })(), id: '' }));
    if (!issues.length) { grid.innerHTML = '<div class="witloading">No open quests right now — check back soon.</div>'; return; }
    grid.innerHTML = issues.map(i => \`
      <div class="bcard">
        <div class="cat">Open quest</div>
        <h3>\${i.title}</h3>
        \${i.description ? \`<p>\${i.description.slice(0,180)}\${i.description.length>180?'…':''}</p>\` : ''}
        <div class="row">
          <span class="claim">→ Available to claim</span>
          <a class="ext" href="\${i.url||'https://missing-civ-infrastructure.worldissuetracker.com/'}" target="_blank" rel="noopener">↗ View on WIT</a>
        </div>
      </div>\`).join('');
  } catch {
    grid.innerHTML = '<div class="witloading">Could not load live quests — <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">view them on the tracker ↗</a></div>';
  }
}
loadWIT();
</script>
</body>
</html>
`
const CLASSIC_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Humanity Infrastructure — Classic layout</title>
<meta name="description" content="A codex of human know-how as a public resource to humanity. Free, open-source tools and knowledge to coordinate human activity — and bring flourishing into every person's reach. This is how we coordinate as a superorganism." />
<meta property="og:title" content="Humanity³ — The Codex" />
<meta property="og:description" content="Knowledge as a birthright. Open tools for human flourishing. This is how we coordinate as a superorganism." />
<meta property="og:type" content="website" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='https://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>" />
<style>
  :root{
    --bg:#0c0f14; --bg-soft:#12161f; --card:#161b26; --card-hover:#1c2230;
    --text:#e8edf6; --muted:#97a1b3; --faint:#5d6678;
    --accent:#5fd3a8; --accent-2:#7aa2ff; --accent-warm:#f4b860;
    --border:rgba(255,255,255,.08); --border-strong:rgba(255,255,255,.16);
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 30px rgba(0,0,0,.35);
    --max:1080px;
  }
  [data-theme="light"]{
    --bg:#f7f8fa; --bg-soft:#eef1f6; --card:#ffffff; --card-hover:#f3f6fb;
    --text:#16202e; --muted:#566074; --faint:#8a93a6;
    --accent:#0f9d72; --accent-2:#3a64d8; --accent-warm:#c98415;
    --border:rgba(10,20,40,.10); --border-strong:rgba(10,20,40,.18);
    --shadow:0 1px 2px rgba(20,30,50,.06),0 10px 34px rgba(20,30,50,.10);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:80px}
  body{
    margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(900px 500px at 80% -10%,rgba(122,162,255,.10),transparent 60%),radial-gradient(800px 500px at 0% 0%,rgba(95,211,168,.08),transparent 55%);
  }
  a{color:var(--accent-2);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:var(--max);margin:0 auto;padding:0 24px}

  /* nav */
  nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(140%) blur(12px);
    background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--border)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:62px;gap:16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:1.05rem;color:var(--text)}
  .brand span.logo{font-size:1.3rem}
  .nav-links{display:flex;gap:22px;align-items:center}
  .nav-links a{color:var(--muted);font-size:.92rem;font-weight:500;white-space:nowrap}
  .nav-links a:hover{color:var(--text);text-decoration:none}
  .theme-btn{background:var(--card);border:1px solid var(--border-strong);color:var(--text);
    width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:1rem;display:grid;place-items:center}
  .theme-btn:hover{background:var(--card-hover)}
  @media(max-width:1040px){.nav-links a:not(.cta):not(.gh){display:none}}

  /* hero */
  header.hero{padding:88px 0 56px;text-align:center}
  .eyebrow{display:inline-block;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--accent);font-weight:700;border:1px solid var(--border-strong);
    padding:6px 14px;border-radius:999px;margin-bottom:26px;background:var(--bg-soft)}
  h1{font-size:clamp(2.4rem,6vw,4.3rem);line-height:1.04;letter-spacing:-.03em;margin:0 0 22px;font-weight:800}
  h1 .grad{background:linear-gradient(110deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .lede{font-size:clamp(1.1rem,2.4vw,1.4rem);color:var(--muted);max-width:720px;margin:0 auto 18px}
  .sub{font-size:1.02rem;color:var(--faint);max-width:680px;margin:0 auto 36px;font-style:italic}
  .btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:9px;padding:13px 24px;border-radius:12px;
    font-weight:600;font-size:1rem;border:1px solid transparent;cursor:pointer;transition:transform .12s ease}
  .btn:hover{text-decoration:none;transform:translateY(-2px)}
  .btn.primary{background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d}
  .btn.ghost{background:var(--card);border-color:var(--border-strong);color:var(--text)}
  .btn.ghost:hover{background:var(--card-hover)}

  section{padding:64px 0;border-top:1px solid var(--border)}
  .section-head{margin-bottom:36px;max-width:760px}
  .section-head h2{font-size:clamp(1.6rem,3.4vw,2.3rem);letter-spacing:-.02em;margin:0 0 12px;font-weight:800}
  .section-head p{color:var(--muted);font-size:1.06rem;margin:0}
  .kicker{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-warm);font-weight:700;margin-bottom:10px}

  /* manifesto pillars */
  .pillars{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
  .pillar{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
  .pillar .ico{font-size:1.7rem;margin-bottom:12px}
  .pillar h3{margin:0 0 8px;font-size:1.12rem;letter-spacing:-.01em}
  .pillar p{margin:0;color:var(--muted);font-size:.96rem}

  /* tools grid */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
  .card{display:block;background:var(--card);border:1px solid var(--border);border-radius:16px;
    padding:22px;transition:transform .14s ease,border-color .14s ease,background .14s ease;position:relative}
  .card:hover{transform:translateY(-4px);border-color:var(--border-strong);background:var(--card-hover);text-decoration:none;box-shadow:var(--shadow)}
  .card .top{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .card .emoji{font-size:1.5rem;width:42px;height:42px;border-radius:11px;background:var(--bg-soft);display:grid;place-items:center;flex:none}
  .card h3{margin:0;font-size:1.1rem;color:var(--text);letter-spacing:-.01em}
  .card .url{font-size:.8rem;color:var(--accent);font-weight:600}
  .card p{margin:0;color:var(--muted);font-size:.93rem}
  .tag{position:absolute;top:16px;right:16px;font-size:.66rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:4px 9px;border-radius:999px}
  .tag.live{background:rgba(95,211,168,.14);color:var(--accent);border:1px solid rgba(95,211,168,.3)}
  .tag.build{background:rgba(244,184,96,.13);color:var(--accent-warm);border:1px solid rgba(244,184,96,.3)}
  .tag.idea{background:rgba(122,162,255,.13);color:var(--accent-2);border:1px solid rgba(122,162,255,.3)}

  /* build list */
  .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
  .chip{background:var(--card);border:1px solid var(--border-strong);color:var(--muted);
    padding:8px 16px;border-radius:999px;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .12s ease}
  .chip:hover{background:var(--card-hover);color:var(--text)}
  .chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
  .bcard{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;
    display:flex;flex-direction:column;gap:8px;position:relative}
  .bcard .cat{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:700}
  .bcard h3{margin:0;font-size:1.04rem;letter-spacing:-.01em;padding-right:74px}
  .bcard p{margin:0;color:var(--muted);font-size:.9rem;flex:1}
  .bcard .row{display:flex;align-items:center;gap:14px;margin-top:4px}
  .bcard .claim{font-size:.84rem;font-weight:700;color:var(--accent)}
  .bcard a.ext{font-size:.82rem;color:var(--faint)}
  .buildnote{margin-top:26px;color:var(--faint);font-size:.92rem;text-align:center}
  .claim-head{margin:48px 0 22px;text-align:center}
  .claim-head h3{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 8px;display:inline-flex;align-items:center;gap:10px}
  .claim-head p{color:var(--muted);max-width:640px;margin:0 auto;font-size:.98rem}
  .livedot{width:10px;height:10px;border-radius:50%;background:#ef5f5f;display:inline-block;box-shadow:0 0 0 0 rgba(239,95,95,.5);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(239,95,95,.5)}70%{box-shadow:0 0 0 8px rgba(239,95,95,0)}100%{box-shadow:0 0 0 0 rgba(239,95,95,0)}}
  .card.featured .needline{margin-bottom:8px;color:var(--muted);font-size:.84rem;line-height:1.5}
  .need-label{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--accent-warm);margin-right:5px}
  .card.featured .why{margin-top:12px;font-size:.88rem}
  .card.featured .top>div{min-width:0}
  .card.featured h3{padding-right:72px}
  .card.featured h3 a{color:inherit}
  .card.featured .url{overflow-wrap:anywhere}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .badges li{font-size:.7rem;font-weight:650;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);color:var(--muted)}
  .badges li.open{color:var(--accent);border-color:rgba(95,211,168,.35)}
  .why{font-size:.88rem;color:var(--muted);border-left:2px solid var(--accent-2);padding-left:10px;margin:0}
  .why b{color:var(--text);font-weight:650}
  .seemore{font-size:.86rem;font-weight:600;margin-top:auto}
  .direct{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  .direct a{color:var(--muted);text-decoration:underline}
  .witloading{color:var(--faint);padding:30px;grid-column:1/-1;text-align:center}
  .bcard .votes{font-size:.8rem;color:var(--faint);font-weight:600}
  .bcard .claimedby{font-size:.82rem;color:var(--accent-warm);font-weight:700}

  /* quote */
  blockquote{margin:0;background:var(--bg-soft);border:1px solid var(--border);border-left:4px solid var(--accent);
    border-radius:14px;padding:26px 30px;font-size:1.12rem;color:var(--text)}
  blockquote cite{display:block;margin-top:14px;font-size:.92rem;color:var(--faint);font-style:normal}

  /* lists row */
  .links-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .lcol{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px}
  .lcol h4{margin:0 0 12px;font-size:.95rem;color:var(--text)}
  .lcol ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .lcol li a{color:var(--muted);font-size:.9rem}
  .lcol li a:hover{color:var(--accent-2)}

  /* CTA */
  .cta-band{background:linear-gradient(120deg,rgba(95,211,168,.10),rgba(122,162,255,.10));
    border:1px solid var(--border-strong);border-radius:22px;padding:48px;text-align:center}
  .cta-band h2{font-size:clamp(1.6rem,3.4vw,2.2rem);margin:0 0 12px;letter-spacing:-.02em}
  .cta-band p{color:var(--muted);max-width:620px;margin:0 auto 26px;font-size:1.05rem}

  footer{padding:48px 0 60px;border-top:1px solid var(--border);color:var(--faint);font-size:.88rem}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:18px;align-items:center}
  footer a{color:var(--muted)}
  .ver{font-variant-numeric:tabular-nums;opacity:.7}

  /* Contribute modal */
  .modal-overlay{display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px}
  .modal-overlay.open{display:flex;align-items:flex-start;justify-content:center}
  .modal-box{background:var(--bg-soft);border:1px solid var(--border-strong);border-radius:16px;width:100%;max-width:640px;margin:auto;padding:32px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.7)}
  .modal-close{position:absolute;top:16px;right:16px;background:var(--card);border:1px solid var(--border-strong);color:var(--text);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:1.1rem;display:grid;place-items:center;line-height:1}
  .modal-close:hover{background:var(--card-hover)}
  .modal-eyebrow{font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:12px;font-weight:600}
  .modal-title{font-size:1.55rem;font-weight:600;letter-spacing:-.02em;margin-bottom:6px}
  .modal-sub{color:var(--muted);font-size:.92rem;margin-bottom:24px;line-height:1.5}
  .m-field{margin-bottom:16px}
  .m-field label{display:block;font-size:.8rem;color:var(--muted);font-family:monospace;margin-bottom:6px;letter-spacing:.04em}
  .m-field label span{color:var(--faint)}
  .m-field input,.m-field textarea{width:100%;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;color:var(--text);font-family:inherit;font-size:.93rem;padding:10px 14px;outline:none;transition:border-color .15s}
  .m-field input:focus,.m-field textarea:focus{border-color:var(--accent-2)}
  .m-field input::placeholder,.m-field textarea::placeholder{color:var(--faint)}
  .m-field textarea{resize:vertical;min-height:80px;line-height:1.5}
  .m-submit{display:block;width:100%;padding:13px;background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d;font-family:inherit;font-size:.9rem;font-weight:700;border:none;border-radius:8px;cursor:pointer;letter-spacing:.03em;transition:opacity .15s;margin-top:4px}
  .m-submit:hover{opacity:.9}
  .m-submit:disabled{opacity:.38;cursor:not-allowed}
  .m-status{font-family:monospace;font-size:.78rem;color:var(--muted);margin-top:12px;text-align:center;min-height:18px}
  .m-results{margin-top:24px;display:none}
  .m-results.show{display:block}
  .m-profile{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px}
  .m-profile-name{font-size:1.1rem;font-weight:600;margin-bottom:2px}
  .m-profile-role{font-size:.75rem;color:var(--accent-warm);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;font-family:monospace}
  .m-profile-bio{color:var(--muted);font-size:.88rem;line-height:1.6}
  .m-match{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px;transition:border-color .15s}
  .m-match:hover{border-color:var(--border-strong)}
  .m-match-name{font-size:.85rem;font-weight:600;color:var(--accent-2);margin-bottom:4px}
  .m-match-fit{font-size:.87rem;color:var(--text);margin-bottom:8px;line-height:1.5}
  .m-match-quest{font-size:.78rem;color:var(--accent);border-left:2px solid var(--accent);padding-left:10px;line-height:1.45}
  .m-match-link{display:inline-block;margin-top:8px;font-family:monospace;font-size:.72rem;color:var(--faint)}
  .m-save-row{margin-top:20px;padding-top:18px;border-top:1px solid var(--border);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .m-save-btn{padding:9px 20px;background:transparent;border:1px solid var(--accent-2);color:var(--accent-2);font-family:inherit;font-size:.8rem;font-weight:600;border-radius:8px;cursor:pointer;transition:all .15s;white-space:nowrap}
  .m-save-btn:hover{background:var(--accent-2);color:var(--bg)}
  .m-save-note{font-size:.78rem;color:var(--faint);flex:1}
  .m-save-ok{font-family:monospace;font-size:.78rem;color:var(--accent);display:none}
  .m-save-ok.show{display:block}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#top"><span class="logo">🌍</span> Humanity³ <span style="color:var(--faint);font-weight:500">· The Codex</span></a>
  <div class="nav-links">
    <a href="#manifesto">Manifesto</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">The Vision</a>
    <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
    <a class="gh" href="https://github.com/tmad4000/humanity-infrastructure" target="_blank" rel="noopener">GitHub ↗</a>
    <button class="theme-btn" id="themeBtn" title="Toggle light/dark" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <span class="eyebrow">Basic Infrastructure for Human Flourishing</span>
  <h1>Knowledge is a <span class="grad">birthright</span>.<br/>So are the tools to use it.</h1>
  <p class="lede">A codex of human know-how as a public resource to humanity — plus the open-source software to coordinate human activity around it. The not-just-engineering equivalent of the open-source movement.</p>
  <p class="sub">“Building tools for the well-intended.” This is how we coordinate as a superorganism.</p>
  <div class="btns">
    <a class="btn primary" href="#tools">Explore the tools →</a>
    <button class="btn ghost" onclick="openContribute()" style="cursor:pointer;font-size:inherit">Find your contribution →</button>
  </div>
</div></header>

<section id="manifesto"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Premise</div>
    <h2>Imagine it were everyone's birthright to access the sum-total of human know-how.</h2>
    <p>The Codex is a hub of knowledge resources and open-source infrastructure — built to bring human flourishing into every person's reach. We envision something most of the developed world eventually becomes part of, to a greater or lesser degree.</p>
  </div>
  <div class="pillars">
    <div class="pillar"><div class="ico">📖</div><h3>Knowledge as a public good</h3><p>Survival and thriving guides, medical know-how, open curricula, role-model casting, the craftsmanship that is all software. Shouldn't software from 10 years ago be free by now?</p></div>
    <div class="pillar"><div class="ico">🛠️</div><h3>Tools that make people independent</h3><p>Open reputation systems, collective-action tools, personal-leverage automation, assistive tech. Hacked-together infrastructure that helps people help themselves.</p></div>
    <div class="pillar"><div class="ico">🤝</div><h3>Coordinate as a superorganism</h3><p>Guilds taking on epic quests. Global sense-making. Volunteerism, philanthropy for everyone, and ways to pitch in on the problems that matter — together.</p></div>
    <div class="pillar"><div class="ico">🌱</div><h3>Flourishing in reach for all</h3><p>From "how to thrive as a highly sensitive person on a budget" to "how to rebuild society from scratch." Compassionate, practical, and free.</p></div>
  </div>
</div></section>

<section id="tools"><div class="wrap">
  <div class="section-head">
    <div class="kicker">Working Tools</div>
    <h2>Pieces of the infrastructure that already exist</h2>
    <p>Free to use. Open where possible. Featured listings show their license. <a href="#submit">Suggest a resource →</a></p>
  </div>
  <div class="grid">
    <a id="lastbook" class="card" href="https://lastbook.org" target="_blank" rel="noopener">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">📖</span><div><h3>Lastbook</h3><div class="url">lastbook.org</div></div></div>
      <p>A free, open-source offline library of practical manuals, videos and maps, with optional local AI. Knowledge for preparedness and rebuilding, available after setup without an internet connection.</p>
      <ul class="badges"><li class="open">Open source · MIT</li></ul>
    </a>
    <a class="card" href="https://nvctranslator.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🕊️</span><div><h3>NVC Translator</h3><div class="url">nvctranslator.com</div></div></div>
      <p>Translate any text into Marshall Rosenberg's Nonviolent Communication — observations, feelings, needs, requests. How can AI make us more compassionate?</p>
    </a>
    <a class="card" href="https://globalbr.ai" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🧠</span><div><h3>Noos</h3><div class="url">globalbr.ai</div></div></div>
      <p>A universal knowledge graph — the "codex" backend. Capture, connect, and query human know-how with per-node privacy.</p>
    </a>
    <a class="card" href="https://wikihub.md" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">📚</span><div><h3>WikiHub</h3><div class="url">wikihub.md</div></div></div>
      <p>GitHub for LLM wikis. Hosting for open, agent-native markdown knowledge bases — forkable, shareable, version-controlled.</p>
    </a>
    <a class="card" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🌐</span><div><h3>World Issue Tracker</h3><div class="url">worldissuetracker.com</div></div></div>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
    </a>
    <a class="card" href="https://tmad4000.github.io/brainstorms/" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">💡</span><div><h3>Idea List</h3><div class="url">tmad4000.github.io/brainstorms</div></div></div>
      <p>An open idea bank — projects, hackathon ideas, and easily-solvable world problems, free for anyone to take and build.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/claude-mind" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🔬</span><div><h3>Claude Mind</h3><div class="url">github.com/tmad4000/claude-mind</div></div></div>
      <p>Collaborative AI–human exploration of open problems — research rabbits and guilds working the quests, Polymath-style.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/vibe-coding-guide" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">⚡</span><div><h3>Vibe Coding Guide</h3><div class="url">github.com/tmad4000/vibe-coding-guide</div></div></div>
      <p>Open guide to AI-assisted coding — making the craftsmanship of software buildable by everyone.</p>
    </a>
  </div>
</div></section>

<section><div class="wrap">
  <blockquote>
    “We need these tools, all of them, and to be honest with you, they need to be in the hands of everybody… When humans come into guilds to do epic quests, they're problem-solving, they're inventing a solution. That's how this planet's going to get fixed.”
    <cite>— Jack Park, on guilds &amp; global sense-making</cite>
  </blockquote>
</div></section>

<section id="buildlist"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Open Build List</div>
    <h2>What still needs to be built</h2>
    <p>The infrastructure for human flourishing is mostly <em>not built yet</em>. Below is the running list — ideas, works-in-progress, and what's done. Lifted from the Codex master doc; we'll keep pulling in more from across the lists. See one you want to build? <strong>Claim it.</strong></p>
  </div>
  <div class="filters" id="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="idea">💡 Ideas</button>
    <button class="chip" data-f="building">🔨 In progress</button>
    <button class="chip" data-f="done">✅ Done</button>
  </div>
  <div class="grid" id="buildgrid"></div>
  <p class="buildnote">This list is open. Add an idea or claim one on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Missing Civilization Infrastructure</a> board — or email <a href="mailto:jacob@ideaflow.io?subject=Open%20Build%20List">jacob@ideaflow.io</a>.</p>

  <div class="claim-head">
    <h3><span class="livedot"></span> Claim a quest — live from the tracker</h3>
    <p>These ideas are filed as real, public issues on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">World Issue Tracker</a>. Vote, discuss, or claim one to build — updates here in real time.</p>
  </div>
  <div class="grid" id="witgrid"><div class="witloading">Loading open quests from the tracker…</div></div>
</div></section>

<section id="vision"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Living Document</div>
    <h2>The full vision — and where to add to it</h2>
    <p>The Codex is an open, growing document. These are the canonical sources behind this page. Add yourself, add a project, add a resource.</p>
  </div>
  <div class="links-cols">
    <div class="lcol">
      <h4>📜 Read the source</h4>
      <ul>
        <li><a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Humanity 3.0 &amp; the Dharmic blueprint (Notion)</a></li>
        <li><a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">The Codex — master doc (Google Docs)</a></li>
        <li><a href="https://plausible-text-76b.notion.site/Cody-s-Healing-List-v4-b05b097d529c4c54b5d62f87f55b1f6f" target="_blank" rel="noopener">Healing Resources — "Cody Codex" (Notion)</a></li>
        <li><a href="https://quests.world" target="_blank" rel="noopener">World Quest Guild — add yourself</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="https://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="https://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="https://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="https://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="https://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="https://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="https://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="https://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="https://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="https://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="submit"><div class="wrap">
  <h2>What else should be featured?</h2>
  <p>Help grow Humanity Infrastructure. Suggest useful tools, open knowledge, practical guides or projects that help people flourish. You do not need to be a developer.</p>
  <p>Send the name, link, a short description and who it helps. Include access or licensing details and any affiliation. We review suggestions before featuring them.</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0">
    <a class="btn primary" href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml">Suggest a resource on GitHub →</a>
    <a class="btn ghost" href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure%20resource%20suggestion&amp;body=Name%3A%0ALink%3A%0AWho%20it%20helps%3A%0AAccess%20or%20license%3A%0AMy%20affiliation%3A">Suggest by email</a>
    <a class="btn ghost" href="https://github.com/tmad4000/humanity-infrastructure/blob/main/CONTRIBUTING.md">Contribute a pull request →</a>
  </div>
  <p><a href="https://github.com/tmad4000/humanity-infrastructure">Browse the website source on GitHub</a> · <a href="https://worldissuetracker.com/tracker/lastbook">Lastbook community feedback and fixes</a></p>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band">
    <h2>If you're not part of this, what are you doing with your life?</h2>
    <p>We're building the more general, not-just-engineering equivalent of the open-source movement. There's an enormous amount of low-hanging fruit — and we're looking for designers, engineers, writers, healers, and well-intended humans of every kind.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="mailto:jacob@ideaflow.io?subject=Joining%20the%20Codex%20%2F%20Humanity%20Infrastructure">Get involved →</a>
      <a class="btn ghost" href="https://quests.world" target="_blank" rel="noopener">Join a guild</a>
    </div>
  </div>
</div></section>

<footer><div class="wrap">
  <div>
    <strong style="color:var(--text)">Humanity³ · The Codex</strong> — basic infrastructure for human flourishing.<br/>
    Free &amp; open source. Contact <a href="mailto:jacob@ideaflow.io">jacob@ideaflow.io</a>
  </div>
  <div style="text-align:right">
    <a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Blueprint (Notion)</a> ·
    <a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">Master doc</a><br/>
    <span class="ver">v0.4.0 · 2026-11-17</span>
  </div>
</div>
  <!-- Design versions + legacy -->
  <div style="border-top:1px solid var(--border);margin-top:48px;padding-top:24px;display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;opacity:.5;font-size:.78rem;">
    <span style="font-family:monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);">Design versions →</span>
    <a href="/" style="color:var(--accent-2);">v1 — Original / Dark (current)</a>
    <a href="/v2" style="color:var(--accent-2);">v2 — Editorial / Red</a>
    <a href="/v3" style="color:var(--accent-2);">v3 — Dark Blueprint</a>
  </div>
</footer>

<!-- Contribute modal -->
<div class="modal-overlay" id="contributeModal" onclick="closeContributeIfBg(event)">
  <div class="modal-box">
    <button class="modal-close" onclick="closeContribute()" aria-label="Close">✕</button>
    <div class="modal-eyebrow">Find your quest</div>
    <div class="modal-title">How can you contribute?</div>
    <div class="modal-sub">Share a bit about yourself and we'll match you to the open infrastructure projects where you'd have the most impact.</div>
    <div class="m-field">
      <label for="m-twitter">X / Twitter handle <span>(optional)</span></label>
      <input id="m-twitter" type="text" placeholder="@handle or x.com/handle"/>
    </div>
    <div class="m-field">
      <label for="m-linkedin">LinkedIn URL <span>(optional)</span></label>
      <input id="m-linkedin" type="url" placeholder="linkedin.com/in/yourname"/>
    </div>
    <div class="m-field">
      <label for="m-homepage">Personal website or portfolio <span>(optional)</span></label>
      <input id="m-homepage" type="url" placeholder="https://yoursite.com"/>
    </div>
    <div class="m-field">
      <label for="m-about">About you <span>(work, interests, what you want to build)</span></label>
      <textarea id="m-about" placeholder="e.g. I'm a therapist who's been thinking about AI and nonviolent communication…"></textarea>
    </div>
    <button class="m-submit" id="m-analyzeBtn" onclick="mRunAnalysis()">Find my contribution →</button>
    <div class="m-status" id="m-status"></div>
    <div class="m-results" id="m-results">
      <div class="m-profile" id="m-profile"></div>
      <div id="m-matches"></div>
      <div class="m-save-row">
        <button class="m-save-btn" id="m-saveBtn" onclick="mSave()">Save to World Issue Tracker →</button>
        <span class="m-save-note">Creates a public profile in the HI Contributors tracker</span>
        <span class="m-save-ok" id="m-saveOk"></span>
      </div>
    </div>
  </div>
</div>

<script>
  // ---- Open Build List data (lifted from the Codex master doc) ----
  var BUILD=[
    {c:"Collective Action",t:"ThunderPledge",s:"idea",u:"https://thunderpledge.jacobcole.net",d:"Kickstarter for collective action: pledge to go vegetarian, vote, or boycott — but only once a critical mass also commits. Variants: ThunderVote, ThunderBoycott ('Kickstopper')."},
    {c:"Collective Action",t:"Zero-Sum Redirect",s:"idea",d:"A clearinghouse for opposing political donations — matched contributions cancel out and the saved money goes to charity instead."},
    {c:"Collective Action",t:"Government Suggestion Box",s:"idea",d:"A suggestion-box platform for governments, including the ability to donate toward implementing specific suggestions."},
    {c:"Collective Action",t:"Everyone-a-Philanthropist",s:"idea",d:"Infrastructure so communities can pool resources to fill missing government functions — help a neighbor afford insurance, get a kid a laptop."},
    {c:"Collective Action",t:"Resource-Sharing Platform",s:"idea",u:"https://favorverse.jacobcole.net/",d:"Let people share what they can lend — tools, a U-Haul, time. Related: Favorverse & VolunteerForce."},
    {c:"Reputation & Trust",t:"Open Reputation System",s:"idea",d:"A portable, open reputation layer — the missing primitive for trust in online coordination."},
    {c:"Reputation & Trust",t:"Trust Layer / Meta-Brands",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A trust layer for the web — 'meta-brands' that vouch for quality and integrity."},
    {c:"Reputation & Trust",t:"Fact-Check Extension",s:"idea",u:"https://factcheck.jacobcole.net/",d:"A browser extension surfacing fact-checks and provenance inline."},
    {c:"Fixing the Internet",t:"Open Forum Software",s:"building",u:"https://github.com/gulkily/pollyanna",d:"Forum software that is transparent, consensual, and open-source (Pollyanna)."},
    {c:"Fixing the Internet",t:"Minimalist Homepages",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A better way to make calm, minimalist personal homepages."},
    {c:"Fixing the Internet",t:"ThoughtfulWeb",s:"idea",u:"https://thoughtfulweb.jacobcole.net",d:"A directory of places on the web that are thoughtful, artful, and mindful — an oasis of good taste."},
    {c:"Personal Leverage",t:"'Camel's Eye' Email Agent",s:"idea",d:"An agent that filters and triages email on your behalf (from Permutation City). Reclaim your attention."},
    {c:"Personal Leverage",t:"Shortcut / Macro Coach",s:"idea",d:"Watches your actions and occasionally suggests a shortcut, auto-writing the macro for you."},
    {c:"Personal Leverage",t:"Open Automation Tools",s:"idea",d:"Great open-source macro & browser-automation frameworks (Browserflow-style) for everyone."},
    {c:"Personal Leverage",t:"Shopping Coach",s:"idea",d:"A service that shops on your behalf — finds the best, most ethical option so you don't have to."},
    {c:"Open Knowledge",t:"Open Meditation Curricula",s:"building",u:"https://meditation.jacobcole.net/",d:"Basic open curricula for meditation and working with your body. Lists exist; needs a real course."},
    {c:"Open Knowledge",t:"Open Medical Knowledge",s:"building",u:"https://chronicpain.jacobcole.net/",d:"How to treat chronic pain, RSI, and more — patient-first medical know-how. Lists started."},
    {c:"Open Knowledge",t:"Open Academic Education",s:"idea",d:"University-level math, an open algorithms tutor, and interactive self-teaching programming resources."},
    {c:"Open Knowledge",t:"Open Work Templates",s:"idea",d:"Open templates for every kind of work — invoices, gantt charts, proposals."},
    {c:"Open Knowledge",t:"Role-Model Casting",s:"idea",u:"https://foodslist.jacobcole.net/",d:"For people without good role models — emulate the routines of healthy, effective people (e.g. foods lists)."},
    {c:"Open Knowledge",t:"Motivation Database",s:"idea",u:"https://whyisitawesome.jacobcole.net/",d:"A wiki of why all the awesome things in the world are awesome — fuel for motivation."},
    {c:"Open Knowledge",t:"'Books to Grow Up On'",s:"idea",u:"https://kidactivities.jacobcole.net",d:"An open list of literature that builds good mental models — plus kids' games & activities."},
    {c:"Assistive Tech",t:"Hands-Free Voice Interfaces",s:"idea",d:"Good hands-free voice-recognition hooks into common sites (Gmail, etc.) for quadriplegics and others. Lots of low-hanging fruit."},
    {c:"Assistive Tech",t:"Cueing App for Brain Injuries",s:"idea",d:"A cueing/reminder app for people recovering from brain injuries."},
    {c:"Assistive Tech",t:"Better Foot Mouse",s:"idea",d:"A better foot-operated mouse for people who can't use their hands."},
    {c:"Coordination Infra",t:"On-the-Fly Knowledge Capture",s:"building",u:"https://globalbr.ai",d:"Frictionless personal knowledge capture + a graph query engine. Being built as Noos."},
    {c:"Coordination Infra",t:"Global Idea Bank",s:"building",u:"https://tmad4000.github.io/brainstorms/",d:"An open bank of ideas & hackathon projects anyone can take and build. Live as the Idea List."},
    {c:"Coordination Infra",t:"Open Research Repository",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A global, open repository for research — make the world's findings freely usable."},
    {c:"Care & Society",t:"Adult 'Foster' Support Network",s:"idea",d:"Ubiquitous support — 'extra parents' — for adults facing challenges so no one falls through the cracks."},
    {c:"Care & Society",t:"Non-Emergency Help Button",s:"idea",d:"A button to request non-emergency help: a compassionate responder for mental-health crises, a care coordinator, a 'life figure-outer'."},
    {c:"Care & Society",t:"Database of Survival Guides",s:"idea",d:"'How to survive/thrive' guides across many contexts — including for highly sensitive people on a budget."},
    {c:"Care & Society",t:"Database of Human Ideals",s:"idea",d:"Documenting the multiplicity of happy cultures and ways of being."},
    {c:"Done",t:"OpenLibrary",s:"done",u:"https://openlibrary.org",d:"Open, universal catalog of books. Exists — and it's wonderful."},
    {c:"Done",t:"Internet Archive",s:"done",u:"https://archive.org",d:"Humanity's library and memory. Exists — support it."},
    {c:"Done",t:"Concentration Music",s:"done",d:"Open 'music for concentration' playlists everyone can access. Largely solved."},
    {c:"Fixing the Internet",t:"Cross-Site Hashtag Search",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Search a hashtag uniformly across every social platform and website at once."},
    {c:"Fixing the Internet",t:"Universal Comments Layer",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Attach comment threads to any webpage, email, or chat, viewable by anyone."},
    {c:"Fixing the Internet",t:"Universal Web Annotations",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared highlight-and-note layer that pins annotations onto any page across the web."},
    {c:"Open Knowledge",t:"Canonical Debate Lab",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A structured platform that organizes contested claims and their arguments toward resolution."},
    {c:"Open Knowledge",t:"Scientific Assertions Database",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A machine-readable repository of scientific claims with their dependencies and evidence mapped."},
    {c:"Open Knowledge",t:"Collaborative Theorem Prover",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared workspace where mathematicians jointly build and verify formal proofs."},
    {c:"Open Knowledge",t:"Negative Results Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"An archive of failed experiments and null results so research isn't needlessly duplicated."},
    {c:"Open Knowledge",t:"Argument Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A searchable database of debate outlines and reusable argumentative frameworks."},
    {c:"Coordination Infra",t:"Policy & Science Simulator",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A sandbox for safely testing policy changes and hypotheses before real-world rollout."},
    {c:"Personal Leverage",t:"Unified Feed Control",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A single interface managing emails, texts, calls, and feeds with user-defined routing rules."},
    {c:"Fixing the Internet",t:"Soundbite Propagation Tracker",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Audio-fingerprinting that traces how a specific quote or claim spreads across media."},
    {c:"Civic & Government",t:"Global Goals Dashboard",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A public dashboard visualizing humanity's measured progress on major shared objectives."},
    {c:"Collective Action",t:"Conditional Voting Pledge",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Citizens commit to vote only if enough peers in their district also pledge, then all activate together."},
    {c:"Care & Society",t:"Favor-Matching Network",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Maps friends' skills so people can request and exchange favors locally."},
    {c:"Health & Body",t:"ICU & Ventilator Tracker",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A real-time map of available ventilators and ICU beds across hospitals during a crisis."},
    {c:"Care & Society",t:"Proximity Hangout Suggester",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Alerts you to nearby friends and suggests a meetup without persistent location tracking."},
    {c:"Fixing the Internet",t:"Political Bias Classifier",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"An ML tool that detects and labels politically biased content in social feeds."},
    {c:"Climate & Sustainability",t:"Wildfire Satellite Detection",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A model that flags forest fires early from satellite imagery."},
    {c:"Personal Leverage",t:"Ingredient Recipe Finder",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Recommends recipes from what's in your kitchen and pairs you with a cooking partner."},
    {c:"Reputation & Trust",t:"Used-Car History Database",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A verified repository of repair and inspection histories for used vehicles."},
    {c:"Open Knowledge",t:"Idea Graph IDE",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A graph workspace that links hackathon and startup ideas by relationship."},
    {c:"Open Knowledge",t:"Curiosity Thread Maps",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A platform charting question-to-question sequences that lead from curiosity to expertise."},
    {c:"Open Knowledge",t:"Best-in-Class Tool Registry",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A curated directory of the top tool for each purpose, organized by use case."},
    {c:"Coordination Infra",t:"Curated List Publishing",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Lets curators easily publish and distribute thematic lists and recommendations."},
    {c:"Personal Leverage",t:"Context Engineering Prize",s:"idea",u:"https://jacobcole.ai/brainstorms/",d:"A competition to get small models to frontier-level performance through better context."}
  ];
  (function(){
    var grid=document.getElementById('buildgrid'), filters=document.getElementById('filters');
    var labels={idea:["idea","💡 Idea"],building:["build","🔨 In progress"],done:["done","✅ Done"]};
    function render(f){
      grid.innerHTML='';
      BUILD.filter(function(b){return f==='all'||b.s===f}).forEach(function(b){
        var lab=labels[b.s]||["idea","Idea"];
        var ext=b.u?'<a class="ext" href="'+b.u+'" target="_blank" rel="noopener">↗ link</a>':'';
        var claim='<a class="claim" href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Claim →</a>';
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+lab[0]+'">'+lab[1]+'</span><div class="cat">'+b.c+'</div><h3>'+b.t+'</h3><p>'+b.d+'</p><div class="row">'+claim+ext+'</div>';
        grid.appendChild(el);
      });
    }
    filters.addEventListener('click',function(e){
      if(e.target.classList.contains('chip')){
        [].forEach.call(filters.children,function(c){c.classList.remove('active')});
        e.target.classList.add('active');
        render(e.target.getAttribute('data-f'));
      }
    });
    render('all');
  })();

  // ---- Live WIT-backed claim grid ----
  (function(){
    var WIT="https://api.worldissuetracker.com/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100";
    var grid=document.getElementById('witgrid');
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
    function issueUrl(i){try{return new URL(i.canonical_issue_url || ('/issue/'+encodeURIComponent(i.slug||'')), 'https://worldissuetracker.com').href}catch(e){return 'https://worldissuetracker.com/tracker/missing-civ-infrastructure'}}
    fetch(WIT).then(function(r){return r.json()}).then(function(d){
      var issues=(d.issues||d.data||[]).filter(function(i){return !i.deleted_at && i.status!=='closed'});
      if(!issues.length){grid.innerHTML='<div class="witloading">No open quests yet — <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">file the first one →</a></div>';return}
      issues.sort(function(a,b){return (b.votes||0)-(a.votes||0)});
      grid.innerHTML='';
      issues.forEach(function(i){
        var assignee=i.assignee_display_name;
        var action=assignee
          ? '<span class="claimedby">✓ Claimed by '+esc(assignee)+'</span>'
          : '<a class="claim" href="'+issueUrl(i)+'" target="_blank" rel="noopener">Claim →</a>';
        var votes=(i.votes!=null)?'<span class="votes">▲ '+i.votes+'</span>':'';
        var desc=esc((i.description||'').split(' Part of the Humanity')[0]).slice(0,150);
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+(assignee?'build':'idea')+'">'+(assignee?'🔨 Claimed':'💡 Open')+'</span>'
          +'<div class="cat">'+esc(i.category||'infrastructure')+'</div>'
          +'<h3><a href="'+issueUrl(i)+'" target="_blank" rel="noopener" style="color:inherit">'+esc(i.title)+'</a></h3>'
          +'<p>'+desc+'</p>'
          +'<div class="row">'+action+votes+'<a class="ext" href="'+issueUrl(i)+'" target="_blank" rel="noopener">↗ discuss</a></div>';
        grid.appendChild(el);
      });
    }).catch(function(){
      grid.innerHTML='<div class="witloading">Couldn’t load the live tracker. <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Open it directly →</a></div>';
    });
  })();

  (function(){
    var root=document.documentElement, btn=document.getElementById('themeBtn');
    var saved=null; try{saved=localStorage.getItem('h3-theme')}catch(e){}
    if(saved){root.setAttribute('data-theme',saved)}
    function sync(){btn.textContent=root.getAttribute('data-theme')==='dark'?'☀️':'🌙'}
    sync();
    btn.addEventListener('click',function(){
      var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
      root.setAttribute('data-theme',next);
      try{localStorage.setItem('h3-theme',next)}catch(e){}
      sync();
    });
  })();

  // ---- Contribute modal ----
  var mResult = null;
  function openContribute(){
    document.getElementById('contributeModal').classList.add('open');
    document.body.style.overflow='hidden';
  }
  function closeContribute(){
    document.getElementById('contributeModal').classList.remove('open');
    document.body.style.overflow='';
  }
  function closeContributeIfBg(e){
    if(e.target===document.getElementById('contributeModal')) closeContribute();
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape') closeContribute();});

  async function mRunAnalysis(){
    var btn=document.getElementById('m-analyzeBtn');
    var status=document.getElementById('m-status');
    var results=document.getElementById('m-results');
    var twitter=document.getElementById('m-twitter').value.trim();
    var linkedin=document.getElementById('m-linkedin').value.trim();
    var homepage=document.getElementById('m-homepage').value.trim();
    var about=document.getElementById('m-about').value.trim();
    if(!twitter&&!linkedin&&!homepage&&!about){status.textContent='Please fill in at least one field.';return;}
    btn.disabled=true;
    status.textContent='Gathering your profile data…';
    results.classList.remove('show');
    try{
      var res=await fetch('/contribute/analyze',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({twitter_handle:twitter,linkedin_url:linkedin,homepage_url:homepage,about_text:about})
      });
      var data=await res.json();
      if(data.error){status.textContent='⚠ '+data.error;btn.disabled=false;return;}
      mResult=data;
      mRenderResults(data);
      status.textContent=data.sources&&data.sources.length?'Analyzed from: '+data.sources.join(', '):'';
      results.classList.add('show');
    }catch(e){status.textContent='Something went wrong. Try again?';}
    btn.disabled=false;
  }

  function mRenderResults(data){
    document.getElementById('m-profile').innerHTML=
      '<div class="m-profile-name">'+(data.name||'You')+'</div>'
      +'<div class="m-profile-role">'+(data.top_role||'')+'</div>'
      +'<div class="m-profile-bio">'+(data.summary||'')+'</div>';
    document.getElementById('m-matches').innerHTML=(data.matches||[]).map(function(m){
      return '<div class="m-match">'
        +'<div class="m-match-name">'+m.project+'</div>'
        +'<div class="m-match-fit">'+m.fit+'</div>'
        +'<div class="m-match-quest">Quest: '+m.quest+'</div>'
        +'<a class="m-match-link" href="'+m.url+'" target="_blank" rel="noopener">'+m.url+' ↗</a>'
        +'</div>';
    }).join('');
  }

  function mSaveFallback(ok){
    var r=mResult||{};var title='Contributor profile: '+(r.name||document.getElementById('m-twitter').value.trim()||'new contributor');
    var body='## About me\\n'+(r.summary||'')+'\\n\\n## Role\\n'+(r.top_role||'')+'\\n\\n(Posted from humanityinfrastructure.com because saving to the tracker failed.)';
    var gh='https://github.com/tmad4000/humanity-infrastructure/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    var mail='mailto:jacob@ideaflow.io?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    ok.innerHTML='Couldn’t save to the tracker right now. Your profile isn’t lost: <a href="'+gh+'" target="_blank" rel="noopener">post it as a GitHub issue</a> or <a href="'+mail+'">email it to us</a>.';
    ok.classList.add('show');
  }
  async function mSave(){
    var btn=document.getElementById('m-saveBtn');
    var ok=document.getElementById('m-saveOk');
    if(!mResult) return;
    btn.disabled=true; btn.textContent='Saving…';
    try{
      var res=await fetch('/contribute/save',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({},mResult,{handle:document.getElementById('m-twitter').value.trim()||document.getElementById('m-linkedin').value.trim()}))
      });
      var data=await res.json();
      if(data.success){btn.style.display='none';ok.textContent='✓ Saved! View at worldissuetracker.com/tracker/hi-contributors';ok.classList.add('show');}
      else{btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
    }catch(e){btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
  }
</script>
</body>
</html>
`
const ARCHIVE_V4_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Humanity Infrastructure — tools and knowledge for human flourishing</title>
<meta name="description" content="Humanity Infrastructure: a free directory of tools and knowledge for human flourishing. Find tools for practical needs, from offline knowledge to shared civic work. Suggest what belongs." />
<meta property="og:title" content="Humanity Infrastructure — tools and knowledge for human flourishing" />
<meta property="og:description" content="Knowledge is a birthright. So are the tools to use it. A free, open directory of tools and knowledge for human flourishing. Suggest what belongs." />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Humanity Infrastructure" />
<meta property="og:url" content="https://humanityinfrastructure.com/" />
<meta property="og:image" content="https://humanityinfrastructure.com/og-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Humanity Infrastructure: Knowledge is a birthright. So are the tools to use it." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Humanity Infrastructure — tools and knowledge for human flourishing" />
<meta name="twitter:description" content="A free, open directory of tools and knowledge for human flourishing. Suggest what belongs." />
<meta name="twitter:image" content="https://humanityinfrastructure.com/og-card.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>" />
<style>
  :root{
    --bg:#0c0f14; --bg-soft:#12161f; --card:#161b26; --card-hover:#1c2230;
    --text:#e8edf6; --muted:#97a1b3; --faint:#5d6678;
    --accent:#5fd3a8; --accent-2:#7aa2ff; --accent-warm:#f4b860;
    --border:rgba(255,255,255,.08); --border-strong:rgba(255,255,255,.16);
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 30px rgba(0,0,0,.35);
    --max:1080px;
  }
  [data-theme="light"]{
    --bg:#f7f8fa; --bg-soft:#eef1f6; --card:#ffffff; --card-hover:#f3f6fb;
    --text:#16202e; --muted:#566074; --faint:#8a93a6;
    --accent:#0f9d72; --accent-2:#3a64d8; --accent-warm:#c98415;
    --border:rgba(10,20,40,.10); --border-strong:rgba(10,20,40,.18);
    --shadow:0 1px 2px rgba(20,30,50,.06),0 10px 34px rgba(20,30,50,.10);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:80px}
  body{
    margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(900px 500px at 80% -10%,rgba(122,162,255,.10),transparent 60%),radial-gradient(800px 500px at 0% 0%,rgba(95,211,168,.08),transparent 55%);
  }
  a{color:var(--accent-2);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:var(--max);margin:0 auto;padding:0 24px}

  /* nav */
  nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(140%) blur(12px);
    background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--border)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:62px;gap:16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:1.05rem;color:var(--text)}
  .brand span.logo{font-size:1.3rem}
  .nav-links{display:flex;gap:22px;align-items:center}
  .nav-links a{color:var(--muted);font-size:.92rem;font-weight:500;white-space:nowrap}
  .nav-links a:hover{color:var(--text);text-decoration:none}
  .theme-btn{background:var(--card);border:1px solid var(--border-strong);color:var(--text);
    width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:1rem;display:grid;place-items:center}
  .theme-btn:hover{background:var(--card-hover)}
  @media(max-width:1040px){.nav-links a:not(.cta):not(.gh){display:none}}

  /* hero */
  header.hero{padding:88px 0 56px;text-align:center}
  .eyebrow{display:inline-block;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--accent);font-weight:700;border:1px solid var(--border-strong);
    padding:6px 14px;border-radius:999px;margin-bottom:26px;background:var(--bg-soft)}
  h1{font-size:clamp(2.4rem,6vw,4.3rem);line-height:1.04;letter-spacing:-.03em;margin:0 0 22px;font-weight:800}
  h1 .grad{background:linear-gradient(110deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .lede{font-size:clamp(1.1rem,2.4vw,1.4rem);color:var(--muted);max-width:720px;margin:0 auto 18px}
  .sub{font-size:1.02rem;color:var(--faint);max-width:680px;margin:0 auto 36px;font-style:italic}
  .btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:9px;padding:13px 24px;border-radius:12px;
    font-weight:600;font-size:1rem;border:1px solid transparent;cursor:pointer;transition:transform .12s ease}
  .btn:hover{text-decoration:none;transform:translateY(-2px)}
  .btn.primary{background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d}
  .btn.ghost{background:var(--card);border-color:var(--border-strong);color:var(--text)}
  .btn.ghost:hover{background:var(--card-hover)}

  section{padding:64px 0;border-top:1px solid var(--border)}
  .section-head{margin-bottom:36px;max-width:760px}
  .section-head h2{font-size:clamp(1.6rem,3.4vw,2.3rem);letter-spacing:-.02em;margin:0 0 12px;font-weight:800}
  .section-head p{color:var(--muted);font-size:1.06rem;margin:0}
  .kicker{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-warm);font-weight:700;margin-bottom:10px}

  /* manifesto pillars */
  .pillars{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
  .pillar{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
  .pillar .ico{font-size:1.7rem;margin-bottom:12px}
  .pillar h3{margin:0 0 8px;font-size:1.12rem;letter-spacing:-.01em}
  .pillar p{margin:0;color:var(--muted);font-size:.96rem}

  /* tools grid */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
  .card{display:block;background:var(--card);border:1px solid var(--border);border-radius:16px;
    padding:22px;transition:transform .14s ease,border-color .14s ease,background .14s ease;position:relative}
  .card:hover{transform:translateY(-4px);border-color:var(--border-strong);background:var(--card-hover);text-decoration:none;box-shadow:var(--shadow)}
  .card .top{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .card .emoji{font-size:1.5rem;width:42px;height:42px;border-radius:11px;background:var(--bg-soft);display:grid;place-items:center;flex:none}
  .card h3{margin:0;font-size:1.1rem;color:var(--text);letter-spacing:-.01em}
  .card .url{font-size:.8rem;color:var(--accent);font-weight:600}
  .card p{margin:0;color:var(--muted);font-size:.93rem}
  .tag{position:absolute;top:16px;right:16px;font-size:.66rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:4px 9px;border-radius:999px}
  .tag.live{background:rgba(95,211,168,.14);color:var(--accent);border:1px solid rgba(95,211,168,.3)}
  .tag.build{background:rgba(244,184,96,.13);color:var(--accent-warm);border:1px solid rgba(244,184,96,.3)}
  .tag.idea{background:rgba(122,162,255,.13);color:var(--accent-2);border:1px solid rgba(122,162,255,.3)}

  /* build list */
  .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
  .chip{background:var(--card);border:1px solid var(--border-strong);color:var(--muted);
    padding:8px 16px;border-radius:999px;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .12s ease}
  .chip:hover{background:var(--card-hover);color:var(--text)}
  .chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
  .bcard{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;
    display:flex;flex-direction:column;gap:8px;position:relative}
  .bcard .cat{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:700}
  .bcard h3{margin:0;font-size:1.04rem;letter-spacing:-.01em;padding-right:74px}
  .bcard p{margin:0;color:var(--muted);font-size:.9rem;flex:1}
  .bcard .row{display:flex;align-items:center;gap:14px;margin-top:4px}
  .bcard .claim{font-size:.84rem;font-weight:700;color:var(--accent)}
  .bcard a.ext{font-size:.82rem;color:var(--faint)}
  .buildnote{margin-top:26px;color:var(--faint);font-size:.92rem;text-align:center}
  .claim-head{margin:48px 0 22px;text-align:center}
  .claim-head h3{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 8px;display:inline-flex;align-items:center;gap:10px}
  .claim-head p{color:var(--muted);max-width:640px;margin:0 auto;font-size:.98rem}
  .livedot{width:10px;height:10px;border-radius:50%;background:#ef5f5f;display:inline-block;box-shadow:0 0 0 0 rgba(239,95,95,.5);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(239,95,95,.5)}70%{box-shadow:0 0 0 8px rgba(239,95,95,0)}100%{box-shadow:0 0 0 0 rgba(239,95,95,0)}}
  .card.featured .needline{margin-bottom:8px;color:var(--muted);font-style:italic}
  .card.featured .why{margin-top:12px;font-size:.88rem}
  .card.featured .top>div{min-width:0}
  .card.featured h3{padding-right:72px}
  .card.featured h3 a{color:inherit}
  .card.featured .url{overflow-wrap:anywhere}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .badges li{font-size:.7rem;font-weight:650;padding:3px 8px;border-radius:999px;border:1px solid var(--border-strong);color:var(--muted)}
  .badges li.open{color:var(--accent);border-color:rgba(95,211,168,.35)}
  .why{font-size:.88rem;color:var(--muted);border-left:2px solid var(--accent-2);padding-left:10px;margin:0}
  .why b{color:var(--text);font-weight:650}
  .seemore{font-size:.86rem;font-weight:600;margin-top:auto}
  .direct{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  .direct a{color:var(--muted);text-decoration:underline}
  .witloading{color:var(--faint);padding:30px;grid-column:1/-1;text-align:center}
  .bcard .votes{font-size:.8rem;color:var(--faint);font-weight:600}
  .bcard .claimedby{font-size:.82rem;color:var(--accent-warm);font-weight:700}

  /* quote */
  blockquote{margin:0;background:var(--bg-soft);border:1px solid var(--border);border-left:4px solid var(--accent);
    border-radius:14px;padding:26px 30px;font-size:1.12rem;color:var(--text)}
  blockquote cite{display:block;margin-top:14px;font-size:.92rem;color:var(--faint);font-style:normal}

  /* lists row */
  .links-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .lcol{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px}
  .lcol h4{margin:0 0 12px;font-size:.95rem;color:var(--text)}
  .lcol ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .lcol li a{color:var(--muted);font-size:.9rem}
  .lcol li a:hover{color:var(--accent-2)}

  /* CTA */
  .cta-band{background:linear-gradient(120deg,rgba(95,211,168,.10),rgba(122,162,255,.10));
    border:1px solid var(--border-strong);border-radius:22px;padding:48px;text-align:center}
  .cta-band h2{font-size:clamp(1.6rem,3.4vw,2.2rem);margin:0 0 12px;letter-spacing:-.02em}
  .cta-band p{color:var(--muted);max-width:620px;margin:0 auto 26px;font-size:1.05rem}

  footer{padding:48px 0 60px;border-top:1px solid var(--border);color:var(--faint);font-size:.88rem}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:18px;align-items:center}
  footer a{color:var(--muted)}
  .ver{font-variant-numeric:tabular-nums;opacity:.7}

  /* Contribute modal */
  .modal-overlay{display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px}
  .modal-overlay.open{display:flex;align-items:flex-start;justify-content:center}
  .modal-box{background:var(--bg-soft);border:1px solid var(--border-strong);border-radius:16px;width:100%;max-width:640px;margin:auto;padding:32px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.7)}
  .modal-close{position:absolute;top:16px;right:16px;background:var(--card);border:1px solid var(--border-strong);color:var(--text);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:1.1rem;display:grid;place-items:center;line-height:1}
  .modal-close:hover{background:var(--card-hover)}
  .modal-eyebrow{font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:12px;font-weight:600}
  .modal-title{font-size:1.55rem;font-weight:600;letter-spacing:-.02em;margin-bottom:6px}
  .modal-sub{color:var(--muted);font-size:.92rem;margin-bottom:24px;line-height:1.5}
  .m-field{margin-bottom:16px}
  .m-field label{display:block;font-size:.8rem;color:var(--muted);font-family:monospace;margin-bottom:6px;letter-spacing:.04em}
  .m-field label span{color:var(--faint)}
  .m-field input,.m-field textarea{width:100%;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;color:var(--text);font-family:inherit;font-size:.93rem;padding:10px 14px;outline:none;transition:border-color .15s}
  .m-field input:focus,.m-field textarea:focus{border-color:var(--accent-2)}
  .m-field input::placeholder,.m-field textarea::placeholder{color:var(--faint)}
  .m-field textarea{resize:vertical;min-height:80px;line-height:1.5}
  .m-submit{display:block;width:100%;padding:13px;background:linear-gradient(110deg,var(--accent),var(--accent-2));color:#06120d;font-family:inherit;font-size:.9rem;font-weight:700;border:none;border-radius:8px;cursor:pointer;letter-spacing:.03em;transition:opacity .15s;margin-top:4px}
  .m-submit:hover{opacity:.9}
  .m-submit:disabled{opacity:.38;cursor:not-allowed}
  .m-status{font-family:monospace;font-size:.78rem;color:var(--muted);margin-top:12px;text-align:center;min-height:18px}
  .m-results{margin-top:24px;display:none}
  .m-results.show{display:block}
  .m-profile{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px}
  .m-profile-name{font-size:1.1rem;font-weight:600;margin-bottom:2px}
  .m-profile-role{font-size:.75rem;color:var(--accent-warm);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;font-family:monospace}
  .m-profile-bio{color:var(--muted);font-size:.88rem;line-height:1.6}
  .m-match{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px;transition:border-color .15s}
  .m-match:hover{border-color:var(--border-strong)}
  .m-match-name{font-size:.85rem;font-weight:600;color:var(--accent-2);margin-bottom:4px}
  .m-match-fit{font-size:.87rem;color:var(--text);margin-bottom:8px;line-height:1.5}
  .m-match-quest{font-size:.78rem;color:var(--accent);border-left:2px solid var(--accent);padding-left:10px;line-height:1.45}
  .m-match-link{display:inline-block;margin-top:8px;font-family:monospace;font-size:.72rem;color:var(--faint)}
  .m-save-row{margin-top:20px;padding-top:18px;border-top:1px solid var(--border);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .m-save-btn{padding:9px 20px;background:transparent;border:1px solid var(--accent-2);color:var(--accent-2);font-family:inherit;font-size:.8rem;font-weight:600;border-radius:8px;cursor:pointer;transition:all .15s;white-space:nowrap}
  .m-save-btn:hover{background:var(--accent-2);color:var(--bg)}
  .m-save-note{font-size:.78rem;color:var(--faint);flex:1}
  .m-save-ok{font-family:monospace;font-size:.78rem;color:var(--accent);display:none}
  .m-save-ok.show{display:block}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#top"><span class="logo">🌍</span> Humanity Infrastructure <span style="color:var(--faint);font-weight:500">· The Codex</span></a>
  <div class="nav-links">
    <a href="#manifesto">Manifesto</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">The Vision</a>
    <a href="#submit">Submit a resource</a>
    <a href="#join">Join</a>
    <a class="gh" href="https://github.com/tmad4000/humanity-infrastructure" target="_blank" rel="noopener" aria-label="Humanity Infrastructure on GitHub">GitHub ↗</a>
    <button class="theme-btn" id="themeBtn" title="Toggle light/dark" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <span class="eyebrow">Basic Infrastructure for Human Flourishing</span>
  <h1>Knowledge is a <span class="grad">birthright</span>.<br/>So are the tools to use it.</h1>
  <p class="lede">A codex of human know-how as a public resource to humanity — plus the open-source software to coordinate human activity around it. The not-just-engineering equivalent of the open-source movement.</p>
  <p class="sub">“Building tools for the well-intended.” This is how we coordinate as a superorganism.</p>
  <div class="btns">
    <a class="btn primary" href="#tools">Explore the tools →</a>
    <button class="btn ghost" onclick="openContribute()" style="cursor:pointer;font-size:inherit">Find your contribution →</button>
  </div>
</div></header>

<section id="manifesto"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Premise</div>
    <h2>Imagine it were everyone's birthright to access the sum-total of human know-how.</h2>
    <p>The Codex is a hub of knowledge resources and open-source infrastructure — built to bring human flourishing into every person's reach. We envision something most of the developed world eventually becomes part of, to a greater or lesser degree.</p>
  </div>
  <div class="pillars">
    <div class="pillar"><div class="ico">📖</div><h3>Knowledge as a public good</h3><p>Survival and thriving guides, medical know-how, open curricula, role-model casting, the craftsmanship that is all software. Shouldn't software from 10 years ago be free by now?</p></div>
    <div class="pillar"><div class="ico">🛠️</div><h3>Tools that make people independent</h3><p>Open reputation systems, collective-action tools, personal-leverage automation, assistive tech. Hacked-together infrastructure that helps people help themselves.</p></div>
    <div class="pillar"><div class="ico">🤝</div><h3>Coordinate as a superorganism</h3><p>Guilds taking on epic quests. Global sense-making. Volunteerism, philanthropy for everyone, and ways to pitch in on the problems that matter — together.</p></div>
    <div class="pillar"><div class="ico">🌱</div><h3>Flourishing in reach for all</h3><p>From "how to thrive as a highly sensitive person on a budget" to "how to rebuild society from scratch." Compassionate, practical, and free.</p></div>
  </div>
</div></section>

<section id="tools"><div class="wrap">
  <div class="section-head">
    <div class="kicker">Tools</div>
    <h2>Pieces of the infrastructure that already exist</h2>
    <p>Find tools for practical needs, from offline knowledge to shared civic work. Free to use. Open where possible. Featured listings show license, platform and maker. <a href="#submit">Suggest a resource →</a></p>
  </div>
  <div class="grid">
    <article class="card featured" id="lastbook">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">📖</span><div><h3><a href="https://lastbook.org" target="_blank" rel="noopener">Lastbook</a></h3><div class="url">lastbook.org</div></div></div>
      <p class="needline">Knowledge that survives when the internet doesn't</p>
      <p>A free, open-source offline library of practical manuals, videos and maps, with optional local AI. Knowledge for preparedness and rebuilding, available after setup without an internet connection.</p>
      <ul class="badges"><li class="open">Open source · MIT</li><li>Mac · Windows · Linux</li><li>By farbood &amp; contributors</li></ul>
      <p class="why"><b>Why it's here:</b> when the network goes down, the knowledge shouldn't. A library you can hand to a neighbour on a drive.</p>
    </article>
    <article class="card featured" id="paxi">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">🚕</span><div><h3><a href="https://paxi.fyi" target="_blank" rel="noopener">Paxi</a></h3><div class="url">paxi.fyi</div></div></div>
      <p class="needline">Use the best service for each task, without interface lock-in</p>
      <p>Compares live ride prices and times across Uber, Lyft, Waymo, Tesla, Zoox, Curb and more, then books the one you choose. Your logins stay on your phone.</p>
      <ul class="badges"><li>Free · closed source</li><li>iPhone (iOS 17+)</li><li>By Doug Feigelson, a friend of the maintainer</li></ul>
      <p class="why"><b>Why it's here:</b> every app wants to be the only door. You should be able to compare providers, choose the best one for each job and switch freely. <a href="https://github.com/tmad4000/humanity-infrastructure/issues/2" target="_blank" rel="noopener">Community submission #2</a>.</p>
    </article>
    <a class="card" href="https://nvctranslator.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🕊️</span><div><h3>NVC Translator</h3><div class="url">nvctranslator.com</div></div></div>
      <p>Translate any text into Marshall Rosenberg's Nonviolent Communication — observations, feelings, needs, requests. How can AI make us more compassionate?</p>
    </a>
    <a class="card" href="https://globalbr.ai" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🧠</span><div><h3>Noos</h3><div class="url">globalbr.ai</div></div></div>
      <p>A universal knowledge graph — the "codex" backend. Capture, connect, and query human know-how with per-node privacy.</p>
    </a>
    <a class="card" href="https://wikihub.md" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">📚</span><div><h3>WikiHub</h3><div class="url">wikihub.md</div></div></div>
      <p>GitHub for LLM wikis. Hosting for open, agent-native markdown knowledge bases — forkable, shareable, version-controlled.</p>
    </a>
    <a class="card" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🌐</span><div><h3>World Issue Tracker</h3><div class="url">worldissuetracker.com</div></div></div>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
    </a>
    <article class="card featured" id="signudoc">
      <span class="tag live">Featured</span>
      <div class="top"><span class="emoji">✍️</span><div><h3><a href="https://github.com/NYLLON-SOFTWARE/SignuDoc" target="_blank" rel="noopener">SignuDoc</a></h3><div class="url">github.com/NYLLON-SOFTWARE/SignuDoc</div></div></div>
      <p class="needline">Open document signing infrastructure</p>
      <p>Open-source e-signatures. Send, sign and seal documents from your own cloud at $0 per seat, with audit trails and tamper-evident seals.</p>
      <ul class="badges"><li class="open">Open source · MIT</li><li>Self-hosted on your Vercel account</li><li>By Kevin Rose / NYLLON</li></ul>
      <p class="why"><b>Why it's here:</b> agreeing on things is basic civic plumbing. Signing a PDF shouldn't need a per-seat licence or someone else's cloud.</p>
    </article>
    <a class="card" href="https://tmad4000.github.io/brainstorms/" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">💡</span><div><h3>Idea List</h3><div class="url">tmad4000.github.io/brainstorms</div></div></div>
      <p>An open idea bank — projects, hackathon ideas, and easily-solvable world problems, free for anyone to take and build.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/claude-mind" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">🔬</span><div><h3>Claude Mind</h3><div class="url">github.com/tmad4000/claude-mind</div></div></div>
      <p>Collaborative AI–human exploration of open problems — research rabbits and guilds working the quests, Polymath-style.</p>
    </a>
    <a class="card" href="https://github.com/tmad4000/vibe-coding-guide" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">⚡</span><div><h3>Vibe Coding Guide</h3><div class="url">github.com/tmad4000/vibe-coding-guide</div></div></div>
      <p>Open guide to AI-assisted coding — making the craftsmanship of software buildable by everyone.</p>
    </a>
  </div>
</div></section>

<section><div class="wrap">
  <blockquote>
    “We need these tools, all of them, and to be honest with you, they need to be in the hands of everybody… When humans come into guilds to do epic quests, they're problem-solving, they're inventing a solution. That's how this planet's going to get fixed.”
    <cite>— Jack Park, on guilds &amp; global sense-making</cite>
  </blockquote>
</div></section>

<section id="buildlist"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Open Build List</div>
    <h2>What still needs to be built</h2>
    <p>The infrastructure for human flourishing is mostly <em>not built yet</em>. Below is the running list — ideas, works-in-progress, and what's done. Lifted from the Codex master doc; we'll keep pulling in more from across the lists. See one you want to build? <strong>Claim it.</strong></p>
  </div>
  <div class="filters" id="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="idea">💡 Ideas</button>
    <button class="chip" data-f="building">🔨 In progress</button>
    <button class="chip" data-f="done">✅ Done</button>
  </div>
  <div class="grid" id="buildgrid"></div>
  <p class="buildnote">This list is open. Add an idea or claim one on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Missing Civilization Infrastructure</a> board — or email <a href="mailto:jacob@ideaflow.io?subject=Open%20Build%20List">jacob@ideaflow.io</a>.</p>

  <div class="claim-head">
    <h3><span class="livedot"></span> Claim a quest — live from the tracker</h3>
    <p>These ideas are filed as real, public issues on the <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">World Issue Tracker</a>. Vote, discuss, or claim one to build — updates here in real time.</p>
  </div>
  <div class="grid" id="witgrid"><div class="witloading">Loading open quests from the tracker…</div></div>
</div></section>

<section id="vision"><div class="wrap">
  <div class="section-head">
    <div class="kicker">The Living Document</div>
    <h2>The full vision — and where to add to it</h2>
    <p>The Codex is an open, growing document. These are the canonical sources behind this page. Add yourself, add a project, add a resource.</p>
  </div>
  <div class="links-cols">
    <div class="lcol">
      <h4>📜 Read the source</h4>
      <ul>
        <li><a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Humanity 3.0 &amp; the Dharmic blueprint (Notion)</a></li>
        <li><a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">The Codex — master doc (Google Docs)</a></li>
        <li><a href="https://plausible-text-76b.notion.site/Cody-s-Healing-List-v4-b05b097d529c4c54b5d62f87f55b1f6f" target="_blank" rel="noopener">Healing Resources — "Cody Codex" (Notion)</a></li>
        <li><a href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">World Quest Guild — add yourself</a><span class="direct">Short link: <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</span></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="https://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="https://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="https://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="https://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="https://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="https://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="https://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="https://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="https://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="https://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="submit"><div class="wrap">
  <h2>What else should be featured?</h2>
  <p>Help grow Humanity Infrastructure. Suggest useful tools, open knowledge, practical guides or projects that help people flourish. You do not need to be a developer.</p>
  <p>Send the name, link, a short description and who it helps. Include access or licensing details and any affiliation. We review suggestions before featuring them.</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0">
    <a class="btn primary" href="https://github.com/tmad4000/humanity-infrastructure/issues/new?template=suggest-resource.yml">Suggest a resource on GitHub →</a>
    <a class="btn ghost" href="mailto:jacob@ideaflow.io?subject=Humanity%20Infrastructure%20resource%20suggestion&amp;body=Name%3A%0ALink%3A%0AWho%20it%20helps%3A%0AAccess%20or%20license%3A%0AMy%20affiliation%3A">Suggest by email</a>
    <a class="btn ghost" href="https://github.com/tmad4000/humanity-infrastructure/blob/main/CONTRIBUTING.md">Contribute a pull request →</a>
  </div>
  <p><a href="https://github.com/tmad4000/humanity-infrastructure">Browse the website source on GitHub</a> · <a href="https://index.ideaflow.app/build" target="_blank" rel="noopener">Build on Ideaflow</a> · <a href="https://index.ideaflow.app" target="_blank" rel="noopener">Ideaflow apps index</a> · <a href="https://worldissuetracker.com/tracker/lastbook">Lastbook community feedback and fixes</a></p>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band">
    <h2>If you're not part of this, what are you doing with your life?</h2>
    <p>We're building the more general, not-just-engineering equivalent of the open-source movement. There's an enormous amount of low-hanging fruit — and we're looking for designers, engineers, writers, healers, and well-intended humans of every kind.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="mailto:jacob@ideaflow.io?subject=Joining%20the%20Codex%20%2F%20Humanity%20Infrastructure">Get involved →</a>
      <a class="btn ghost" href="https://docs.google.com/document/d/1OggVeoEN4zAafRAox3yjFYtNwmYFJQHovXLviWI69zY/edit" target="_blank" rel="noopener">Join a guild</a>
    </div>
    <span class="direct">World Quest Guild · short link <a href="https://quests.world" target="_blank" rel="noopener">quests.world</a> (being repaired)</span>
  </div>
</div></section>

<footer><div class="wrap">
  <div>
    <strong style="color:var(--text)">Humanity Infrastructure · The Codex</strong> — basic infrastructure for human flourishing.<br/>
    Free to use. Open where possible. Featured listings show their license. <a href="https://github.com/tmad4000/humanity-infrastructure">Source on GitHub</a> · Contact <a href="mailto:jacob@ideaflow.io">jacob@ideaflow.io</a>
  </div>
  <div style="text-align:right">
    <a href="https://www.notion.so/jacobblog/Humanity-3-0-and-Dharmic-blueprint-314fda9cff6380bfae57ff843cce32dd" target="_blank" rel="noopener">Blueprint (Notion)</a> ·
    <a href="https://docs.google.com/document/d/1-dxQdUBJ50f7qMO3lTemHEYcT7XUe4pOTgetf_KcMk0/edit" target="_blank" rel="noopener">Master doc</a><br/>
    <span class="ver">v0.5.1 · 2026-11-17</span>
  </div>
</div>
  <!-- Design versions + legacy -->
  <div style="border-top:1px solid var(--border);margin-top:48px;padding-top:24px;display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;opacity:.5;font-size:.78rem;">
    <span style="font-family:monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);">Design versions →</span>
    <a href="/" style="color:var(--accent-2);">v1 — Original / Dark (current)</a>
    <a href="/v2" style="color:var(--accent-2);">v2 — Editorial / Red</a>
    <a href="/v3" style="color:var(--accent-2);">v3 — Dark Blueprint</a>
  </div>
</footer>

<!-- Contribute modal -->
<div class="modal-overlay" id="contributeModal" onclick="closeContributeIfBg(event)">
  <div class="modal-box">
    <button class="modal-close" onclick="closeContribute()" aria-label="Close">✕</button>
    <div class="modal-eyebrow">Find your quest</div>
    <div class="modal-title">How can you contribute?</div>
    <div class="modal-sub">Share a bit about yourself and we'll match you to the open infrastructure projects where you'd have the most impact.</div>
    <div class="m-field">
      <label for="m-twitter">X / Twitter handle <span>(optional)</span></label>
      <input id="m-twitter" type="text" placeholder="@handle or x.com/handle"/>
    </div>
    <div class="m-field">
      <label for="m-linkedin">LinkedIn URL <span>(optional)</span></label>
      <input id="m-linkedin" type="url" placeholder="linkedin.com/in/yourname"/>
    </div>
    <div class="m-field">
      <label for="m-homepage">Personal website or portfolio <span>(optional)</span></label>
      <input id="m-homepage" type="url" placeholder="https://yoursite.com"/>
    </div>
    <div class="m-field">
      <label for="m-about">About you <span>(work, interests, what you want to build)</span></label>
      <textarea id="m-about" placeholder="e.g. I'm a therapist who's been thinking about AI and nonviolent communication…"></textarea>
    </div>
    <button class="m-submit" id="m-analyzeBtn" onclick="mRunAnalysis()">Find my contribution →</button>
    <div class="m-status" id="m-status"></div>
    <div class="m-results" id="m-results">
      <div class="m-profile" id="m-profile"></div>
      <div id="m-matches"></div>
      <div class="m-save-row">
        <button class="m-save-btn" id="m-saveBtn" onclick="mSave()">Save to World Issue Tracker →</button>
        <span class="m-save-note">Creates a public profile in the HI Contributors tracker</span>
        <span class="m-save-ok" id="m-saveOk"></span>
      </div>
    </div>
  </div>
</div>

<script>
  // ---- Open Build List data (lifted from the Codex master doc) ----
  var BUILD=[
    {c:"Collective Action",t:"ThunderPledge",s:"idea",u:"https://thunderpledge.jacobcole.net",d:"Kickstarter for collective action: pledge to go vegetarian, vote, or boycott — but only once a critical mass also commits. Variants: ThunderVote, ThunderBoycott ('Kickstopper')."},
    {c:"Collective Action",t:"Zero-Sum Redirect",s:"idea",d:"A clearinghouse for opposing political donations — matched contributions cancel out and the saved money goes to charity instead."},
    {c:"Collective Action",t:"Government Suggestion Box",s:"idea",d:"A suggestion-box platform for governments, including the ability to donate toward implementing specific suggestions."},
    {c:"Collective Action",t:"Everyone-a-Philanthropist",s:"idea",d:"Infrastructure so communities can pool resources to fill missing government functions — help a neighbor afford insurance, get a kid a laptop."},
    {c:"Collective Action",t:"Resource-Sharing Platform",s:"idea",u:"https://favorverse.jacobcole.net/",d:"Let people share what they can lend — tools, a U-Haul, time. Related: Favorverse & VolunteerForce."},
    {c:"Reputation & Trust",t:"Open Reputation System",s:"idea",d:"A portable, open reputation layer — the missing primitive for trust in online coordination."},
    {c:"Reputation & Trust",t:"Trust Layer / Meta-Brands",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A trust layer for the web — 'meta-brands' that vouch for quality and integrity."},
    {c:"Reputation & Trust",t:"Fact-Check Extension",s:"idea",u:"https://factcheck.jacobcole.net/",d:"A browser extension surfacing fact-checks and provenance inline."},
    {c:"Fixing the Internet",t:"Open Forum Software",s:"building",u:"https://github.com/gulkily/pollyanna",d:"Forum software that is transparent, consensual, and open-source (Pollyanna)."},
    {c:"Fixing the Internet",t:"Minimalist Homepages",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A better way to make calm, minimalist personal homepages."},
    {c:"Fixing the Internet",t:"ThoughtfulWeb",s:"idea",u:"https://thoughtfulweb.jacobcole.net",d:"A directory of places on the web that are thoughtful, artful, and mindful — an oasis of good taste."},
    {c:"Personal Leverage",t:"'Camel's Eye' Email Agent",s:"idea",d:"An agent that filters and triages email on your behalf (from Permutation City). Reclaim your attention."},
    {c:"Personal Leverage",t:"Shortcut / Macro Coach",s:"idea",d:"Watches your actions and occasionally suggests a shortcut, auto-writing the macro for you."},
    {c:"Personal Leverage",t:"Open Automation Tools",s:"idea",d:"Great open-source macro & browser-automation frameworks (Browserflow-style) for everyone."},
    {c:"Personal Leverage",t:"Shopping Coach",s:"idea",d:"A service that shops on your behalf — finds the best, most ethical option so you don't have to."},
    {c:"Open Knowledge",t:"Open Meditation Curricula",s:"building",u:"https://meditation.jacobcole.net/",d:"Basic open curricula for meditation and working with your body. Lists exist; needs a real course."},
    {c:"Open Knowledge",t:"Open Medical Knowledge",s:"building",u:"https://chronicpain.jacobcole.net/",d:"How to treat chronic pain, RSI, and more — patient-first medical know-how. Lists started."},
    {c:"Open Knowledge",t:"Open Academic Education",s:"idea",d:"University-level math, an open algorithms tutor, and interactive self-teaching programming resources."},
    {c:"Open Knowledge",t:"Open Work Templates",s:"idea",d:"Open templates for every kind of work — invoices, gantt charts, proposals."},
    {c:"Open Knowledge",t:"Role-Model Casting",s:"idea",u:"https://foodslist.jacobcole.net/",d:"For people without good role models — emulate the routines of healthy, effective people (e.g. foods lists)."},
    {c:"Open Knowledge",t:"Motivation Database",s:"idea",u:"https://whyisitawesome.jacobcole.net/",d:"A wiki of why all the awesome things in the world are awesome — fuel for motivation."},
    {c:"Open Knowledge",t:"'Books to Grow Up On'",s:"idea",u:"https://kidactivities.jacobcole.net",d:"An open list of literature that builds good mental models — plus kids' games & activities."},
    {c:"Assistive Tech",t:"Hands-Free Voice Interfaces",s:"idea",d:"Good hands-free voice-recognition hooks into common sites (Gmail, etc.) for quadriplegics and others. Lots of low-hanging fruit."},
    {c:"Assistive Tech",t:"Cueing App for Brain Injuries",s:"idea",d:"A cueing/reminder app for people recovering from brain injuries."},
    {c:"Assistive Tech",t:"Better Foot Mouse",s:"idea",d:"A better foot-operated mouse for people who can't use their hands."},
    {c:"Coordination Infra",t:"On-the-Fly Knowledge Capture",s:"building",u:"https://globalbr.ai",d:"Frictionless personal knowledge capture + a graph query engine. Being built as Noos."},
    {c:"Coordination Infra",t:"Global Idea Bank",s:"building",u:"https://tmad4000.github.io/brainstorms/",d:"An open bank of ideas & hackathon projects anyone can take and build. Live as the Idea List."},
    {c:"Coordination Infra",t:"Open Research Repository",s:"idea",u:"https://worldissuetracker.com/tracker/missing-civ-infrastructure",d:"A global, open repository for research — make the world's findings freely usable."},
    {c:"Care & Society",t:"Adult 'Foster' Support Network",s:"idea",d:"Ubiquitous support — 'extra parents' — for adults facing challenges so no one falls through the cracks."},
    {c:"Care & Society",t:"Non-Emergency Help Button",s:"idea",d:"A button to request non-emergency help: a compassionate responder for mental-health crises, a care coordinator, a 'life figure-outer'."},
    {c:"Care & Society",t:"Database of Survival Guides",s:"idea",d:"'How to survive/thrive' guides across many contexts — including for highly sensitive people on a budget."},
    {c:"Care & Society",t:"Database of Human Ideals",s:"idea",d:"Documenting the multiplicity of happy cultures and ways of being."},
    {c:"Done",t:"OpenLibrary",s:"done",u:"https://openlibrary.org",d:"Open, universal catalog of books. Exists — and it's wonderful."},
    {c:"Done",t:"Internet Archive",s:"done",u:"https://archive.org",d:"Humanity's library and memory. Exists — support it."},
    {c:"Done",t:"Concentration Music",s:"done",d:"Open 'music for concentration' playlists everyone can access. Largely solved."},
    {c:"Fixing the Internet",t:"Cross-Site Hashtag Search",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Search a hashtag uniformly across every social platform and website at once."},
    {c:"Fixing the Internet",t:"Universal Comments Layer",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Attach comment threads to any webpage, email, or chat, viewable by anyone."},
    {c:"Fixing the Internet",t:"Universal Web Annotations",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared highlight-and-note layer that pins annotations onto any page across the web."},
    {c:"Open Knowledge",t:"Canonical Debate Lab",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A structured platform that organizes contested claims and their arguments toward resolution."},
    {c:"Open Knowledge",t:"Scientific Assertions Database",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A machine-readable repository of scientific claims with their dependencies and evidence mapped."},
    {c:"Open Knowledge",t:"Collaborative Theorem Prover",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A shared workspace where mathematicians jointly build and verify formal proofs."},
    {c:"Open Knowledge",t:"Negative Results Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"An archive of failed experiments and null results so research isn't needlessly duplicated."},
    {c:"Open Knowledge",t:"Argument Repository",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A searchable database of debate outlines and reusable argumentative frameworks."},
    {c:"Coordination Infra",t:"Policy & Science Simulator",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A sandbox for safely testing policy changes and hypotheses before real-world rollout."},
    {c:"Personal Leverage",t:"Unified Feed Control",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A single interface managing emails, texts, calls, and feeds with user-defined routing rules."},
    {c:"Fixing the Internet",t:"Soundbite Propagation Tracker",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Audio-fingerprinting that traces how a specific quote or claim spreads across media."},
    {c:"Civic & Government",t:"Global Goals Dashboard",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A public dashboard visualizing humanity's measured progress on major shared objectives."},
    {c:"Collective Action",t:"Conditional Voting Pledge",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Citizens commit to vote only if enough peers in their district also pledge, then all activate together."},
    {c:"Care & Society",t:"Favor-Matching Network",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Maps friends' skills so people can request and exchange favors locally."},
    {c:"Health & Body",t:"ICU & Ventilator Tracker",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A real-time map of available ventilators and ICU beds across hospitals during a crisis."},
    {c:"Care & Society",t:"Proximity Hangout Suggester",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Alerts you to nearby friends and suggests a meetup without persistent location tracking."},
    {c:"Fixing the Internet",t:"Political Bias Classifier",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"An ML tool that detects and labels politically biased content in social feeds."},
    {c:"Climate & Sustainability",t:"Wildfire Satellite Detection",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A model that flags forest fires early from satellite imagery."},
    {c:"Personal Leverage",t:"Ingredient Recipe Finder",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"Recommends recipes from what's in your kitchen and pairs you with a cooking partner."},
    {c:"Reputation & Trust",t:"Used-Car History Database",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A verified repository of repair and inspection histories for used vehicles."},
    {c:"Open Knowledge",t:"Idea Graph IDE",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A graph workspace that links hackathon and startup ideas by relationship."},
    {c:"Open Knowledge",t:"Curiosity Thread Maps",s:"idea",u:"https://hackathonprojects.jacobcole.net/",d:"A platform charting question-to-question sequences that lead from curiosity to expertise."},
    {c:"Open Knowledge",t:"Best-in-Class Tool Registry",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"A curated directory of the top tool for each purpose, organized by use case."},
    {c:"Coordination Infra",t:"Curated List Publishing",s:"idea",u:"https://fixingtheinternet.jacobcole.net/",d:"Lets curators easily publish and distribute thematic lists and recommendations."},
    {c:"Personal Leverage",t:"Context Engineering Prize",s:"idea",u:"https://jacobcole.ai/brainstorms/",d:"A competition to get small models to frontier-level performance through better context."}
  ];
  (function(){
    var grid=document.getElementById('buildgrid'), filters=document.getElementById('filters');
    var labels={idea:["idea","💡 Idea"],building:["build","🔨 In progress"],done:["done","✅ Done"]};
    function render(f){
      grid.innerHTML='';
      BUILD.filter(function(b){return f==='all'||b.s===f}).forEach(function(b){
        var lab=labels[b.s]||["idea","Idea"];
        var ext=b.u?'<a class="ext" href="'+b.u+'" target="_blank" rel="noopener">↗ link</a>':'';
        var claim='<a class="claim" href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Claim →</a>';
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+lab[0]+'">'+lab[1]+'</span><div class="cat">'+b.c+'</div><h3>'+b.t+'</h3><p>'+b.d+'</p><div class="row">'+claim+ext+'</div>';
        grid.appendChild(el);
      });
    }
    filters.addEventListener('click',function(e){
      if(e.target.classList.contains('chip')){
        [].forEach.call(filters.children,function(c){c.classList.remove('active')});
        e.target.classList.add('active');
        render(e.target.getAttribute('data-f'));
      }
    });
    render('all');
  })();

  // ---- Live WIT-backed claim grid ----
  (function(){
    var WIT="https://api.worldissuetracker.com/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100";
    var grid=document.getElementById('witgrid');
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
    function issueUrl(i){try{return new URL(i.canonical_issue_url || ('/issue/'+encodeURIComponent(i.slug||'')), 'https://worldissuetracker.com').href}catch(e){return 'https://worldissuetracker.com/tracker/missing-civ-infrastructure'}}
    fetch(WIT).then(function(r){return r.json()}).then(function(d){
      var issues=(d.issues||d.data||[]).filter(function(i){return !i.deleted_at && i.status!=='closed'});
      if(!issues.length){grid.innerHTML='<div class="witloading">No open quests yet — <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">file the first one →</a></div>';return}
      issues.sort(function(a,b){return (b.votes||0)-(a.votes||0)});
      grid.innerHTML='';
      issues.forEach(function(i){
        var assignee=i.assignee_display_name;
        var action=assignee
          ? '<span class="claimedby">✓ Claimed by '+esc(assignee)+'</span>'
          : '<a class="claim" href="'+issueUrl(i)+'" target="_blank" rel="noopener">Claim →</a>';
        var votes=(i.votes!=null)?'<span class="votes">▲ '+i.votes+'</span>':'';
        var desc=esc((i.description||'').split(' Part of the Humanity')[0]).slice(0,150);
        var el=document.createElement('div');
        el.className='bcard';
        el.innerHTML='<span class="tag '+(assignee?'build':'idea')+'">'+(assignee?'🔨 Claimed':'💡 Open')+'</span>'
          +'<div class="cat">'+esc(i.category||'infrastructure')+'</div>'
          +'<h3><a href="'+issueUrl(i)+'" target="_blank" rel="noopener" style="color:inherit">'+esc(i.title)+'</a></h3>'
          +'<p>'+desc+'</p>'
          +'<div class="row">'+action+votes+'<a class="ext" href="'+issueUrl(i)+'" target="_blank" rel="noopener">↗ discuss</a></div>';
        grid.appendChild(el);
      });
    }).catch(function(){
      grid.innerHTML='<div class="witloading">Couldn’t load the live tracker. <a href="https://missing-civ-infrastructure.worldissuetracker.com/" target="_blank" rel="noopener">Open it directly →</a></div>';
    });
  })();

  (function(){
    var root=document.documentElement, btn=document.getElementById('themeBtn');
    var saved=null; try{saved=localStorage.getItem('h3-theme')}catch(e){}
    if(saved){root.setAttribute('data-theme',saved)}
    function sync(){btn.textContent=root.getAttribute('data-theme')==='dark'?'☀️':'🌙'}
    sync();
    btn.addEventListener('click',function(){
      var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
      root.setAttribute('data-theme',next);
      try{localStorage.setItem('h3-theme',next)}catch(e){}
      sync();
    });
  })();

  // ---- Contribute modal ----
  var mResult = null;
  function openContribute(){
    document.getElementById('contributeModal').classList.add('open');
    document.body.style.overflow='hidden';
  }
  function closeContribute(){
    document.getElementById('contributeModal').classList.remove('open');
    document.body.style.overflow='';
  }
  function closeContributeIfBg(e){
    if(e.target===document.getElementById('contributeModal')) closeContribute();
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape') closeContribute();});

  async function mRunAnalysis(){
    var btn=document.getElementById('m-analyzeBtn');
    var status=document.getElementById('m-status');
    var results=document.getElementById('m-results');
    var twitter=document.getElementById('m-twitter').value.trim();
    var linkedin=document.getElementById('m-linkedin').value.trim();
    var homepage=document.getElementById('m-homepage').value.trim();
    var about=document.getElementById('m-about').value.trim();
    if(!twitter&&!linkedin&&!homepage&&!about){status.textContent='Please fill in at least one field.';return;}
    btn.disabled=true;
    status.textContent='Gathering your profile data…';
    results.classList.remove('show');
    try{
      var res=await fetch('/contribute/analyze',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({twitter_handle:twitter,linkedin_url:linkedin,homepage_url:homepage,about_text:about})
      });
      var data=await res.json();
      if(data.error){status.textContent='⚠ '+data.error;btn.disabled=false;return;}
      mResult=data;
      mRenderResults(data);
      status.textContent=data.sources&&data.sources.length?'Analyzed from: '+data.sources.join(', '):'';
      results.classList.add('show');
    }catch(e){status.textContent='Something went wrong. Try again?';}
    btn.disabled=false;
  }

  function mRenderResults(data){
    document.getElementById('m-profile').innerHTML=
      '<div class="m-profile-name">'+(data.name||'You')+'</div>'
      +'<div class="m-profile-role">'+(data.top_role||'')+'</div>'
      +'<div class="m-profile-bio">'+(data.summary||'')+'</div>';
    document.getElementById('m-matches').innerHTML=(data.matches||[]).map(function(m){
      return '<div class="m-match">'
        +'<div class="m-match-name">'+m.project+'</div>'
        +'<div class="m-match-fit">'+m.fit+'</div>'
        +'<div class="m-match-quest">Quest: '+m.quest+'</div>'
        +'<a class="m-match-link" href="'+m.url+'" target="_blank" rel="noopener">'+m.url+' ↗</a>'
        +'</div>';
    }).join('');
  }

  function mSaveFallback(ok){
    var r=mResult||{};var title='Contributor profile: '+(r.name||document.getElementById('m-twitter').value.trim()||'new contributor');
    var body='## About me\\n'+(r.summary||'')+'\\n\\n## Role\\n'+(r.top_role||'')+'\\n\\n(Posted from humanityinfrastructure.com because saving to the tracker failed.)';
    var gh='https://github.com/tmad4000/humanity-infrastructure/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    var mail='mailto:jacob@ideaflow.io?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    ok.innerHTML='Couldn’t save to the tracker right now. Your profile isn’t lost: <a href="'+gh+'" target="_blank" rel="noopener">post it as a GitHub issue</a> or <a href="'+mail+'">email it to us</a>.';
    ok.classList.add('show');
  }
  async function mSave(){
    var btn=document.getElementById('m-saveBtn');
    var ok=document.getElementById('m-saveOk');
    if(!mResult) return;
    btn.disabled=true; btn.textContent='Saving…';
    try{
      var res=await fetch('/contribute/save',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({},mResult,{handle:document.getElementById('m-twitter').value.trim()||document.getElementById('m-linkedin').value.trim()}))
      });
      var data=await res.json();
      if(data.success){btn.style.display='none';ok.textContent='✓ Saved! View at worldissuetracker.com/tracker/hi-contributors';ok.classList.add('show');}
      else{btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
    }catch(e){btn.textContent='Try saving again';btn.disabled=false;mSaveFallback(ok);}
  }
</script>
</body>
</html>
`
const OG_PNG = Uint8Array.from(atob('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'), c => c.charCodeAt(0))
