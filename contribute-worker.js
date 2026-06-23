// Secrets available as globals (set via Cloudflare Workers secrets API):
// ANTHROPIC_API_KEY, TWITTER_BEARER_TOKEN, UNIPILE_API_KEY

const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0aHFueWpuaWNsdm5mbGZreWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1NTQxODUsImV4cCI6MjA2OTEzMDE4NX0.mCYF9nB-ctxmlOsuMrgz-DfYqB_3__8m1QJgqzxXcWA'
const WIT_KEY = 'wit_oQZdqshe2M3IKDQMaxcZA1ADrmxkAjJLwIMkH4eeEMJVakgi'
const UNIPILE_BASE = 'https://api49.unipile.com:17992/api/v1'
const UNIPILE_ACCOUNT_ID = 'edCIuB-_R82v9FxV7IZ92A'

const HI_PROJECTS = [
  { name: 'NVC Translator', url: 'https://nvctranslator.com', desc: 'AI-powered Nonviolent Communication translation', good_for: 'therapists, mediators, conflict resolution, mental health, compassionate communication' },
  { name: 'Noos Knowledge Graph', url: 'https://globalbr.ai', desc: 'Personal semantic knowledge graph', good_for: 'researchers, writers, knowledge workers, PKM, second-brain enthusiasts' },
  { name: 'WikiHub', url: 'https://wikihub.md', desc: 'GitHub for LLM wikis and knowledge bases', good_for: 'developers, AI builders, technical writers, community managers, open-source contributors' },
  { name: 'ListHub', url: 'https://listhub.globalbr.ai', desc: 'Curated discovery lists', good_for: 'curators, domain experts, community builders, people who know things' },
  { name: 'World Issue Tracker', url: 'https://worldissuetracker.com', desc: 'Issue tracker for societal problems', good_for: 'activists, civic technologists, researchers, NGO workers, anyone working on social problems' },
  { name: 'Brainstorms', url: 'https://tmad4000.github.io/brainstorms/', desc: 'Public idea list and open problems', good_for: 'entrepreneurs, generalists, futurists, people with lots of ideas' },
  { name: 'Claude Mind', url: 'https://github.com/tmad4000/claude-mind', desc: 'AI-human exploration of open problems', good_for: 'AI researchers, philosophers, interdisciplinary thinkers, people exploring hard questions' },
  { name: 'Vibe Coding Guide', url: 'https://github.com/tmad4000/vibe-coding-guide', desc: 'Guide to AI-native development', good_for: 'developers, technical founders, engineers learning AI-assisted coding' },
]

addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
})

