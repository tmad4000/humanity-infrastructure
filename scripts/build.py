from pathlib import Path
import os, re, json, mimetypes

def escape_js(s):
    s = s.replace('\\', '\\\\')
    s = s.replace('`', '\\`')
    s = s.replace('${', '\\${')
    return s

with open('index.html') as f: main = f.read()
with open('v2.html') as f: v2 = f.read()
with open('v3.html') as f: v3 = f.read()
with open('classic.html') as f: classic = f.read()
with open('versions/v4/index.html') as f: archive_v4 = f.read()
import base64
designs = {}
for p in sorted(Path('designs').rglob('*')):
    if p.is_file():
        mime = mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
        designs['/' + p.as_posix()] = [mime, base64.b64encode(p.read_bytes()).decode()]

with open('og-card.png','rb') as f: og_b64 = base64.b64encode(f.read()).decode()

worker = f"""export default {{
  async fetch(request, env) {{ return handleRequest(request, env) }}
}}

async function handleRequest(request, env) {{
  const url = new URL(request.url)
  const path = url.pathname
  const signup = await handleSignup(request, env)
  if (signup) return signup
  if (path === '/analytics.js') return new Response(ANALYTICS_JS, {{ headers: {{ 'Content-Type': 'application/javascript;charset=UTF-8', 'Cache-Control': 'public, max-age=300' }} }})
  const interest = await handleInterest(request, env)
  if (interest) return interest
  if (path === '/interest-ui.js') return new Response(INTEREST_UI, {{ headers: {{ 'Content-Type': 'application/javascript;charset=UTF-8', 'Cache-Control': 'no-store' }} }})
  if (path === '/designs') return Response.redirect(url.origin + '/designs/', 302)
  if (path.startsWith('/designs/')) {{
    const key = path.endsWith('/') ? path + 'index.html' : path
    const asset = DESIGN_ASSETS[key]
    const headers = {{
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Cache-Control': 'public, no-transform',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'"
    }}
    if (!asset) return new Response('Design not found', {{status: 404, headers}})
    headers['Content-Type'] = asset[0] + (asset[0].startsWith('text/') ? ';charset=UTF-8' : '')
    return new Response(Uint8Array.from(atob(asset[1]), c => c.charCodeAt(0)), {{headers}})
  }}
  if (path === '/x-embed.js') return new Response(X_EMBED_JS, {{headers: {{'Content-Type': 'application/javascript;charset=UTF-8'}}}})
  if (path === '/og-card.png') {{
    return new Response(OG_PNG, {{ headers: {{ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }} }})
  }}
  if (path === '/classic' || path.startsWith('/classic/')) {{
    return new Response(CLASSIC_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, no-transform', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://analytics.ideaflow.app; connect-src 'self' https://api.worldissuetracker.com https://analytics.ideaflow.app; object-src 'none'; base-uri 'self'" }} }})
  }}
  if (path === '/v4' || path.startsWith('/v4/')) {{
    return new Response(ARCHIVE_V4_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, no-transform', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://analytics.ideaflow.app; connect-src 'self' https://api.worldissuetracker.com https://analytics.ideaflow.app; object-src 'none'; base-uri 'self'" }} }})
  }}
  if (path === '/v2' || path.startsWith('/v2/')) {{
    return new Response(V2_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, no-transform', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://analytics.ideaflow.app; connect-src 'self' https://api.worldissuetracker.com https://analytics.ideaflow.app; object-src 'none'; base-uri 'self'" }} }})
  }}
  if (path === '/v3' || path.startsWith('/v3/')) {{
    return new Response(V3_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, no-transform', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://analytics.ideaflow.app; connect-src 'self' https://api.worldissuetracker.com https://analytics.ideaflow.app; object-src 'none'; base-uri 'self'" }} }})
  }}
  if (path === '/v1' || path.startsWith('/v1/')) {{
    return Response.redirect('https://humanityinfrastructure.com/', 301)
  }}
  return new Response(MAIN_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, no-transform', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://analytics.ideaflow.app; connect-src 'self' https://api.worldissuetracker.com https://analytics.ideaflow.app; frame-src 'none'; object-src 'none'; base-uri 'self'" }} }})
}}

const ANALYTICS_JS = `{escape_js(Path('analytics.js').read_text())}`
const X_EMBED_JS = `{escape_js(Path('scripts/x-embed.js').read_text())}`
const DESIGN_ASSETS = {json.dumps(designs)}
const MAIN_HTML = `{escape_js(main)}`
const V2_HTML = `{escape_js(v2)}`
const V3_HTML = `{escape_js(v3)}`
const CLASSIC_HTML = `{escape_js(classic)}`
const ARCHIVE_V4_HTML = `{escape_js(archive_v4)}`
const OG_PNG = Uint8Array.from(atob('{og_b64}'), c => c.charCodeAt(0))
"""

items = json.loads(Path('interest-items.json').read_text())
interest_ui = Path('interest-ui.js').read_text().replace('__INTEREST_ITEMS__', json.dumps(items, ensure_ascii=True))
worker = 'const INTEREST_ITEMS = ' + json.dumps(items, ensure_ascii=True) + ';\n' + Path('signup.js').read_text() + '\n' + Path('interest.js').read_text() + '\n' + worker + '\nconst INTEREST_UI = ' + json.dumps(interest_ui, ensure_ascii=True) + ';\n'
with open('worker.js', 'w') as f:
    f.write(worker)
print(f"worker.js rebuilt: {len(worker)} bytes")
