// Private patron interest: email plus the level someone would choose. No payment is taken,
// no mail is sent, nothing is written to the newsletter table and nothing here is public.
const PATRON_TIERS = { seed: 100, supporter: 300, patron: 1000, custom: null };
async function handlePatron(request, env, ctx) {
  const url = new URL(request.url);
  if (!['/api/patron-interest', '/admin/patron-interest.csv'].includes(url.pathname)) return null;
  try {
    if (url.pathname === '/admin/patron-interest.csv') {
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      if (!env.ADMIN_EXPORT_TOKEN || await signupHash(request.headers.get('Authorization') || '') !== await signupHash('Bearer ' + env.ADMIN_EXPORT_TOKEN)) return signupResponse({ error: 'Unauthorized' }, 401);
      const columns = ['id', 'email', 'tier', 'amount_cents', 'notify_opt_in', 'created_at', 'updated_at', 'source_page'];
      const rows = await env.SIGNUPS.prepare('SELECT ' + columns.join(',') + ' FROM patron_interest ORDER BY created_at').all();
      const csv = [columns.join(','), ...rows.results.map(row => columns.map(key => signupCsv(row[key])).join(','))].join('\r\n');
      return new Response(csv, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/csv;charset=UTF-8', 'Content-Disposition': 'attachment; filename="hi-patron-interest.csv"' } });
    }
    if (request.method !== 'POST') return signupResponse({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Origin') !== url.origin) return signupResponse({ error: 'Please send this from the patrons page.' }, 403);
    if (!env.SIGNUPS || !env.RATE_LIMIT_SALT) return signupResponse({ error: 'Temporarily unavailable.' }, 503);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return signupResponse({ error: 'Expected JSON' }, 415);
    if (Number(request.headers.get('Content-Length')) > 2048) return signupResponse({ error: 'Submission too large' }, 413);
    const reader = request.body?.getReader(); if (!reader) return signupResponse({ error: 'Empty submission' }, 400);
    let size = 0; const chunks = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); return signupResponse({ error: 'Submission too large' }, 413); } chunks.push(value); }
    let data; try { data = JSON.parse(await new Blob(chunks).text()); } catch { return signupResponse({ error: 'Invalid submission' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return signupResponse({ error: 'Invalid submission' }, 400);
    if (data.website) return signupResponse({ ok: true });
    const ip = request.headers.get('CF-Connecting-IP'); if (!ip) return signupResponse({ error: 'Temporarily unavailable.' }, 503);
    // Same atomic table, key and five-attempt hourly budget as /api/signup. Raw IPs are never stored.
    const hash = await signupHash(env.RATE_LIMIT_SALT + ':' + ip), hour = Math.floor(Date.now() / 3600000);
    const rate = await env.SIGNUPS.prepare('INSERT INTO signup_rate_limits (ip_hash, window, attempts) VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window = excluded.window THEN attempts + 1 ELSE 1 END, window = excluded.window RETURNING attempts').bind(hash, hour).first();
    if (rate.attempts > 5) return signupResponse({ error: 'Too many attempts. Please try again in an hour.' }, 429, { 'Retry-After': '3600' });
    await env.SIGNUPS.prepare('DELETE FROM signup_rate_limits WHERE window < ?').bind(hour - 24).run();
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return signupResponse({ error: 'Please enter a valid email address.' }, 400);
    if (typeof data.tier !== 'string' || !Object.hasOwn(PATRON_TIERS, data.tier)) return signupResponse({ error: 'Choose a level.' }, 400);
    let cents = PATRON_TIERS[data.tier];
    if (cents === null) {
      if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount < 1 || data.amount > 1000) return signupResponse({ error: 'Enter an amount between $1 and $1,000.' }, 400);
      cents = Math.round(data.amount * 100);
    }
    const source = typeof data.source_page === 'string' ? data.source_page.slice(0, 300) : '/patrons', now = new Date().toISOString();
    // One row per email. A repeat submission updates the chosen level; the response never says whether the email was new.
    await env.SIGNUPS.prepare('INSERT INTO patron_interest (id,email,tier,amount_cents,notify_opt_in,created_at,updated_at,source_page) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET tier = excluded.tier, amount_cents = excluded.amount_cents, notify_opt_in = excluded.notify_opt_in, updated_at = excluded.updated_at')
      .bind(crypto.randomUUID(), email, data.tier, cents, data.notify === true ? 1 : 0, now, now, source).run();
    return signupResponse({ ok: true });
  } catch { return signupResponse({ error: 'Temporarily unavailable. Please try again later.' }, 503); }
}