async function handle(request) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors() })
  }

  if (path === '/contribute' || path === '/contribute/') {
    return new Response(FORM_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
  }

  if (path === '/contribute/analyze' && request.method === 'POST') {
    return withCors(await analyze(request))
  }

  if (path === '/contribute/save' && request.method === 'POST') {
    return withCors(await save(request))
  }

  return Response.redirect('https://humanityinfrastructure.com/', 301)
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function withCors(response) {
  const headers = new Headers(response.headers)
  Object.entries(cors()).forEach(([k, v]) => headers.set(k, v))
  return new Response(response.body, { status: response.status, headers })
}

async function analyze(request) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { twitter_handle, linkedin_url, homepage_url, about_text } = body
  const profile_parts = []
  const sources = []

  // Twitter
  if (twitter_handle?.trim()) {
    const handle = twitter_handle.trim().replace(/^@/, '').replace(/.*(?:twitter|x)\.com\//, '').split(/[/?]/)[0]
    try {
      const r = await fetch(
        `https://api.twitter.com/2/users/by/username/${handle}?user.fields=description,public_metrics,location`,
        { headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` } }
      )
      const d = await r.json()
      if (d.data) {
        const { description, public_metrics, location } = d.data
        profile_parts.push(`X/Twitter @${handle}: ${description || '(no bio)'}${location ? ` | Location: ${location}` : ''} | ${public_metrics?.followers_count || 0} followers`)
        sources.push('Twitter profile')
        // Recent tweets
        const tr = await fetch(
          `https://api.twitter.com/2/users/${d.data.id}/tweets?max_results=10&tweet.fields=text`,
          { headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` } }
        )
        const td = await tr.json()
        if (td.data?.length) {
          profile_parts.push(`Recent tweets: ${td.data.slice(0, 6).map(t => t.text.replace(/\n/g, ' ')).join(' || ')}`)
        }
      }
    } catch (e) { /* skip */ }
  }

  // LinkedIn via Unipile
  if (linkedin_url?.trim()) {
    try {
      const m = linkedin_url.match(/linkedin\.com\/in\/([^/?#]+)/)
      if (m) {
        const pid = m[1]
        const r = await fetch(
          `${UNIPILE_BASE}/users/${pid}?account_id=${UNIPILE_ACCOUNT_ID}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY } }
        )
        const d = await r.json()
        if (d?.headline) {
          profile_parts.push(`LinkedIn (${pid}): ${d.headline}${d.summary ? ` | ${d.summary.slice(0, 400)}` : ''}`)
          sources.push('LinkedIn profile')
        }
      }
    } catch (e) { /* skip */ }
  }

  // Homepage scraping
  if (homepage_url?.trim()) {
    try {
      const r = await fetch(homepage_url.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HumanityInfrastructure/1.0)' },
        signal: AbortSignal.timeout(6000)
      })
      const html = await r.text()
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 4000)
      if (text.length > 50) {
        profile_parts.push(`Homepage (${homepage_url}): ${text}`)
        sources.push('personal homepage')
      }
    } catch (e) { /* skip */ }
  }

  if (about_text?.trim()) {
    profile_parts.push(`Self-description: ${about_text.trim()}`)
    sources.push('self-description')
  }

  if (!profile_parts.length) {
    return json({ error: 'No profile data could be gathered. Please add at least one input.' }, 400)
  }

  const projectList = HI_PROJECTS.map(p => `- ${p.name} (${p.url}): ${p.desc}. Good for: ${p.good_for}`).join('\n')

  const prompt = `You are helping match people to open-infrastructure projects they can contribute to.

Profile gathered from: ${sources.join(', ')}

${profile_parts.join('\n\n')}

Available projects:
${projectList}

Pick the 3 best-fit projects for this person. Respond with JSON only (no markdown fences):
{
  "name": "their name or null",
  "summary": "2-3 sentences: who they are, what they care about, what they bring",
  "top_role": "their most distinctive skill/identity in 4-6 words",
  "matches": [
    {
      "project": "exact project name",
      "url": "project url",
      "fit": "one sentence why this fits them specifically",
      "quest": "one specific thing they could do or build (be concrete)"
    }
  ]
}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const d = await r.json()
    let raw = d.content[0].text.trim()
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const result = JSON.parse(raw)
    return json({ ...result, sources })
  } catch (e) {
    return json({ error: 'Analysis failed', detail: e.message }, 500)
  }
}

async function save(request) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { name, summary, top_role, matches, handle } = body
  const title = name || handle || 'Anonymous contributor'
  const matchMd = (matches || []).map(m =>
    `### ${m.project}\n${m.fit}\n**Quest:** ${m.quest}\n[${m.url}](${m.url})`
  ).join('\n\n')

  const description = `## Profile\n**${top_role || 'Contributor'}**\n\n${summary}\n\n## Best project fits\n\n${matchMd}\n\n---\n*Profile generated by [humanityinfrastructure.com/contribute](https://humanityinfrastructure.com/contribute)*`

  const r = await fetch('https://sthqnyjniclvnflfkyio.supabase.co/functions/v1/create-issue', {
    method: 'POST',
    headers: { 'apikey': ANON_JWT, 'X-Agent-Key': WIT_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tracker_slug: 'hi-contributors',
      title,
      description,
      issue_type: 'feature',
      priority: 'medium'
    })
  })

  const d = await r.json()
  const issueId = d.id || d.issue_id
  return json({
    success: !!issueId,
    url: issueId ? `https://worldissuetracker.com/tracker/hi-contributors` : null,
    raw: d
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const FORM_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>How can you contribute? — Humanity Infrastructure</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,400;0,600;1,300;1,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0f14;--bg-soft:#12161f;--card:#161b26;--card-hover:#1c2230;
  --text:#e8edf6;--muted:#97a1b3;--faint:#5d6678;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.14);
  --accent:#5fd3a8;--accent-2:#7aa2ff;--accent-warm:#f4b860;
  --serif:'Newsreader',Georgia,serif;--sans:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
}
body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;line-height:1.6}
a{color:var(--accent-2);text-decoration:none}
a:hover{text-decoration:underline}

.topbar{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:.78rem;color:var(--faint)}
.topbar a{color:var(--muted)}

