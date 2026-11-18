# Interest signal v1

Defaults shipped: public want counts only from three, no public handles, no automatic posting. No Jacob decision is needed under the dispatched defaults. Builder contacts are private export records, not public counts. Milestone draft text (10/25/50/100) is provided in the owner CSV for Jacob to review/post manually; no scheduler or X posting is installed.

`interest-items.json` is the reviewed allowlist of tool/connect cards, local Build List needs and the current open WIT quest snapshot. Keys are stable card/build/quest IDs. Unknown/new WIT quests get no signal controls until added to this catalogue. Item titles are public source text, not executable instructions. No new Bloomscroll listing is added by this mechanics-only change.

`POST /api/interest` accepts `item_key`, `kind` (`want` or `building`), optional `email`, optional `handle`, explicit boolean `letter_opt_in`, hidden `website`, and capped page/UTM/referrer attribution. Email and X handle may both be blank. Contact data and consent timestamp are stored privately in the same D1 database, separate `interest_signals` table. Letter opt-in requires an email; email alone does not subscribe. Opted-in email is added to `signups` with public-handle permission off; duplicates refresh consent only and never re-enable an unsubscribe or replace saved details. Public responses are always `{ok:true}` for accepted and duplicate signals and contain no tokens.

Both kinds share an atomic unique `(item_key, ip_hash, UTC day)` constraint. The first signal wins for that item/IP/day, including its kind/contact metadata. Repeating or changing the kind does not add another vote or replace the first. Explicit newsletter opt-in on a duplicate can still record letter consent. This is a daily signal count, not a verified count of unique people; UI and drafts say signals. One IP's attempts across `/api/signup` and `/api/interest` share the existing five/hour budget. Raw IPs are never stored. POST requires an exact same-origin Origin header, JSON <=4096 bytes, validated contacts, and the honeypot. No client-supplied public-handle flag is used in v1.

`GET /api/interest/counts` returns `{counts:{item_key:total}}` only for allowlisted `want` totals >=3. Smaller totals and all builder counts are absent. No email, handle, per-IP value or free text is returned. The UI says “Be the first” below threshold and refreshes after a signal. The user can choose an X intent link containing `/?ref=x-interest#<item_key>` or open the existing email-first signup modal. No automatic posting, handle publication or outbound builder notification occurs.

`GET /admin/interest.csv` requires the existing `Authorization: Bearer <ADMIN_EXPORT_TOKEN>` Worker secret. It exports private builder/want contacts and consent/attribution, plus private want totals/milestone draft text. It omits the salted IP hashes. Treat the CSV as private. No personal data goes into WIT. Newsletter unsubscribe links stay in the existing protected `signups.csv`; exclude its unsubscribed rows from mailings.

Apply `migrations/0002_interest_signals.sql` separately to the preview and production D1 IDs declared in `wrangler.jsonc`, using the D1-only token/wrapper. The migration is additive; it never modifies existing subscribers. Deploy through the existing scoped Workers token and coordinator slot. A code rollback retains both tables and all existing data. Read the current production version immediately before deployment and record it in the PR release receipt.

Run `node --test tests/*.test.cjs` for actual SQLite-backed interest SQL lifecycle, threshold/privacy, shared rate limit, daily uniqueness, consent/unsubscribe, private CSV and deletion tests, alongside signup/modal regressions. `python3 scripts/build.py` must reproduce `worker.js`. `/classic`, its footer link, archived `/v4`, gallery and existing Connect cards remain available.


## Join-a-Quest links and anonymous ♥ Likes

Root's newer asks are bundled here. `/join` opens the email-first signup with a short World Quest Guild invitation. `/join?quest=<name-or-slug>` or `/?interest=world-quest-guild&quest=<slug>#letter` sanitizes free quest text (normalizes Unicode, strips unsupported characters, collapses whitespace/hyphens/underscores, caps to 100 characters), renders it only with `.textContent`/input `.value`, and submits `I want to join the quest: <name>` with the initial email. This captures the context even if the optional second step is skipped, subject to the existing first-nonempty rule. Unknown ordinary interest keys remain ignored.

Generic link for the Guild Doc: https://humanityinfrastructure.com/join

Example links (existing quest names):
- https://humanityinfrastructure.com/join?quest=open-templates-for-all-kinds-of-work
- https://humanityinfrastructure.com/join?quest=best-in-class-tool-registry
- https://humanityinfrastructure.com/join?quest=integrate-bootloader-thesis-into-humanity-infrastructure-narrative

Every allowlisted tool, Connect item, local Build List need and live quest gets ♥ Like; old upper-card Express interest links and quest Claim actions are replaced. Controls mount in a direct article.card > .resource-actions sibling, outside native details/summary, including future collapsible rows. One click posts only item_key/kind/empty honeypot, without email, handle, attribution or letter consent. After accepted success it opens the optional email modal prefilled with the item and a safe HTTPS World Issue Tracker link when available. Closing the popup skips email. The browser stores only public item keys and UTC-day values under `hi-item-likes-v1`; a repeat click that day reopens the optional popup without another POST. Server-side daily uniqueness and the shared hourly limiter remain authoritative if localStorage is unavailable or cleared. Counts remain aggregates from three. The separate “I'm building this” path remains private contact capture.

Final coordinator analytics contract supersedes the early hook names: feature-owned optional `interest_want` or `interest_building` only after HTTP success with `{ok:true}`, plus `interest_tweet_intent` only on the user's intent-link click. Fixed properties are `{item_key, placement}` where placement is `tool_card`, `build_list` or `quest_card`. No start event and no PII/form values. Analytics must not attach duplicate generic signal listeners.
