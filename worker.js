addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const path = url.pathname
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
<title>Humanity³ — The Codex · Basic Infrastructure for Human Flourishing</title>
<meta name="description" content="A codex of human know-how as a public resource to humanity. Free, open-source tools and knowledge to coordinate human activity — and bring flourishing into every person's reach. This is how we coordinate as a superorganism." />
<meta property="og:title" content="Humanity³ — The Codex" />
<meta property="og:description" content="Knowledge as a birthright. Open tools for human flourishing. This is how we coordinate as a superorganism." />
<meta property="og:type" content="website" />
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
  html{scroll-behavior:smooth}
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
  .nav-links a{color:var(--muted);font-size:.92rem;font-weight:500}
  .nav-links a:hover{color:var(--text);text-decoration:none}
  .theme-btn{background:var(--card);border:1px solid var(--border-strong);color:var(--text);
    width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:1rem;display:grid;place-items:center}
  .theme-btn:hover{background:var(--card-hover)}
  @media(max-width:680px){.nav-links a:not(.cta){display:none}}

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
    <a href="#join">Join</a>
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
    <a class="btn ghost" href="/contribute">Find your contribution →</a>
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
    <p>Free and open. Use them today — and help build the rest.</p>
  </div>
  <div class="grid">
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
    <a class="card" href="https://listhub.globalbr.ai" target="_blank" rel="noopener">
      <span class="tag live">Live</span>
      <div class="top"><span class="emoji">📝</span><div><h3>ListHub</h3><div class="url">listhub.globalbr.ai</div></div></div>
      <p>Open list & note publishing with a REST API and two-way git sync. The home for the open-lists movement.</p>
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
        <li><a href="http://worldquestguild.connectordocs.com/" target="_blank" rel="noopener">World Quest Guild — add yourself</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="http://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="http://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="http://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="http://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="http://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="http://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="http://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="http://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="http://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="http://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
      </ul>
    </div>
  </div>
</div></section>

<section id="join"><div class="wrap">
  <div class="cta-band">
    <h2>If you're not part of this, what are you doing with your life?</h2>
    <p>We're building the more general, not-just-engineering equivalent of the open-source movement. There's an enormous amount of low-hanging fruit — and we're looking for designers, engineers, writers, healers, and well-intended humans of every kind.</p>
    <div class="btns" style="justify-content:center">
      <a class="btn primary" href="mailto:jacob@ideaflow.io?subject=Joining%20the%20Codex%20%2F%20Humanity%20Infrastructure">Get involved →</a>
      <a class="btn ghost" href="http://worldquestguild.connectordocs.com/" target="_blank" rel="noopener">Join a guild</a>
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
    <span class="ver">v0.3.0 · 2026-06-13</span>
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

