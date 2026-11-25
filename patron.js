// Private patron routes: saved places (with an optional per-project split), software nominations
// and optional Ideaflow ID sign-in. No payment is taken, no mail is sent, nothing is written to the
// newsletter table and nothing here is public. PATRON_PROJECT_IDS is generated from patrons/catalog.json.
const PATRON_TIERS = { seed: 100, supporter: 300, patron: 1000, custom: null };
const PATRON_VOICE_RELATIONS = ['use', 'benefit', 'believe'];
const PATRON_ROUTES = ['/api/patron-voice', '/api/patron-voices', '/admin/patron-voices.csv', '/admin/patron-voices/moderate', '/api/patron-interest', '/api/patron-nominate', '/api/patron-session', '/auth/ideaflow/start', '/auth/ideaflow/callback', '/auth/ideaflow/signout', '/admin/patron-interest.csv', '/admin/patron-nominations.csv'];
const PATRON_ECOSYSTEMS = ['', 'npm', 'pypi', 'cargo', 'go', 'rubygems', 'homebrew', 'other'];
const IDEAFLOW_ID = { authorize: 'https://id.ideaflow.app/api/auth/oauth2/authorize', token: 'https://id.ideaflow.app/api/auth/oauth2/token', userinfo: 'https://id.ideaflow.app/api/auth/oauth2/userinfo' };
const PATRON_EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function patronB64(bytes) { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function patronUnB64(text) { return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
function patronCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return '';
}
// One network, one key: an IPv6 customer holds a whole /64, so only its first four groups are used.
function patronNet(ip) {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::'), left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
function patronSignInEnabled(env) { return Boolean(env.IDEAFLOW_CLIENT_ID && env.IDEAFLOW_CLIENT_SECRET && env.PATRON_SESSION_SECRET); }
async function patronSign(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PATRON_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return patronB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
// Returns {sub, email} for a valid, unexpired, correctly signed session cookie; otherwise null.
async function patronSession(request, env) {
  if (!patronSignInEnabled(env)) return null;
  const [body, mac] = patronCookie(request, 'hi_patron').split('.');
  if (!body || !mac) return null;
  if (await signupHash(mac) !== await signupHash(await patronSign(env, body))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(patronUnB64(body)));
    if (typeof data.sub !== 'string' || !data.sub || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { sub: data.sub, email: typeof data.email === 'string' ? data.email : '' };
  } catch { return null; }
}
async function patronReadJson(request, limit) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return { error: signupResponse({ error: 'Expected JSON' }, 415) };
  if (Number(request.headers.get('Content-Length')) > limit) return { error: signupResponse({ error: 'Submission too large' }, 413) };
  const reader = request.body?.getReader(); if (!reader) return { error: signupResponse({ error: 'Empty submission' }, 400) };
  let size = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); return { error: signupResponse({ error: 'Submission too large' }, 413) }; } chunks.push(value); }
  let data; try { data = JSON.parse(await new Blob(chunks).text()); } catch { return { error: signupResponse({ error: 'Invalid submission' }, 400) }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: signupResponse({ error: 'Invalid submission' }, 400) };
  return { data };
}
// Sixty units per salted address hash per hour, kept apart from the newsletter forms' budget. A submission costs five
// units (so twelve an hour); a stack scan costs one unit per package when that is more. Raw IPs are never stored.
async function patronRate(request, env, units = 5) {
  const ip = request.headers.get('CF-Connecting-IP'); if (!ip) return signupResponse({ error: 'Temporarily unavailable.' }, 503);
  const hash = await signupHash(env.RATE_LIMIT_SALT + ':patron:' + patronNet(ip)), hour = Math.floor(Date.now() / 3600000);
  const rate = await env.SIGNUPS.prepare('INSERT INTO signup_rate_limits (ip_hash, window, attempts) VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window = excluded.window THEN attempts + excluded.attempts ELSE excluded.attempts END, window = excluded.window RETURNING attempts').bind(hash, hour, units).first();
  if (rate.attempts > 60) return signupResponse({ error: 'Too many attempts. Please try again in an hour.' }, 429, { 'Retry-After': '3600' });
  await env.SIGNUPS.prepare('DELETE FROM signup_rate_limits WHERE window < ?').bind(hour - 24).run();
  return null;
}
async function patronCsv(request, env, table, columns, filename) {
  if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
  if (!env.ADMIN_EXPORT_TOKEN || await signupHash(request.headers.get('Authorization') || '') !== await signupHash('Bearer ' + env.ADMIN_EXPORT_TOKEN)) return signupResponse({ error: 'Unauthorized' }, 401);
  const rows = await env.SIGNUPS.prepare('SELECT ' + columns.join(',') + ' FROM ' + table + ' ORDER BY created_at').all();
  const csv = [columns.join(','), ...rows.results.map(row => columns.map(key => signupCsv(row[key])).join(','))].join('\r\n');
  return new Response(csv, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/csv;charset=UTF-8', 'Content-Disposition': 'attachment; filename="' + filename + '"' } });
}
function patronRedirect(location, cookies = []) {
  const headers = new Headers({ ...PRIVATE_HEADERS, Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

async function handlePatron(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname;
  if (!PATRON_ROUTES.includes(path)) return null;
  try {
    if (path === '/admin/patron-interest.csv') return patronCsv(request, env, 'patron_interest', ['id', 'email', 'tier', 'amount_cents', 'notify_opt_in', 'allocations', 'ideaflow_sub', 'created_at', 'updated_at', 'source_page'], 'hi-patron-interest.csv');
    if (path === '/admin/patron-voices.csv') return patronCsv(request, env, 'patron_voices', ['id', 'project_id', 'relation', 'comment', 'display_name', 'comment_status', 'created_at', 'updated_at'], 'hi-patron-voices.csv');
    if (path === '/admin/patron-voices/moderate') {
      // Owner-only: approve or decline one comment. A comment is public only while its status is 'approved'.
      if (request.method !== 'POST') return signupResponse({ error: 'Method not allowed' }, 405);
      if (!env.ADMIN_EXPORT_TOKEN || await signupHash(request.headers.get('Authorization') || '') !== await signupHash('Bearer ' + env.ADMIN_EXPORT_TOKEN)) return signupResponse({ error: 'Unauthorized' }, 401);
      const { data, error } = await patronReadJson(request, 1024); if (error) return error;
      if (typeof data.id !== 'string' || typeof data.updated_at !== 'string' || !['approved', 'declined'].includes(data.status)) return signupResponse({ error: 'Send the id and updated_at from the export, and a status of approved or declined.' }, 400);
      // The decision applies only to the text the moderator read: an edit since the export changes updated_at.
      const changed = await env.SIGNUPS.prepare("UPDATE patron_voices SET comment_status = ? WHERE id = ? AND comment != '' AND updated_at = ? RETURNING id").bind(data.status, data.id, data.updated_at).first();
      if (changed) return signupResponse({ ok: true });
      const exists = await env.SIGNUPS.prepare("SELECT id FROM patron_voices WHERE id = ? AND comment != ''").bind(data.id).first();
      return exists ? signupResponse({ error: 'That comment was edited after the export. Read it again.' }, 409) : signupResponse({ error: 'No comment with that id.' }, 404);
    }
    if (path === '/api/patron-voices') {
      // Public: how many people spoke up for each project, and the comments a person has approved. Nothing else leaves the table.
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      // Worker responses are not cached at the edge by header alone, so use the Cache API: one database read per 30 seconds per location.
      const edge = typeof caches !== 'undefined' && caches.default ? caches.default : null, cacheKey = new Request(url.origin + url.pathname);
      const hit = edge ? await edge.match(cacheKey) : null; if (hit) return hit;
      const totals = await env.SIGNUPS.prepare('SELECT project_id, relation, COUNT(*) AS n FROM patron_voices GROUP BY project_id, relation').all();
      const counts = {};
      for (const row of totals.results) {
        if (!PATRON_PROJECT_IDS.includes(row.project_id) || !PATRON_VOICE_RELATIONS.includes(row.relation)) continue;
        const entry = counts[row.project_id] || (counts[row.project_id] = { total: 0, use: 0, benefit: 0, believe: 0 });
        entry[row.relation] = row.n; entry.total += row.n;
      }
      const approved = await env.SIGNUPS.prepare("SELECT project_id, relation, comment, display_name, updated_at FROM patron_voices WHERE comment_status = 'approved' ORDER BY updated_at DESC LIMIT 20").all();
      const comments = approved.results.filter(row => PATRON_PROJECT_IDS.includes(row.project_id)).map(row => ({ project: row.project_id, relation: row.relation, text: row.comment, name: row.display_name, date: String(row.updated_at).slice(0, 10) }));
      const fresh = new Response(JSON.stringify({ counts, comments }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', 'X-Content-Type-Options': 'nosniff' } });
      if (edge) { const put = edge.put(cacheKey, fresh.clone()); if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put; }
      return fresh;
    }
    if (path === '/admin/patron-nominations.csv') return patronCsv(request, env, 'patron_nominations', ['id', 'batch', 'name', 'url', 'ecosystem', 'why', 'email', 'status', 'created_at', 'source_page'], 'hi-patron-nominations.csv');

    // ---- optional Ideaflow ID sign-in. Every route answers "not enabled" until the three secrets exist. ----
    if (path === '/api/patron-session') {
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      const session = await patronSession(request, env);
      return signupResponse({ enabled: patronSignInEnabled(env), signedIn: Boolean(session), email: session ? session.email : '' });
    }
    if (path.startsWith('/auth/ideaflow/')) {
      if (!patronSignInEnabled(env)) return signupResponse({ error: 'Sign-in is not enabled.' }, 404);
      const redirectUri = url.origin + '/auth/ideaflow/callback', secure = '; Path=/; HttpOnly; Secure; SameSite=Lax';
      if (path === '/auth/ideaflow/signout') {
        if (request.method !== 'POST') return signupResponse({ error: 'Method not allowed' }, 405);
        if (request.headers.get('Origin') !== url.origin) return signupResponse({ error: 'Please sign out from this site.' }, 403);
        return signupResponse({ ok: true }, 200, { 'Set-Cookie': 'hi_patron=' + secure + '; Max-Age=0' });
      }
      if (request.method !== 'GET') return signupResponse({ error: 'Method not allowed' }, 405);
      if (path === '/auth/ideaflow/start') {
        const state = patronB64(crypto.getRandomValues(new Uint8Array(24))), verifier = patronB64(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = patronB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
        const target = new URL(IDEAFLOW_ID.authorize);
        for (const [key, value] of Object.entries({ response_type: 'code', client_id: env.IDEAFLOW_CLIENT_ID, redirect_uri: redirectUri, scope: 'openid email', state, code_challenge: challenge, code_challenge_method: 'S256' })) target.searchParams.set(key, value);
        return patronRedirect(target.toString(), ['hi_patron_oauth=' + state + '.' + verifier + secure + '; Max-Age=600']);
      }
      // callback
      const clear = 'hi_patron_oauth=' + secure + '; Max-Age=0', home = url.origin + (url.hostname.startsWith('patronage.') ? '/' : '/patrons');
      const [state, verifier] = patronCookie(request, 'hi_patron_oauth').split('.'), code = url.searchParams.get('code');
      if (!state || !verifier || !code || await signupHash(state) !== await signupHash(url.searchParams.get('state') || '')) return patronRedirect(home + '?signin=failed', [clear]);
      const token = await fetch(IDEAFLOW_ID.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env.IDEAFLOW_CLIENT_ID, client_secret: env.IDEAFLOW_CLIENT_SECRET, code_verifier: verifier }) });
      const granted = token.ok ? await token.json() : null;
      if (!granted || typeof granted.access_token !== 'string') return patronRedirect(home + '?signin=failed', [clear]);
      const info = await fetch(IDEAFLOW_ID.userinfo, { headers: { Authorization: 'Bearer ' + granted.access_token, Accept: 'application/json' } });
      const user = info.ok ? await info.json() : null;
      if (!user || typeof user.sub !== 'string' || !user.sub) return patronRedirect(home + '?signin=failed', [clear]);
      const email = typeof user.email === 'string' && user.email_verified !== false && PATRON_EMAIL.test(user.email) ? user.email.toLowerCase().slice(0, 254) : '';
      const body = patronB64(new TextEncoder().encode(JSON.stringify({ sub: user.sub.slice(0, 200), email, exp: Date.now() + 30 * 86400000 })));
      return patronRedirect(home, [clear, 'hi_patron=' + body + '.' + await patronSign(env, body) + secure + '; Max-Age=2592000']);
    }

    // ---- private submissions ----
    if (request.method !== 'POST') return signupResponse({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Origin') !== url.origin) return signupResponse({ error: 'Please send this from the patrons page.' }, 403);
    if (!env.SIGNUPS || !env.RATE_LIMIT_SALT) return signupResponse({ error: 'Temporarily unavailable.' }, 503);
    const { data, error } = await patronReadJson(request, path === '/api/patron-nominate' ? 8192 : 4096);
    if (error) return error;
    if (data.website) return signupResponse({ ok: true });
    // A voice costs two units, so someone can speak up for thirty projects in an hour.
    const units = path === '/api/patron-voice' ? 2 : path === '/api/patron-nominate' && Array.isArray(data.items) ? Math.min(Math.max(data.items.length, 5), 31) : 5;
    const limited = await patronRate(request, env, units); if (limited) return limited;
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const source = typeof data.source_page === 'string' ? data.source_page.slice(0, 300) : '/patrons', now = new Date().toISOString();

    if (path === '/api/patron-voice') {
      // One voice per project per salted address hash. Speaking again replaces the earlier voice; a new or changed
      // comment goes back to 'pending' and is not public until a person approves it.
      if (typeof data.project !== 'string' || !PATRON_PROJECT_IDS.includes(data.project)) return signupResponse({ error: 'Choose a listed project.' }, 400);
      if (!PATRON_VOICE_RELATIONS.includes(data.relation)) return signupResponse({ error: 'Say how you relate to the project.' }, 400);
      if (data.comment !== undefined && typeof data.comment !== 'string' || data.name !== undefined && typeof data.name !== 'string') return signupResponse({ error: 'Invalid submission' }, 400);
      const comment = (data.comment || '').trim(), name = (data.name || '').trim();
      if (comment.length > 500) return signupResponse({ error: 'Comments can be up to 500 characters.' }, 400);
      if (name.length > 60) return signupResponse({ error: 'Names can be up to 60 characters.' }, 400);
      const voter = await signupHash(env.RATE_LIMIT_SALT + ':voice:' + patronNet(request.headers.get('CF-Connecting-IP')));
      await env.SIGNUPS.prepare("INSERT INTO patron_voices (id,project_id,relation,voter_hash,comment,display_name,comment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id, voter_hash) DO UPDATE SET relation = excluded.relation, display_name = excluded.display_name, updated_at = excluded.updated_at, comment_status = CASE WHEN excluded.comment = '' THEN 'none' WHEN excluded.comment = comment AND excluded.display_name = display_name THEN comment_status ELSE 'pending' END, comment = excluded.comment")
        .bind(crypto.randomUUID(), data.project, data.relation, voter, comment, comment ? name : '', comment ? 'pending' : 'none', now, now).run();
      return signupResponse({ ok: true });
    }
    if (path === '/api/patron-nominate') {
      // Nominations wait in a private review queue (status 'pending'). Nothing is published from here.
      if (email && (email.length > 254 || !PATRON_EMAIL.test(email))) return signupResponse({ error: 'Please enter a valid email address or leave it blank.' }, 400);
      const items = Array.isArray(data.items) ? data.items : [data];
      if (items.length < 1 || items.length > 30) return signupResponse({ error: 'Send between 1 and 30 projects at a time.' }, 400);
      const why = typeof data.why === 'string' ? data.why.trim().slice(0, 500) : '', batch = crypto.randomUUID(), rows = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') return signupResponse({ error: 'Invalid project.' }, 400);
        const name = typeof item.name === 'string' ? item.name.trim() : '', link = typeof item.url === 'string' ? item.url.trim() : '', ecosystem = typeof item.ecosystem === 'string' ? item.ecosystem : '';
        if (!name || name.length > 120) return signupResponse({ error: 'Each project needs a name of up to 120 characters.' }, 400);
        if (!PATRON_ECOSYSTEMS.includes(ecosystem)) return signupResponse({ error: 'Unknown package source.' }, 400);
        if (link) { let parsed; try { parsed = new URL(link); } catch { parsed = null; } if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || link.length > 300) return signupResponse({ error: 'Links must start with https:// and be under 300 characters.' }, 400); }
        if (!link && !ecosystem) return signupResponse({ error: 'Add a link to the project.' }, 400);
        rows.push([crypto.randomUUID(), batch, name, link, ecosystem, why, email, now, source]);
      }
      // The queue is reviewed by a person; refuse new rows while it is implausibly full.
      const waiting = await env.SIGNUPS.prepare("SELECT COUNT(*) AS n FROM patron_nominations WHERE status = 'pending'").first();
      if (waiting && waiting.n > 5000) return signupResponse({ error: 'The review queue is full right now. Please try again later.' }, 503);
      await env.SIGNUPS.batch(rows.map(row => env.SIGNUPS.prepare("INSERT INTO patron_nominations (id,batch,name,url,ecosystem,why,email,status,created_at,source_page) VALUES (?,?,?,?,?,?,?,'pending',?,?)").bind(...row)));
      return signupResponse({ ok: true });
    }

    if (!email || email.length > 254 || !PATRON_EMAIL.test(email)) return signupResponse({ error: 'Please enter a valid email address.' }, 400);
    if (typeof data.tier !== 'string' || !Object.hasOwn(PATRON_TIERS, data.tier)) return signupResponse({ error: 'Choose a level.' }, 400);
    // Optional per-project split: {projectId: dollars}. Only catalog ids are accepted; the amounts become the monthly total.
    const allocations = {}; let allocated = 0;
    if (data.allocations !== undefined) {
      if (!data.allocations || typeof data.allocations !== 'object' || Array.isArray(data.allocations)) return signupResponse({ error: 'Invalid split.' }, 400);
      const entries = Object.entries(data.allocations);
      if (entries.length > 40) return signupResponse({ error: 'Choose up to 40 projects.' }, 400);
      for (const [id, dollars] of entries) {
        if (!PATRON_PROJECT_IDS.includes(id)) return signupResponse({ error: 'Unknown project in split.' }, 400);
        if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0.5 || dollars > 1000) return signupResponse({ error: 'Each project amount must be between $0.50 and $1,000.' }, 400);
        allocations[id] = Math.round(dollars * 100); allocated += allocations[id];
      }
    }
    let cents = PATRON_TIERS[data.tier];
    if (allocated) {
      if (data.tier !== 'custom' || allocated < 100 || allocated > 100000) return signupResponse({ error: 'A per-project split must total between $1 and $1,000.' }, 400);
      cents = allocated;
    } else if (cents === null) {
      if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount < 1 || data.amount > 1000) return signupResponse({ error: 'Enter an amount between $1 and $1,000.' }, 400);
      cents = Math.round(data.amount * 100);
    }
    const session = await patronSession(request, env);
    // One row per email. A repeat submission updates the choice; the response never says whether the email was new.
    // The account id is attached only when the signed-in account's verified email matches, and is never replaced.
    // Emails are otherwise unverified: do not treat ideaflow_sub or any column as proof of ownership.
    await env.SIGNUPS.prepare("INSERT INTO patron_interest (id,email,tier,amount_cents,notify_opt_in,created_at,updated_at,source_page,allocations,ideaflow_sub) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET tier = excluded.tier, amount_cents = excluded.amount_cents, notify_opt_in = excluded.notify_opt_in, updated_at = excluded.updated_at, allocations = excluded.allocations, ideaflow_sub = CASE WHEN ideaflow_sub = '' THEN excluded.ideaflow_sub ELSE ideaflow_sub END")
      .bind(crypto.randomUUID(), email, data.tier, cents, data.notify === true ? 1 : 0, now, now, source, JSON.stringify(allocations), session && session.email === email ? session.sub : '').run();
    return signupResponse({ ok: true });
  } catch { return signupResponse({ error: 'Temporarily unavailable. Please try again later.' }, 503); }
}
