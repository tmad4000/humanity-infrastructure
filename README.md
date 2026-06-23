# Humanity Infrastructure

**[humanityinfrastructure.com](https://humanityinfrastructure.com)**

Open infrastructure for human flourishing — knowledge, tools, and coordination systems for everyone.

## Design versions

| URL | File | Description |
|-----|------|-------------|
| `/` | `index.html` | Original — dark/teal, "Knowledge is a birthright", quests |
| `/v2` | `v2.html` | Editorial/red split-panel, "Knowledge *birthright.* is a" |
| `/v3` | `v3.html` | Dark blueprint, "We build the missing civilization layer" |

## Deployment

Served via Cloudflare Worker (`worker.js`) on the `humanity-infrastructure` script.

```bash
# Deploy
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/68d006db286e6366317c029df3bb76dd/workers/scripts/humanity-infrastructure" \
  -H "X-Auth-Email: tmad4000@gmail.com" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/javascript" \
  --data-binary @worker.js
```

Or run `./deploy.sh` (requires `CF_API_KEY` env var or uses the key from `~/.config/cloudflare.env`).

## Origin

- `index.html` originally from `humanity3-earth` repo on M3
- Site previously redirected to `humanity3.earth`
- WIT tracker: [humanity-infrastructure.worldissuetracker.com](https://humanity-infrastructure.worldissuetracker.com)
