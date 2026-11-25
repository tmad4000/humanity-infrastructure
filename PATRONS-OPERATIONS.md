# Patrons page operations

`https://patronage.humanityinfrastructure.com/` (also served at `/patrons` on the main domain) is the Patrons of the Commons page: one small subscription for open software, shared by usage, adjustable by each patron, with a public ledger. **Payments are not live.** The buttons save interest only.

## Files

- `patrons/index.html`, `styles.css`, `app.js`, `theme.js`: the page. No inline script or style; the route sends a strict `default-src 'self'` policy. The page carries no analytics tracker.
- `patrons/catalog.json`: the project catalog shown on the page. Generated outside this repo (`commons-patronage` `tools/build_catalog.py`) from index.ideaflow.app/apps.json, this site's listings and the public GitHub repository lists; replace the file to update it.
- `patrons/lab.js`: own split, lists, stack scan, nominations, sign-in control. `patrons/beyond.html`: the "Beyond software" page (`/beyond` on the subdomain, `/patrons/beyond` on the main domain).
- `patron.js`: `POST /api/patron-interest`, `POST /api/patron-nominate`, `GET /api/patron-session`, `/auth/ideaflow/*`, and owner-only `GET /admin/patron-interest.csv` and `/admin/patron-nominations.csv`.
- `migrations/0004_patron_interest.sql`, `0005_patron_followups.sql`: tables `patron_interest` and `patron_nominations`.

`python3 scripts/build.py` embeds all of these in `worker.js`.

## What is stored

One row per email in D1 table `patron_interest`: email, level (`seed`, `supporter`, `patron`, `custom`), amount in cents, whether the person asked to be told when patronage opens, created/updated times, and the page path. A repeat submission updates the level. Responses are identical for new and repeat emails.

Nothing is written to `signups`, so saving a place never joins the newsletter, never triggers the welcome mail and is not seen by the signup notifier. No mail is sent by this feature. No third-party form service is used; the only processor is Cloudflare, which hosts the Worker and D1.

Abuse limits reuse the `signup_rate_limits` table on a separate key: twelve attempts per salted address hash per hour, rows cleaned after about a day, raw addresses never stored. Cross-origin posts are rejected and a honeypot field is ignored silently.

Emails are not verified, and a repeat submission from anyone can change that email's level or opt-in. Treat the export as unverified: before any mailing, send only to rows with `notify_opt_in = 1`, include an unsubscribe link, and expect a few addresses to be mistyped or entered by someone else. The opt-in box is unticked by default.

Export: `GET /admin/patron-interest.csv` with `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`. Treat exports as private. For a deletion request, delete the exact email with a parameterized D1 query and verify absence.

## Fund-your-own split, lists, scan, nominations

- **Own split.** The Fund section lets a visitor pick catalog projects and set a monthly amount for each. Saving posts `allocations` (`{projectId: dollars}`) with level `custom`; the Worker accepts only ids in `PATRON_PROJECT_IDS` (generated from the featured entries of `patrons/catalog.json`), 40 at most, $0.50 to $1,000 each, and stores cents as JSON in `patron_interest.allocations`. The total becomes `amount_cents`. Still no payment.
- **Lists.** Official lists live in `patrons/catalog.json` under `lists`. A visitor's own list is kept in their browser (`localStorage`) and shared as a link (`#list=id,id&name=...`); nothing about lists is stored on the server. A shared link is shown with a "not curated or checked by us" label and only resolves ids that exist in the catalog.
- **Scan your stack.** `patrons/lab.js` parses package.json, requirements.txt, Cargo.toml, go.mod, Gemfile and Brewfile text in the browser. No file content is sent. "Nominate selected" sends only the ticked package names and their registry (30 at most).
- **Nominations.** `POST /api/patron-nominate` writes to `patron_nominations` with `status = 'pending'`. This is the review queue. There is no public read route. Review by exporting `GET /admin/patron-nominations.csv` (bearer token), checking the project, its license and its maintainers, then adding accepted projects to the catalog through a pull request and setting `status` to `accepted` or `declined` with a parameterized D1 update.
- **Rate limit.** Both patron forms share sixty units per salted address hash per hour, on a key separate from the newsletter and interest forms. A submission costs five units (twelve an hour); a stack scan costs one unit per package. New nominations are refused while more than 5,000 are pending.
- `migrations/0005_patron_followups.sql` adds the two columns and the nominations table. The `ALTER TABLE` statements are not repeatable: apply once per database, after checking `PRAGMA table_info(patron_interest)`.

