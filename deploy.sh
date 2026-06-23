#!/bin/bash
set -e

# Rebuild worker.js from the three HTML files
python3 << 'PYEOF'
import os, re

def escape_js(s):
    s = s.replace('\\', '\\\\')
    s = s.replace('`', '\\`')
    s = s.replace('${', '\\${')
    return s

with open('index.html') as f: main = f.read()
with open('v2.html') as f: v2 = f.read()
with open('v3.html') as f: v3 = f.read()

worker = f"""addEventListener('fetch', event => {{
  event.respondWith(handleRequest(event.request))
}})

async function handleRequest(request) {{
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/v2' || path.startsWith('/v2/')) {{
    return new Response(V2_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8' }} }})
  }}
  if (path === '/v3' || path.startsWith('/v3/')) {{
    return new Response(V3_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8' }} }})
  }}
  if (path === '/v1' || path.startsWith('/v1/')) {{
    return Response.redirect('https://humanityinfrastructure.com/', 301)
  }}
  return new Response(MAIN_HTML, {{ headers: {{ 'Content-Type': 'text/html;charset=UTF-8' }} }})
}}

const MAIN_HTML = `{escape_js(main)}`
const V2_HTML = `{escape_js(v2)}`
const V3_HTML = `{escape_js(v3)}`
"""

with open('worker.js', 'w') as f:
    f.write(worker)
print(f"worker.js rebuilt: {len(worker)} bytes")
PYEOF

# Deploy
CF_API_KEY="${CF_API_KEY:-$(grep CF_API_KEY ~/.config/cloudflare.env 2>/dev/null | cut -d= -f2)}"
if [ -z "$CF_API_KEY" ]; then
  CF_API_KEY="8ad55c49e86f4b6d923c4e191a459be7e03b8"
fi

curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/68d006db286e6366317c029df3bb76dd/workers/scripts/humanity-infrastructure" \
  -H "X-Auth-Email: tmad4000@gmail.com" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/javascript" \
  --data-binary @worker.js \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('✓ Deployed' if r.get('success') else f'ERROR: {r.get(\"errors\")}')"