.wrap{max-width:720px;margin:0 auto;padding:0 24px}

.page-hero{padding:60px 0 40px;text-align:center}
.page-hero .eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:500;margin-bottom:16px}
.page-hero h1{font-family:var(--serif);font-size:clamp(2rem,5vw,3rem);font-weight:300;line-height:1.15;margin-bottom:16px}
.page-hero h1 em{font-style:italic;color:var(--accent-warm)}
.page-hero p{color:var(--muted);font-size:1rem;max-width:540px;margin:0 auto}

.form-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:36px;margin:0 0 32px}
.form-card h2{font-family:var(--mono);font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:24px}

.field{margin-bottom:20px}
.field label{display:block;font-size:.85rem;color:var(--muted);font-family:var(--mono);margin-bottom:8px}
.field label span{color:var(--faint);font-weight:400}
.field input,.field textarea{
  width:100%;background:var(--bg-soft);border:1px solid var(--border-strong);border-radius:8px;
  color:var(--text);font-family:var(--sans);font-size:.95rem;padding:12px 16px;
  transition:border-color .15s;outline:none;
}
.field input:focus,.field textarea:focus{border-color:var(--accent-2)}
.field textarea{resize:vertical;min-height:100px;line-height:1.5}
.field input::placeholder,.field textarea::placeholder{color:var(--faint)}

.submit-btn{
  display:block;width:100%;padding:14px;
  background:linear-gradient(110deg,var(--accent),var(--accent-2));
  color:#06120d;font-family:var(--mono);font-size:.9rem;font-weight:600;
  border:none;border-radius:8px;cursor:pointer;letter-spacing:.04em;
  transition:opacity .15s;
}
.submit-btn:hover{opacity:.9}
.submit-btn:disabled{opacity:.4;cursor:not-allowed}

.status{font-family:var(--mono);font-size:.82rem;color:var(--muted);margin-top:16px;min-height:20px;text-align:center}

/* Results */
.results{display:none;margin-top:32px}
.results.visible{display:block}
.results-header{font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);margin-bottom:20px}
.profile-summary{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:24px}
.profile-name{font-family:var(--serif);font-size:1.4rem;font-weight:400;margin-bottom:4px}
.profile-role{font-family:var(--mono);font-size:.78rem;color:var(--accent-warm);margin-bottom:14px;letter-spacing:.06em;text-transform:uppercase}
.profile-bio{color:var(--muted);font-size:.95rem;line-height:1.65}

.match-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:22px;margin-bottom:14px;transition:border-color .15s}
.match-card:hover{border-color:var(--border-strong)}
.match-name{font-family:var(--mono);font-size:.85rem;font-weight:600;color:var(--accent-2);margin-bottom:6px}
.match-fit{color:var(--text);font-size:.92rem;margin-bottom:10px;line-height:1.55}
.match-quest{font-family:var(--mono);font-size:.78rem;color:var(--accent);border-left:2px solid var(--accent);padding-left:12px;line-height:1.5}
.match-link{display:inline-block;margin-top:10px;font-family:var(--mono);font-size:.75rem;color:var(--faint)}

