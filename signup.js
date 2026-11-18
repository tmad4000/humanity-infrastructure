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
