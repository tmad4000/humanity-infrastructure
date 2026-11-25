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
  async fetch(request, env, ctx) {{ return handleRequest(request, env, ctx) }}
}}

async function handleRequest(request, env, ctx) {{
  const url = new URL(request.url)
  const path = url.pathname
  const signup = await handleSignup(request, env, ctx)
  if (signup) return signup
  if (path === '/analytics.js') return new Response(ANALYTICS_JS, {{ headers: {{ 'Content-Type': 'application/javascript;charset=UTF-8', 'Cache-Control': 'public, max-age=300' }} }})
  const interest = await handleInterest(request, env, ctx)
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
  const patron = await handlePatron(request, env, ctx)
  if (patron) return patron
  const patronHost = url.hostname === 'patronage.humanityinfrastructure.com'
  if (patronHost && path === '/beyond/') return Response.redirect(url.origin + '/beyond', 302)
  if (patronHost && path !== '/' && path !== '/beyond' && path !== '/concepts/localvocal' && !Object.hasOwn(PATRONS_ASSETS, path)) return Response.redirect(path === '/patrons' || path === '/patrons/' ? url.origin + '/' : 'https://humanityinfrastructure.com' + path + url.search, 302)
  if ((patronHost && path === '/beyond') || path === '/patrons/beyond') return new Response(PATRONS_BEYOND_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=300', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }} }})
  // Unlisted concept page: not linked from the site, and marked noindex in both the header and the page.
  if ((patronHost && path === '/concepts/localvocal') || path === '/patrons/concepts/localvocal') return new Response(PATRONS_CONCEPT_LOCALVOCAL_HTML, {{ headers: {{ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }} }})
  if (Object.hasOwn(PATRONS_ASSETS, path)) return new Response(PATRONS_ASSETS[path][1], {{ headers: {{ 'Content-Type': PATRONS_ASSETS[path][0], 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }} }})
  if (patronHost || path === '/patrons' || path === '/patrons/') return new Response(PATRONS_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=300', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }} }})
  if (path === '/tools/lastbook' || path === '/tools/lastbook/') return new Response(LASTBOOK_HTML, {{headers: {{'Content-Type':'text/html;charset=UTF-8'}}}})
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
const PATRONS_CONCEPT_LOCALVOCAL_HTML = {json.dumps(Path('patrons/concept-localvocal.html').read_text(), ensure_ascii=True)}
const PATRONS_BEYOND_HTML = {json.dumps(Path('patrons/beyond.html').read_text(), ensure_ascii=True)}
const PATRONS_HTML = {json.dumps(Path('patrons/index.html').read_text(), ensure_ascii=True)}
const PATRONS_ASSETS = {json.dumps({'/patrons/' + name: [mime, Path('patrons/' + name).read_text()] for name, mime in [('styles.css', 'text/css;charset=UTF-8'), ('app.js', 'application/javascript;charset=UTF-8'), ('lab.js', 'application/javascript;charset=UTF-8'), ('concept.js', 'application/javascript;charset=UTF-8'), ('theme.js', 'application/javascript;charset=UTF-8'), ('catalog.json', 'application/json;charset=UTF-8')]}, ensure_ascii=True)}
const LASTBOOK_HTML = {json.dumps(Path('tools/lastbook.html').read_text())}
const MAIN_HTML = `{escape_js(main)}`
const V2_HTML = `{escape_js(v2)}`
const V3_HTML = `{escape_js(v3)}`
const CLASSIC_HTML = `{escape_js(classic)}`
const ARCHIVE_V4_HTML = `{escape_js(archive_v4)}`
const OG_PNG = Uint8Array.from(atob('{og_b64}'), c => c.charCodeAt(0))
"""

items = json.loads(Path('interest-items.json').read_text())
interest_ui = Path('interest-ui.js').read_text().replace('__INTEREST_ITEMS__', json.dumps(items, ensure_ascii=True))
patron_ids = [e['id'] for e in json.loads(Path('patrons/catalog.json').read_text())['entries'] if e['tier'] == 'featured']
worker = 'const PATRON_PROJECT_IDS = ' + json.dumps(patron_ids) + ';\nconst INTEREST_ITEMS = ' + json.dumps(items, ensure_ascii=True) + ';\n' + Path('welcome.js').read_text() + '\n' + Path('signup.js').read_text() + '\n' + Path('interest.js').read_text() + '\n' + Path('patron.js').read_text() + '\n' + worker + '\nconst INTEREST_UI = ' + json.dumps(interest_ui, ensure_ascii=True) + ';\n'
with open('worker.js', 'w') as f:
    f.write(worker)
print(f"worker.js rebuilt: {len(worker)} bytes")