<script>
  // ---- Open Build List data (lifted from the Codex master doc) ----
  var BUILD=[
    {c:"Collective Action",t:"ThunderPledge",s:"idea",u:"http://thunderpledge.jacobcole.net",d:"Kickstarter for collective action: pledge to go vegetarian, vote, or boycott — but only once a critical mass also commits. Variants: ThunderVote, ThunderBoycott ('Kickstopper')."},
    {c:"Collective Action",t:"Zero-Sum Redirect",s:"idea",d:"A clearinghouse for opposing political donations — matched contributions cancel out and the saved money goes to charity instead."},
    {c:"Collective Action",t:"Government Suggestion Box",s:"idea",d:"A suggestion-box platform for governments, including the ability to donate toward implementing specific suggestions."},
    {c:"Collective Action",t:"Everyone-a-Philanthropist",s:"idea",d:"Infrastructure so communities can pool resources to fill missing government functions — help a neighbor afford insurance, get a kid a laptop."},
    {c:"Collective Action",t:"Resource-Sharing Platform",s:"idea",u:"http://favorverse.jacobcole.net/",d:"Let people share what they can lend — tools, a U-Haul, time. Related: Favorverse & VolunteerForce."},
    {c:"Reputation & Trust",t:"Open Reputation System",s:"idea",d:"A portable, open reputation layer — the missing primitive for trust in online coordination."},
    {c:"Reputation & Trust",t:"Trust Layer / Meta-Brands",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A trust layer for the web — 'meta-brands' that vouch for quality and integrity."},
    {c:"Reputation & Trust",t:"Fact-Check Extension",s:"idea",u:"http://factcheck.jacobcole.net/",d:"A browser extension surfacing fact-checks and provenance inline."},
    {c:"Fixing the Internet",t:"Open Forum Software",s:"building",u:"https://github.com/gulkily/pollyanna",d:"Forum software that is transparent, consensual, and open-source (Pollyanna)."},
    {c:"Fixing the Internet",t:"Minimalist Homepages",s:"idea",u:"http://minimalisthomepages.com/",d:"A better way to make calm, minimalist personal homepages."},
    {c:"Fixing the Internet",t:"ThoughtfulWeb",s:"idea",u:"http://thoughtfulweb.jacobcole.net",d:"A directory of places on the web that are thoughtful, artful, and mindful — an oasis of good taste."},
    {c:"Personal Leverage",t:"'Camel's Eye' Email Agent",s:"idea",d:"An agent that filters and triages email on your behalf (from Permutation City). Reclaim your attention."},
    {c:"Personal Leverage",t:"Shortcut / Macro Coach",s:"idea",d:"Watches your actions and occasionally suggests a shortcut, auto-writing the macro for you."},
    {c:"Personal Leverage",t:"Open Automation Tools",s:"idea",d:"Great open-source macro & browser-automation frameworks (Browserflow-style) for everyone."},
    {c:"Personal Leverage",t:"Shopping Coach",s:"idea",d:"A service that shops on your behalf — finds the best, most ethical option so you don't have to."},
    {c:"Open Knowledge",t:"Open Meditation Curricula",s:"building",u:"http://meditation.jacobcole.net/",d:"Basic open curricula for meditation and working with your body. Lists exist; needs a real course."},
    {c:"Open Knowledge",t:"Open Medical Knowledge",s:"building",u:"http://chronicpain.jacobcole.net/",d:"How to treat chronic pain, RSI, and more — patient-first medical know-how. Lists started."},
    {c:"Open Knowledge",t:"Open Academic Education",s:"idea",d:"University-level math, an open algorithms tutor, and interactive self-teaching programming resources."},
    {c:"Open Knowledge",t:"Open Work Templates",s:"idea",d:"Open templates for every kind of work — invoices, gantt charts, proposals."},
    {c:"Open Knowledge",t:"Role-Model Casting",s:"idea",u:"http://foodslist.jacobcole.net/",d:"For people without good role models — emulate the routines of healthy, effective people (e.g. foods lists)."},
    {c:"Open Knowledge",t:"Motivation Database",s:"idea",u:"http://whyisitawesome.jacobcole.net/",d:"A wiki of why all the awesome things in the world are awesome — fuel for motivation."},
    {c:"Open Knowledge",t:"'Books to Grow Up On'",s:"idea",u:"http://kidactivities.jacobcole.net",d:"An open list of literature that builds good mental models — plus kids' games & activities."},
    {c:"Assistive Tech",t:"Hands-Free Voice Interfaces",s:"idea",d:"Good hands-free voice-recognition hooks into common sites (Gmail, etc.) for quadriplegics and others. Lots of low-hanging fruit."},
    {c:"Assistive Tech",t:"Cueing App for Brain Injuries",s:"idea",d:"A cueing/reminder app for people recovering from brain injuries."},
    {c:"Assistive Tech",t:"Better Foot Mouse",s:"idea",d:"A better foot-operated mouse for people who can't use their hands."},
    {c:"Coordination Infra",t:"On-the-Fly Knowledge Capture",s:"building",u:"https://globalbr.ai",d:"Frictionless personal knowledge capture + a graph query engine. Being built as Noos."},
    {c:"Coordination Infra",t:"Global Idea Bank",s:"building",u:"https://tmad4000.github.io/brainstorms/",d:"An open bank of ideas & hackathon projects anyone can take and build. Live as the Idea List."},
    {c:"Coordination Infra",t:"Open Research Repository",s:"idea",u:"http://openresearch.connekt.site",d:"A global, open repository for research — make the world's findings freely usable."},
    {c:"Care & Society",t:"Adult 'Foster' Support Network",s:"idea",d:"Ubiquitous support — 'extra parents' — for adults facing challenges so no one falls through the cracks."},
    {c:"Care & Society",t:"Non-Emergency Help Button",s:"idea",d:"A button to request non-emergency help: a compassionate responder for mental-health crises, a care coordinator, a 'life figure-outer'."},
    {c:"Care & Society",t:"Database of Survival Guides",s:"idea",d:"'How to survive/thrive' guides across many contexts — including for highly sensitive people on a budget."},
    {c:"Care & Society",t:"Database of Human Ideals",s:"idea",d:"Documenting the multiplicity of happy cultures and ways of being."},
    {c:"Done",t:"OpenLibrary",s:"done",u:"https://openlibrary.org",d:"Open, universal catalog of books. Exists — and it's wonderful."},
    {c:"Done",t:"Internet Archive",s:"done",u:"https://archive.org",d:"Humanity's library and memory. Exists — support it."},
    {c:"Done",t:"Concentration Music",s:"done",d:"Open 'music for concentration' playlists everyone can access. Largely solved."},
    {c:"Fixing the Internet",t:"Cross-Site Hashtag Search",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"Search a hashtag uniformly across every social platform and website at once."},
    {c:"Fixing the Internet",t:"Universal Comments Layer",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"Attach comment threads to any webpage, email, or chat, viewable by anyone."},
    {c:"Fixing the Internet",t:"Universal Web Annotations",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A shared highlight-and-note layer that pins annotations onto any page across the web."},
    {c:"Open Knowledge",t:"Canonical Debate Lab",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A structured platform that organizes contested claims and their arguments toward resolution."},
    {c:"Open Knowledge",t:"Scientific Assertions Database",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A machine-readable repository of scientific claims with their dependencies and evidence mapped."},
    {c:"Open Knowledge",t:"Collaborative Theorem Prover",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A shared workspace where mathematicians jointly build and verify formal proofs."},
    {c:"Open Knowledge",t:"Negative Results Repository",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"An archive of failed experiments and null results so research isn't needlessly duplicated."},
    {c:"Open Knowledge",t:"Argument Repository",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A searchable database of debate outlines and reusable argumentative frameworks."},
    {c:"Coordination Infra",t:"Policy & Science Simulator",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A sandbox for safely testing policy changes and hypotheses before real-world rollout."},
    {c:"Personal Leverage",t:"Unified Feed Control",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A single interface managing emails, texts, calls, and feeds with user-defined routing rules."},
    {c:"Fixing the Internet",t:"Soundbite Propagation Tracker",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"Audio-fingerprinting that traces how a specific quote or claim spreads across media."},
    {c:"Civic & Government",t:"Global Goals Dashboard",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A public dashboard visualizing humanity's measured progress on major shared objectives."},
    {c:"Collective Action",t:"Conditional Voting Pledge",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"Citizens commit to vote only if enough peers in their district also pledge, then all activate together."},
    {c:"Care & Society",t:"Favor-Matching Network",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"Maps friends' skills so people can request and exchange favors locally."},
    {c:"Health & Body",t:"ICU & Ventilator Tracker",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"A real-time map of available ventilators and ICU beds across hospitals during a crisis."},
    {c:"Care & Society",t:"Proximity Hangout Suggester",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"Alerts you to nearby friends and suggests a meetup without persistent location tracking."},
    {c:"Fixing the Internet",t:"Political Bias Classifier",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"An ML tool that detects and labels politically biased content in social feeds."},
    {c:"Climate & Sustainability",t:"Wildfire Satellite Detection",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"A model that flags forest fires early from satellite imagery."},
    {c:"Personal Leverage",t:"Ingredient Recipe Finder",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"Recommends recipes from what's in your kitchen and pairs you with a cooking partner."},
    {c:"Reputation & Trust",t:"Used-Car History Database",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"A verified repository of repair and inspection histories for used vehicles."},
    {c:"Open Knowledge",t:"Idea Graph IDE",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"A graph workspace that links hackathon and startup ideas by relationship."},
    {c:"Open Knowledge",t:"Curiosity Thread Maps",s:"idea",u:"http://hackathonprojects.jacobcole.net/",d:"A platform charting question-to-question sequences that lead from curiosity to expertise."},
    {c:"Open Knowledge",t:"Best-in-Class Tool Registry",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"A curated directory of the top tool for each purpose, organized by use case."},
    {c:"Coordination Infra",t:"Curated List Publishing",s:"idea",u:"http://fixingtheinternet.jacobcole.net/",d:"Lets curators easily publish and distribute thematic lists and recommendations."},
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
    var WIT="https://sthqnyjniclvnflfkyio.supabase.co/functions/v1/get-issues?tracker_slug=missing-civ-infrastructure&label=humanity3&limit=100";
    var grid=document.getElementById('witgrid');
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
    function issueUrl(i){return i.canonical_issue_url || ('https://worldissuetracker.com/issue/'+i.slug)}
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
<meta name="description" content="We build the missing civilization layer. Open-source tools, knowledge systems, and coordination infrastructure — free for all of humanity." />
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
html { scroll-behavior: smooth; }

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
.nav-links a { color: var(--muted); font-size: .88rem; font-weight: 500; font-family: var(--mono); transition: color .12s; }
.nav-links a:hover { color: var(--text); text-decoration: none; }
.theme-btn {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--text); width: 36px; height: 36px; border-radius: 9px;
  cursor: pointer; font-size: .95rem; display: grid; place-items: center;
  transition: background .12s;
}
.theme-btn:hover { background: var(--card-h); }
@media(max-width:700px) { .nav-links a:not(.cta) { display: none; } }

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
    <a href="#mission">Mission</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">Resources</a>
    <a href="#join">Join</a>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <div class="eyebrow">Infrastructure for Human Flourishing</div>
  <h1>We build the missing<br/><em>civilization layer.</em></h1>
  <p class="lede">Open-source tools, knowledge systems, and coordination infrastructure — free for all of humanity. The not-just-engineering equivalent of the open-source movement.</p>
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
  <p class="sect-p">Free and open. Use them today — and help build the rest.</p>
  <div class="grid reveal">
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
    <a class="tcard" href="https://listhub.globalbr.ai" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📝</div><span class="tag live">Live</span></div>
      <h3>ListHub</h3>
      <span class="url">listhub.globalbr.ai</span>
      <p>Open list & note publishing with a REST API and two-way git sync. Home of the open-lists movement.</p>
    </a>
    <a class="tcard" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🌐</div><span class="tag live">Live</span></div>
      <h3>World Issue Tracker</h3>
      <span class="url">worldissuetracker.com</span>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
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
        <li><a href="http://worldquestguild.connectordocs.com/" target="_blank" rel="noopener">World Quest Guild — add yourself</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="http://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="http://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="http://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="http://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="http://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="http://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="http://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="http://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="http://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="http://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
        <li><a href="http://education.jacobcole.net" target="_blank" rel="noopener">Education resources</a></li>
      </ul>
    </div>
  </div>
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
  { cat:'health', title:'Open chronic-pain protocol', desc:'Aggregated evidence-based treatments for common chronic conditions, freely editable.', status:'building', url:'http://chronicpain.jacobcole.net/' },
  { cat:'coordination', title:'Volunteerism marketplace', desc:'Match people who want to help with tasks that need doing — a Craigslist for good deeds.', status:'idea' },
  { cat:'knowledge', title:'Open meditation curricula', desc:'Secular, evidence-based meditation courses — from beginner to advanced, free forever.', status:'done', url:'http://meditation.jacobcole.net/' },
  { cat:'tools', title:'Collective action toolkit', desc:'Lower the barrier to coordinating groups around shared goals — pledges, commitments, accountability.', status:'building', url:'http://thunderpledge.jacobcole.net' },
  { cat:'knowledge', title:'How to eat well (open guide)', desc:'Evidence-based nutrition guide with community editing and regional adaptations.', status:'done', url:'http://foodslist.jacobcole.net/' },
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
    const res = await fetch('https://api.worldissuetracker.com/api/v1/issues?tracker=missing-civ-infrastructure&status=open&limit=6');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const issues = data.issues || data.data || data || [];
    if (!issues.length) { grid.innerHTML = '<div class="witloading">No open quests right now — check back soon.</div>'; return; }
    grid.innerHTML = issues.map(i => \`
      <div class="bcard">
        <div class="cat">Open quest · #\${i.id || i.number || ''}</div>
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
<meta name="description" content="We build the missing civilization layer. Open-source tools, knowledge systems, and coordination infrastructure — free for all of humanity." />
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
html { scroll-behavior: smooth; }

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
.nav-links a { color: var(--muted); font-size: .88rem; font-weight: 500; font-family: var(--mono); transition: color .12s; }
.nav-links a:hover { color: var(--text); text-decoration: none; }
.theme-btn {
  background: var(--card); border: 1px solid var(--border2);
  color: var(--text); width: 36px; height: 36px; border-radius: 9px;
  cursor: pointer; font-size: .95rem; display: grid; place-items: center;
  transition: background .12s;
}
.theme-btn:hover { background: var(--card-h); }
@media(max-width:700px) { .nav-links a:not(.cta) { display: none; } }

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
    <a href="#mission">Mission</a>
    <a href="#tools">Tools</a>
    <a href="#buildlist">Build List</a>
    <a href="#vision">Resources</a>
    <a href="#join">Join</a>
    <button class="theme-btn" id="themeBtn" aria-label="Toggle theme">☀️</button>
  </div>
</div></nav>

<a id="top"></a>
<header class="hero"><div class="wrap">
  <div class="eyebrow">Infrastructure for Human Flourishing</div>
  <h1>We build the missing<br/><em>civilization layer.</em></h1>
  <p class="lede">Open-source tools, knowledge systems, and coordination infrastructure — free for all of humanity. The not-just-engineering equivalent of the open-source movement.</p>
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
  <p class="sect-p">Free and open. Use them today — and help build the rest.</p>
  <div class="grid reveal">
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
    <a class="tcard" href="https://listhub.globalbr.ai" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">📝</div><span class="tag live">Live</span></div>
      <h3>ListHub</h3>
      <span class="url">listhub.globalbr.ai</span>
      <p>Open list & note publishing with a REST API and two-way git sync. Home of the open-lists movement.</p>
    </a>
    <a class="tcard" href="https://worldissuetracker.com" target="_blank" rel="noopener">
      <div class="tcard-top"><div class="tcard-icon">🌐</div><span class="tag live">Live</span></div>
      <h3>World Issue Tracker</h3>
      <span class="url">worldissuetracker.com</span>
      <p>A public issue tracker for civic and shared problems — a bottom-up list of what's broken, and who's fixing it.</p>
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
        <li><a href="http://worldquestguild.connectordocs.com/" target="_blank" rel="noopener">World Quest Guild — add yourself</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🧭 Movements within</h4>
      <ul>
        <li><a href="http://opensource.jacobcole.net" target="_blank" rel="noopener">Open Source dashboard</a></li>
        <li><a href="http://openlists.jacobcole.net" target="_blank" rel="noopener">Open Lists movement</a></li>
        <li><a href="http://fixingtheinternet.jacobcole.net/" target="_blank" rel="noopener">Fixing the Internet</a></li>
        <li><a href="http://favorverse.jacobcole.net/" target="_blank" rel="noopener">Favorverse — volunteerism</a></li>
        <li><a href="http://thunderpledge.jacobcole.net" target="_blank" rel="noopener">ThunderPledge — collective action</a></li>
      </ul>
    </div>
    <div class="lcol">
      <h4>🌿 Knowledge &amp; flourishing</h4>
      <ul>
        <li><a href="http://meditation.jacobcole.net/" target="_blank" rel="noopener">Open meditation curricula</a></li>
        <li><a href="http://chronicpain.jacobcole.net/" target="_blank" rel="noopener">Treating chronic pain</a></li>
        <li><a href="http://foodslist.jacobcole.net/" target="_blank" rel="noopener">How to eat well</a></li>
        <li><a href="http://supplements.jacobcole.net/" target="_blank" rel="noopener">Supplement stacks</a></li>
        <li><a href="http://bodymasters.jacobcole.net" target="_blank" rel="noopener">Body Masters</a></li>
        <li><a href="http://education.jacobcole.net" target="_blank" rel="noopener">Education resources</a></li>
      </ul>
    </div>
  </div>
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
  { cat:'health', title:'Open chronic-pain protocol', desc:'Aggregated evidence-based treatments for common chronic conditions, freely editable.', status:'building', url:'http://chronicpain.jacobcole.net/' },
  { cat:'coordination', title:'Volunteerism marketplace', desc:'Match people who want to help with tasks that need doing — a Craigslist for good deeds.', status:'idea' },
  { cat:'knowledge', title:'Open meditation curricula', desc:'Secular, evidence-based meditation courses — from beginner to advanced, free forever.', status:'done', url:'http://meditation.jacobcole.net/' },
  { cat:'tools', title:'Collective action toolkit', desc:'Lower the barrier to coordinating groups around shared goals — pledges, commitments, accountability.', status:'building', url:'http://thunderpledge.jacobcole.net' },
  { cat:'knowledge', title:'How to eat well (open guide)', desc:'Evidence-based nutrition guide with community editing and regional adaptations.', status:'done', url:'http://foodslist.jacobcole.net/' },
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
    const res = await fetch('https://api.worldissuetracker.com/api/v1/issues?tracker=missing-civ-infrastructure&status=open&limit=6');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const issues = data.issues || data.data || data || [];
    if (!issues.length) { grid.innerHTML = '<div class="witloading">No open quests right now — check back soon.</div>'; return; }
    grid.innerHTML = issues.map(i => \`
      <div class="bcard">
        <div class="cat">Open quest · #\${i.id || i.number || ''}</div>
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
