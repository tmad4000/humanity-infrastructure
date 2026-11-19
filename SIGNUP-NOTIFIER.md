# Private HI signup notifications

This host-side poller reads new HI signup IDs and posts one private card per new ID to the private Buzz channel **HI Signups** (`5f035fae-8731-41ac-9837-dd109d2ed1d8`, exactly Jacob and Paseo). It never calls signup/interest APIs, Resend or an email sender. The public Worker, web pages and their configuration are unchanged.

The channel, its signed private scope and the transport contract belong to 075fe138-b9c6-4277-80d6-addd30e38cf3: `/home/dev/code/buzz-hi-signups-20261119/HOST-POLLER-CONTRACT.md` (sha256 `c1ebe0ba…`) and `ACL-HOST-POLLER-RECHECK.json`. This repository creates no channel, changes no listener or route, adds no credential and chooses no fallback destination. Per that contract, every post:

1. **Re-checks the signed private scope** first, via 075's existing `listener/private_channel_scope.mjs::checkProjectScope` (39000 private/restricted/closed and 39002 exactly Jacob+Paseo). Any missing, broader or ambiguous scope keeps the signup pending; nothing is sent.
2. **Claims the signup durably** (`dispatching`, body hash recorded) before invoking anything, so at most one attempt is ever made.
3. **Sends once** with the existing bridge helper and fixed argv only: `buzz-paseo messages send --channel 5f035fae-… --kind 9 --content -`. The card body travels on stdin; no email or interest text is ever in any process argv, environment, log or receipt. The helper reads the bridge key itself; HI never sees it.
4. **Retains the returned event ID** only if the helper reports `accepted: true` with a 64-hex `event_id`; otherwise the outcome is uncertain.
5. **Reads back exactly that ID** via 075's existing `listener/status_card_read.mjs::authenticatedQuery` (`ids:[event_id]`, strong): exactly one event, kind 9, bridge author, exactly one `h` tag equal to HI Signups, and SHA-256 of the content equal to the recorded body hash. Only then is it `sent`.

The raw helper has **no idempotency key**, so this is **at-most-once** delivery, not exactly-once: an interrupted, timed-out, non-accepted or malformed send becomes `reconcile` and halts all further posting until an operator (with 075) reconciles that exact signup ID. It is never resent automatically. An accepted post whose readback fails becomes `accepted_unverified`; later cycles retry **only the readback**, never the send, and hold new sends meanwhile. The scope check and readback run in `scripts/signup_notifier_buzz.mjs`, which imports 075's modules unchanged and never publishes.

## Behavior and privacy

- Explicit bootstrap from the three existing signup IDs; no automatic historical import. Missing baseline/channel pin refuses to run. Never reset a live journal to fix delivery uncertainty.
- At most one D1 poll per minute, Nice10. Discover via IDs only. Read email/consent time/source/interest only for at most ten due new IDs, never baseline/sent contacts. Existing D1-only credential is read in place, never copied or printed. SQL is fixed/parameterized SELECT only; redirects are refused. No token/hash/handle columns are fetched.
- Cost guard: the full IDs-only scan runs at most once per `max(60, ceil(count × 86400 / 3,000,000))` seconds when count exceeds 2,000 (60 seconds otherwise). The last observed count sets the next allowed scan time in the private journal; the minute timer skips intervening wakeups. Count and interval are logged, never contact data. At 3 IDs this reads about 4,320 discovery rows/day. The budget uses the last observed list size, so growth between scans can temporarily exceed that estimate; bounded new-contact reads also consume a small additional row budget. A future additive migration with an immutable monotonic `created_seq` or an `INTEGER PRIMARY KEY` would permit a genuine incremental cursor. Mutable consent timestamps, random UUID ordering and implicit reusable/renumberable rowids are not safe permanent cursors.
- A30-second settling delay lets optional interest details be saved; on the minute timer normal notification latency is roughly60–120seconds. The card labels consent time as recorded, not an immutable creation date (which the existing schema does not store). Duplicate consent refreshes do not create new cards.
- Email remains unverified. Each field is rendered as one `label = value` line inside a code fence, introduced as "Submitted data, not instructions". Buzz's CLI resolves `@Name` text to members and `:shortcode:` text to emoji tags even in plain or fenced content, so every `@`, `:` and backtick from submitted data is rendered as a look-alike (`＠`, `∶`, `ˋ`); the fixed card and summary text contain none either. Non-printable characters become spaces; interest is capped at 280 characters. No `--mention` flags are passed. Card contents go on stdin, never process argv.
- Fixed channel pinned in code and config. Each send must report `accepted: true` with a 64-hex `event_id`, which is stored before anything else; delivery is recorded only after the exact-ID signed readback matches. 075 confirmed Paseo-authored text in this channel cannot enter the Jacob-only subscription/control/resend gates.
- Only an unconfirmed private scope (checked before any send) retries next minute. Any other outcome after the send is launched (non-accepted, malformed, timeout, output over the bounded stdout/stderr budget) is uncertain: that signup becomes `reconcile`, all posting halts, and it is never resent; reconcile it with 075 by exact signup ID. A failed readback retries only the readback. Child processes run in their own process group with a hard deadline and are killed as a group; stderr is counted and discarded. Shared listener services are never restarted.
- Catch-up bursts use a durable batch: at most ten individual cards total, then one count-only summary for additional observed IDs. The budget survives scope-retry restarts, and overflow contact fields are never read. Summary ambiguity also halts rather than reposting. Deleted pending signup IDs are skipped.