.save-row{margin-top:28px;padding-top:24px;border-top:1px solid var(--border);display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.save-btn{
  padding:11px 24px;background:transparent;
  border:1px solid var(--accent-2);color:var(--accent-2);
  font-family:var(--mono);font-size:.82rem;font-weight:600;
  border-radius:8px;cursor:pointer;transition:all .15s;letter-spacing:.04em;
}
.save-btn:hover{background:var(--accent-2);color:var(--bg)}
.save-note{font-size:.82rem;color:var(--faint);flex:1}
.save-success{font-family:var(--mono);font-size:.82rem;color:var(--accent);display:none}
.save-success.visible{display:block}

footer{padding:40px 0 60px;text-align:center;border-top:1px solid var(--border);margin-top:60px}
footer a{font-family:var(--mono);font-size:.78rem;color:var(--faint);margin:0 12px}
</style>
</head>
<body>

<div class="topbar">
  <a href="/">← Humanity Infrastructure</a>
  <span>Knowledge is a birthright. So are the tools.</span>
</div>

<div class="wrap">
  <div class="page-hero">
    <div class="eyebrow">Find your quest</div>
    <h1>How can <em>you</em> contribute?</h1>
    <p>Share a bit about yourself and we'll match you to the open infrastructure projects where you'd have the most impact.</p>
  </div>

  <div class="form-card">
    <h2>Tell us about yourself</h2>
    <div class="field">
      <label for="twitter">X / Twitter handle <span>(optional)</span></label>
      <input id="twitter" type="text" placeholder="@handle or x.com/handle"/>
    </div>
    <div class="field">
      <label for="linkedin">LinkedIn URL <span>(optional)</span></label>
      <input id="linkedin" type="url" placeholder="linkedin.com/in/yourname"/>
    </div>
    <div class="field">
      <label for="homepage">Personal website or portfolio <span>(optional)</span></label>
      <input id="homepage" type="url" placeholder="https://yoursite.com"/>
    </div>
    <div class="field">
      <label for="about">About you <span>(anything — work, interests, what you want to build)</span></label>
      <textarea id="about" placeholder="e.g. I'm a therapist who's been thinking about AI and nonviolent communication..."></textarea>
    </div>
    <button class="submit-btn" id="analyzeBtn" onclick="runAnalysis()">Find my contribution →</button>
    <div class="status" id="status"></div>
  </div>

  <div class="results" id="results">
    <div class="results-header">Your profile + project matches</div>
    <div class="profile-summary" id="profileSummary"></div>
    <div id="matchCards"></div>
    <div class="save-row">
      <button class="save-btn" id="saveBtn" onclick="saveToWIT()">Save to World Issue Tracker →</button>
      <span class="save-note">Creates a public profile in the HI Contributors tracker</span>
      <span class="save-success" id="saveSuccess"></span>
    </div>
  </div>
</div>

<footer>
  <a href="/">humanityinfrastructure.com</a>
  <a href="https://worldissuetracker.com/tracker/hi-contributors" target="_blank">View all contributors →</a>
</footer>

<script>
let analysisResult = null

async function runAnalysis() {
  const btn = document.getElementById('analyzeBtn')
  const status = document.getElementById('status')
  const results = document.getElementById('results')

  const twitter = document.getElementById('twitter').value.trim()
  const linkedin = document.getElementById('linkedin').value.trim()
  const homepage = document.getElementById('homepage').value.trim()
  const about = document.getElementById('about').value.trim()

  if (!twitter && !linkedin && !homepage && !about) {
    status.textContent = 'Please fill in at least one field.'
    return
  }

  btn.disabled = true
  status.textContent = 'Gathering your profile data…'
  results.classList.remove('visible')

  try {
    const res = await fetch('/contribute/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twitter_handle: twitter, linkedin_url: linkedin, homepage_url: homepage, about_text: about })
    })
    const data = await res.json()

    if (data.error) {
      status.textContent = '⚠ ' + data.error
      btn.disabled = false
      return
    }

    analysisResult = data
    renderResults(data)
    status.textContent = data.sources?.length ? 'Analyzed from: ' + data.sources.join(', ') : ''
    results.classList.add('visible')
    results.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    status.textContent = 'Something went wrong. Try again?'
  }
  btn.disabled = false
}

function renderResults(data) {
  const summary = document.getElementById('profileSummary')
  summary.innerHTML = \`
    <div class="profile-name">\${data.name || 'You'}</div>
    <div class="profile-role">\${data.top_role || ''}</div>
    <div class="profile-bio">\${data.summary || ''}</div>
  \`

  const cards = document.getElementById('matchCards')
  cards.innerHTML = (data.matches || []).map(m => \`
    <div class="match-card">
      <div class="match-name">\${m.project}</div>
      <div class="match-fit">\${m.fit}</div>
      <div class="match-quest">Quest: \${m.quest}</div>
      <a class="match-link" href="\${m.url}" target="_blank">\${m.url} ↗</a>
    </div>
  \`).join('')
}

async function saveToWIT() {
  const btn = document.getElementById('saveBtn')
  const success = document.getElementById('saveSuccess')
  if (!analysisResult) return
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    const res = await fetch('/contribute/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...analysisResult,
        handle: document.getElementById('twitter').value.trim() || document.getElementById('linkedin').value.trim()
      })
    })
    const data = await res.json()
    if (data.success) {
      btn.style.display = 'none'
      success.textContent = '✓ Saved! View at worldissuetracker.com/tracker/hi-contributors'
      success.classList.add('visible')
    } else {
      btn.textContent = 'Save failed — try again'
      btn.disabled = false
    }
  } catch {
    btn.textContent = 'Save failed — try again'
    btn.disabled = false
  }
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runAnalysis()
})
</script>
</body>
</html>`
