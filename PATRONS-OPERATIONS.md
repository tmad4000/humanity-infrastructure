# Patrons page operations

`https://patronage.humanityinfrastructure.com/` (also served at `/patrons` on the main domain) is the Patrons of the Commons page: one small subscription for open software, shared by usage, adjustable by each patron, with a public ledger. **Payments are not live.** The buttons save interest only.

## Files

- `patrons/index.html`, `styles.css`, `app.js`, `theme.js`: the page. No inline script or style; the route sends a strict `default-src 'self'` policy. The page carries no analytics tracker.
- `patrons/catalog.json`: the project catalog shown on the page. Generated outside this repo (`commons-patronage` `tools/build_catalog.py`) from index.ideaflow.app/apps.json, this site's listings and the public GitHub repository lists; replace the file to update it.
- `patron.js`: `POST /api/patron-interest` and owner-only `GET /admin/patron-interest.csv`.
- `migrations/0004_patron_interest.sql`: additive table `patron_interest`.

`python3 scripts/build.py` embeds all of these in `worker.js`.

## What is stored

One row per email in D1 table `patron_interest`: email, level (`seed`, `supporter`, `patron`, `custom`), amount in cents, whether the person asked to be told when patronage opens, created/updated times, and the page path. A repeat submission updates the level. Responses are identical for new and repeat emails.

Nothing is written to `signups`, so saving a place never joins the newsletter, never triggers the welcome mail and is not seen by the signup notifier. No mail is sent by this feature. No third-party form service is used; the only processor is Cloudflare, which hosts the Worker and D1.

Abuse limits reuse `signup_rate_limits`: five attempts per salted address hash per hour, rows cleaned after 24 hours, raw addresses never stored. Cross-origin posts are rejected and a honeypot field is ignored silently.

Emails are not verified, and a repeat submission from anyone can change that email's level or opt-in. Treat the export as unverified: before any mailing, send only to rows with `notify_opt_in = 1`, include an unsubscribe link, and expect a few addresses to be mistyped or entered by someone else. The opt-in box is unticked by default.

Export: `GET /admin/patron-interest.csv` with `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`. Treat exports as private. For a deletion request, delete the exact email with a parameterized D1 query and verify absence.

## Turning payments on (needs Jacob)

`PAYMENTS` at the top of `patrons/app.js` holds `null` Stripe Payment Link slots per level and a `null` Patreon URL. A level with a link sends the button to Stripe; a level without one opens the interest form. `tests/patron.test.cjs` asserts the slots are `null`, so enabling payments is a deliberate, reviewed change. Emailing the people who saved a place needs Jacob's approval of the exact text first.

## Subdomain

`patronage.humanityinfrastructure.com` is a Worker Custom Domain on the `humanity-infrastructure` Worker. On that host `/` serves the page; any path that is not the page, its assets or its API redirects to the main site. Remove it with `DELETE /accounts/<account>/workers/domains/<id>`; the page stays at `/patrons`.

## Release

1. Apply `migrations/0004_patron_interest.sql` to the preview and production D1 databases with the D1-only token. It is additive.
2. `./deploy.sh --env preview`, check `/patrons` and one synthetic `@example.com` submission, then delete that row.
3. Read the current production version (`wrangler-gcp deployments list --name humanity-infrastructure`), then `./deploy.sh`.
4. Roll back code with `wrangler-gcp rollback <previous version> --name humanity-infrastructure`. The table and its rows stay.