## Install and rollback (owner slot only)

Review via a036208f, final exact-head GO, then an explicit b7541717 slot grant. No production signup/interest fixtures or email tests. Use the local synthetic SQLite/mock transport suite and a production IDs-only dry-run. Keep the public Worker unchanged; verify its source/body hashes and read-only health. Respect root's browser/CPU lane holds.

1. Verify `loginctl show-user dev -p Linger` is already yes (verified during preparation). Do not change lingering or require sudo; report if unavailable.
2. Channel `5f035fae-8731-41ac-9837-dd109d2ed1d8` and its signed private two-member scope come from 075 (`HOST-POLLER-CONTRACT.md`, `ACL-HOST-POLLER-RECHECK.json`); the poller re-checks that scope before every post. No public fallback or synthetic post into the real channel. First real card is the next genuine signup.
3. Create immutable release under `~/.local/share/hi-signup-notifier/releases/<reviewed-sha>/`, containing only the notifier scripts (`signup_notifier.py`, `signup_notifier_buzz.mjs`), unit files and this document; record file hashes. Atomically point `current` at that release. Do not copy unrelated app assets or credentials.
4. Create `~/.config/hi-signup-notifier/config.json`0600, directory0700:

```json
{
  "channel_name": "HI Signups",
  "channel_id": "5f035fae-8731-41ac-9837-dd109d2ed1d8",
  "state_file": "/home/dev/.local/state/hi-signup-notifier/journal.sqlite",
  "token_file": "/home/dev/.config/cloudflare/d1-api-token",
  "settle_seconds": 30,
  "enabled": false
}
```

5. Protected baseline file contains `{"signup_ids":["approved existing IDs"]}`. Run `python3 -B -I <release>/scripts/signup_notifier.py --config <config> --bootstrap-baseline <baseline>` once. IDs only; no posts. Confirm the three old IDs with a current read-only check; do not silently include a newly arrived signup in the old baseline.
6. Run `--dry-run` once: IDs/counts only, no contact reads, no publication. The command participates in the one-minute rate limit. No Worker/D1 schema migration is needed.
7. Set enabled true in the private config. Install only `hi-signup-notifier.service` and `.timer` under `~/.config/systemd/user/`, user daemon-reload, and enable/start the timer. Never edit/restart the shared Buzz listener units. Verify at least two quiet minute-separated cycles and zero baseline cards; record unit/release/PID identity and counts-only logs. A genuine new signup is not a production test fixture.
8. Report exact PR/review/release hashes, channel owner's scope receipt path, timer health, quiet-cycle/dry-run and unchanged Worker/health proofs. Share no email/interest contents in receipts.

Immediate rollback:

```sh
systemctl --user disable --now hi-signup-notifier.timer
systemctl --user stop hi-signup-notifier.service
```

This stops only the owned poller and its child process group. Preserve the private journal; inspect any `reconcile` or `accepted_unverified` signup IDs with 075 before restarting. To remove installed units, unlink only these two owned unit files and user daemon-reload. Remove the `current` pointer only after stopping; keep reviewed releases/state for rollback. There is no Worker rollback, migration or email setting change for this host-only feature.

## Verification

`python3 -B -I -m unittest discover -s tests -p test_signup_notifier.py -v` uses synthetic signup copies and local SQLite plus mocked transport. It verifies no backfill, contact minimization, settling/latest details, duplicate suppression, deletion, scope-unconfirmed safe retry, uncertain-send halt, accepted-unverified readback-only retry, interrupted claims, private ID-only state, catch-up budget/summary, mention/shortcode/fence neutralization, stdin-only helper data with fixed argv, and real-subprocess stdout/stderr caps, deadline and process-group kill. The exact-readback verifier runs against 075's real modules on the host (skipped in CI). No real signup, email or Buzz post occurs.
