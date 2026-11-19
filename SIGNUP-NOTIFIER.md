# Private HI signup notifications

This host-side poller reads new HI signup IDs and uses the EXISTING Buzz bridge project-status helper to publish one private card per new ID. It never calls signup/interest APIs, Resend or an email sender. The public Worker, web pages and their configuration are unchanged.

Channel creation and every Buzz listener/route change belong exclusively to075fe138-b9c6-4277-80d6-addd30e38cf3. Activation requires that owner's signed/read-back proof that "HI Signups" is private and has exactly Jacob and Paseo, plus confirmation of this existing-helper contract. This repository does not create a channel, change a listener, or choose a fallback destination. Current helper location: `/home/dev/code/paseo-buzz-bridge-20261114/listener/project_status.py`; the adapter calls its existing main in a child process. The helper enforces ready private registry membership, fresh signed two-member scope, outbound locking, its durable operation journal and signed readback. No posting is allowed until075 supplies the exact verified channel ID/contract.

## Behavior and privacy

- Explicit bootstrap from the three existing signup IDs; no automatic historical import. Missing baseline/channel pin refuses to run. Never reset a live journal to fix delivery uncertainty.
- At most one D1 poll per minute, Nice10. Discover via an indexed UUID keyset page (`WHERE id > ? ORDER BY id LIMIT 50`), wrapping to the beginning after an empty page. The cursor and discoveries commit atomically in the local journal. Seen-ID dedupe allows wraparound without re-notification and detects new random UUIDs below the previous cursor, unlike a permanently increasing UUID cursor or a reusable SQLite rowid. Full-ID reads occur only for the one-time baseline. At 10k rows a full sweep takes about 201 minutes; this bounded-cost tradeoff means notification latency can grow with list size. Read email/consent time/source/interest only for at most ten due new IDs, never baseline/sent contacts. Existing D1-only credential is read in place, never copied or printed. SQL is fixed/parameterized SELECT only; redirects are refused. No token/hash/handle columns are fetched.
- A30-second settling delay lets optional interest details be saved; on the minute timer notification latency is roughly60–120seconds for the current small list; larger lists may take one full bounded sweep. The card labels consent time as recorded, not an immutable creation date (which the existing schema does not store). Duplicate consent refreshes do not create new cards.
- Email remains unverified. Submitted fields are quoted JSON data, not instructions. Control characters are removed; interest text is capped at280characters. Card contents go on stdin, never process argv. Local notifier state stores IDs, counts, times and delivery state only, never email/text. Its directory is0700 and files0600. The existing bridge keeps its own protected private card journal.
- Fixed channel and stable `hi-signup/<signup-id>` item key. Each successful helper call must return the exact channel/key and a verified message ID. Cards use done state, avoiding a work-item stale watchdog. The channel owner must confirm Paseo-authored notification data cannot trigger inbound agent commands/mentions.
- Busy shared outbound lock BEFORE publication can retry next minute. Unknown acceptance, timeout, interrupted publication or wrong readback halts all posting for owner075 reconciliation, never a blind resend. Shared listener services are not restarted. If the service is stopped mid-send, its pending journal is retained for inspection.
- Catch-up bursts use a durable batch: at most ten individual cards total, then one count-only summary for additional observed IDs. The budget survives lock-busy restarts, and overflow contact fields are never read. Summary ambiguity also halts rather than reposting. Deleted pending signup IDs are skipped.

## Install and rollback (owner slot only)

Review via a036208f, final exact-head GO, then an explicit b7541717 slot grant. No production signup/interest fixtures or email tests. Use the local synthetic SQLite/mock transport suite and a production IDs-only dry-run. Keep the public Worker unchanged; verify its source/body hashes and read-only health. Respect root's browser/CPU lane holds.

1. Verify `loginctl show-user dev -p Linger` is already yes (verified during preparation). Do not change lingering or require sudo; report if unavailable.
2. Obtain the approved channel and its fresh private two-member readback from075. Confirm the existing helper/registry is ready. No public fallback or synthetic post into the real channel. First real card is the next genuine signup.
3. Create immutable release under `~/.local/share/hi-signup-notifier/releases/<reviewed-sha>/`, containing only the two notifier scripts, unit files and this document; record file hashes. Atomically point `current` at that release. Do not copy unrelated app assets or credentials.
4. Create `~/.config/hi-signup-notifier/config.json`0600, directory0700:

```json
{
  "channel_name": "HI Signups",
  "channel_id": "EXACT-PRIVATE-UUID-FROM-075",
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

This stops only the owned poller/child process group. Preserve the private journal and helper's existing operation journal; inspect uncertain sends with075 before restarting. To remove installed units, unlink only these two owned unit files and user daemon-reload. Remove the `current` pointer only after stopping; keep reviewed releases/state for rollback. There is no Worker rollback, migration or email setting change for this host-only feature.

## Verification

`python3 -B -I -m unittest discover -s tests -p test_signup_notifier.py -v` uses synthetic signup copies and local SQLite plus mocked transport. It verifies no backfill, contact minimization, settling/latest details, duplicate suppression, deletion, busy/ambiguous recovery, interrupted claims, private ID-only state, catch-up budget/summary, safe quoted text and stdin-only helper data. No real signup, email or Buzz post occurs.