## Have a say (voices and comments)

Design and roadmap: `docs/patrons/HAVE-A-SAY.md`.

- `POST /api/patron-voice` stores one voice per project per salted address hash in `patron_voices` (migration 0006): relation (`use`, `benefit`, `believe`), optional comment (500 characters) and display name. Speaking again replaces the earlier voice. A voice costs two rate-limit units, so thirty an hour.
- `GET /api/patron-voices` is public: counts per project by relation, and comments whose status is `approved`. It never returns hashes, row ids or pending text. Cached for 30 seconds.
- **Comments are not public until approved.** Read the queue with `GET /admin/patron-voices.csv` (bearer token; rows with `comment_status = pending`), then approve or decline each with `POST /admin/patron-voices/moderate` and body `{"id": "...", "updated_at": "...", "status": "approved"}` (same token; `updated_at` is copied from the export so the decision applies only to the text you read; an edit since then returns 409). Changing a comment or its display name sends it back to `pending`.
- Counts are a show of hands, not a ballot: one network is not one person. IPv4 addresses count singly and an IPv6 /64 counts as one, so people behind one shared address share a voice per project and can replace each other's. Nothing here moves money.
- The public read is cached at the edge for 30 seconds through the Cache API, so a new voice or approval can take that long to show.
- For a deletion request, delete by row id after finding it in the export; there is no email on a voice.

## Optional Ideaflow ID sign-in (off until configured)

Sign-in is disabled unless all three Worker secrets exist: `IDEAFLOW_CLIENT_ID`, `IDEAFLOW_CLIENT_SECRET`, `PATRON_SESSION_SECRET` (a long random string). Without them `/auth/ideaflow/*` returns 404, `/api/patron-session` reports `enabled: false`, and the page shows no sign-in control.

To turn it on, an OAuth client must be registered on id.ideaflow.app (it has no self-registration) with redirect URIs `https://patronage.humanityinfrastructure.com/auth/ideaflow/callback` and `https://humanityinfrastructure.com/auth/ideaflow/callback`, scopes `openid email`. Then upload the three secrets with `wrangler-gcp secret bulk`. The flow is authorization code with PKCE and a state cookie; the session is an HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie holding the account id and verified email for 30 days. A signed-in save stores the account id in `patron_interest.ideaflow_sub` only when the account's verified email matches the saved email, and never replaces an id already there. Before enabling sign-in, add the account id to the page's "What do you store" note. The flow is covered by tests against a mocked provider and has not yet been run against the real one.

## Turning payments on (needs Jacob)

`PAYMENTS` at the top of `patrons/app.js` holds `null` Stripe Payment Link slots per level and a `null` Patreon URL. A level with a link sends the button to Stripe; a level without one opens the interest form. `tests/patron.test.cjs` asserts the slots are `null`, so enabling payments is a deliberate, reviewed change. Emailing the people who saved a place needs Jacob's approval of the exact text first.

## Subdomain

`patronage.humanityinfrastructure.com` is a Worker Custom Domain on the `humanity-infrastructure` Worker. On that host `/` serves the page; any path that is not the page, its assets or its API redirects to the main site. Remove it with `DELETE /accounts/<account>/workers/domains/<id>`; the page stays at `/patrons`.

## Release

1. Apply `migrations/0004_patron_interest.sql` to the preview and production D1 databases with the D1-only token. It is additive.
2. `./deploy.sh --env preview`, check `/patrons` and one synthetic `@example.com` submission, then delete that row.
3. Read the current production version (`wrangler-gcp deployments list --name humanity-infrastructure`), then `./deploy.sh`.
4. Roll back code with `wrangler-gcp rollback <previous version> --name humanity-infrastructure`. The table and its rows stay.
