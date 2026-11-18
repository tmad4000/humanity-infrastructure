# Private signup operations

The footer form and hero invitation capture an occasional letter subscription. D1 stores email, interest (200 characters), optional X handle, explicit public-handle opt-in, consent time, page path, allowlisted UTM values and referrer. Nothing is written to WIT. This slice does not publish handles; the checkbox records permission only. Per-card interest counts and double opt-in are deferred. No mail delivery service is connected yet; the CSV is the migration path to listmonk. Include each row's unsubscribe URL in any letter; exclude rows with `unsubscribed_at`.

Shelf integration: link to `/?interest=<key>#letter`. Known keys `unlinked`, `superconnector`, `openchat`, `ideaflow-index`, and `open-recordings` prefill the optional interest text with the display name. Other values prefill plain text, capped at 200 characters. The API has no item-key field or public count endpoint; send required `email` plus optional `interest`, `handle`, boolean `public_opt_in`, `website` (honeypot), `source_page`, `utm`, `referrer`.

`POST /api/signup` accepts JSON up to 4096 bytes, validates email/handle/interest, rejects cross-origin browser submissions, ignores honeypots and limits each hashed CF-Connecting-IP to five attempts per hour using atomic D1 SQL. Raw IPs are not stored. Rate rows expire through request-driven cleanup after 24 hours. Duplicates do not change consent, opt-in or unsubscribe state, and never reveal an existing token. Resubscription/change-of-details needs a verified-email flow later.

`GET /unsubscribe?t=…` marks the row unsubscribed; repeated requests are safe. Tokens have 256 random bits and are returned only on initial signup and in owner-only export. Private routes use `no-store` and `no-referrer` response headers.

`GET /admin/signups.csv` requires `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`. No token query parameter is accepted. CSV quotes fields and neutralizes spreadsheet formulas. The export includes opted-out rows with their status so migrations preserve opt-outs. Treat exports as private and do not attach them to PRs or logs.

## Storage and secrets

`wrangler.jsonc` declares both D1 environments and documents the required Worker secret names. This Wrangler version provisions secrets separately through `secret bulk`; never put secret values or placeholder values in `vars`. Upload/deploy preserves the existing secret bindings.

Account: `68d006db286e6366317c029df3bb76dd`.

- Production D1: `humanity-infrastructure-signups`, ID `848844f3-4379-4cb6-a7a3-a39a7bfc3624`.
- Preview D1: `humanity-infrastructure-signups-preview`, ID `374eb125-c67a-46bf-b73a-4a949afe83b6`.
- Schema: `migrations/0001_signups.sql`, applied before deployment.
- Worker secrets: `ADMIN_EXPORT_TOKEN`, `RATE_LIMIT_SALT` (independent values per environment).
- Owner-only host secret files: `/home/dev/.config/cloudflare/hi-signup-{production,preview}-secrets.json`, mode 0600. Do not print them. Upload with `wrangler-gcp secret bulk <file> [--env preview]`.
- D1 administration uses the narrow account-scoped D1-only token at `/home/dev/.config/cloudflare/d1-api-token`, mode 0600, provisioned by Machines. Deployments use the separate existing Workers Scripts token through `wrangler-gcp`.

For deletion requests, find and delete the exact email using a parameterized D1 query and verify absence. Preserve live subscribers and other sessions' resources.

## Verification

`node --test tests/signup.test.cjs` covers lifecycle behavior, validation, honeypot, per-IP attempt limits, duplicate consent/opt-out preservation and export authorization/CSV escaping. CI also rebuilds and checks the generated Worker.

On the authorized host, `python3 scripts/verify-signup.py <origin> preview` (or `production`) creates a uniquely named `@example.com` test row, verifies it via D1, verifies authenticated export, unsubscribes, then deletes the test row in `finally` and verifies absence. It prints no personal data, tokens or CSV. It expects the database IDs in `/tmp/hi-{preview,production}-db-id` and the owner-only secret files above.

## Rollback

Before signup rollout, production version was `cce497ca-0fe7-4020-908b-58b9bf225cbb` (directory-grid main `d2ce74f`, observed 2026-11-18). Immediately before each production mutation, re-read deployments and coordinate with plan owner `b7541717-a715-4511-b989-da22f6f6783c`.

Rollback code through `wrangler-gcp rollback cce497ca-0fe7-4020-908b-58b9bf225cbb --name humanity-infrastructure`. Keep D1 data and secrets intact. A rollback removes the form/routes from service without deleting subscribers. Do not run the legacy global-key upload script.
