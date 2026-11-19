#!/usr/bin/env python3
"""Private, new-ID-only HI signup polling. No signup writes or email sending.

Delivery follows 075's HOST-POLLER-CONTRACT.md: fresh signed private-scope check
before every write, the existing bridge helper with the card body on stdin only,
at most one attempt per signup, and exact signed readback of the returned event ID.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

ACCOUNT = '68d006db286e6366317c029df3bb76dd'
DATABASE = '848844f3-4379-4cb6-a7a3-a39a7bfc3624'
SELECT_IDS = 'SELECT id FROM signups ORDER BY id'
CHANNEL = '5f035fae-8731-41ac-9837-dd109d2ed1d8'  # "HI Signups", exact Jacob+Paseo (075 handoff)
HELPER = '/home/dev/code/paseo-buzz-bridge-20261114/buzz-paseo'
NODE = '/usr/local/bin/node'
BUZZ_CHECK = Path(__file__).resolve().with_name('signup_notifier_buzz.mjs')
HEX64 = re.compile('[a-f0-9]{64}')
OUTPUT_CAP = 16384


class SafeRetry(Exception):
    """Definitely nothing published (e.g. scope not confirmed before any send)."""


class UncertainDelivery(Exception):
    """Invocation happened; outcome unknown. Never retry the send automatically."""


def poll_interval(count):
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise ValueError('invalid signup count')
    # Integer ceil avoids floating-point drift at the daily row budget boundary.
    return max(60, (count * 86400 + 2999999) // 3000000) if count > 2000 else 60


def timestamp(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()


def checked_id(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('invalid signup/channel ID')
    return value


def private_file(path):
    p = Path(path)
    if p.is_symlink() or p.stat().st_mode & 0o077:
        raise ValueError('private file permissions required')
    return p


def read_config(path):
    config = json.loads(private_file(path).read_text())
    if checked_id(config['channel_id']) != CHANNEL or config.get('channel_name') != 'HI Signups':
        raise ValueError('fixed private channel required')
    if not 0 <= config.get('settle_seconds', 30) <= 300:
        raise ValueError('invalid settle interval')
    return config


def body_sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class D1Reader:
    def __init__(self, token_file):
        self.token_file = token_file

    def _query(self, sql, params=None):
        token = private_file(self.token_file).read_text().strip()
        request = urllib.request.Request(
            f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DATABASE}/query',
            data=json.dumps({'sql': sql, 'params': params or []}).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            result = json.load(response)
        if not result.get('success') or len(result.get('result', [])) != 1:
            raise RuntimeError('D1 read failed')
        return result['result'][0]['results']

    def ids(self):
        return [r['id'] for r in self._query(SELECT_IDS)]

    def rows(self, ids):
        if not ids:
            return []
        if len(ids) > 10:
            raise ValueError('bounded contact read required')
        for identifier in ids:
            checked_id(identifier)
        return self._query('SELECT id,email,consent_at,source_page,interest FROM signups WHERE id IN (' + ','.join('?' for _ in ids) + ')', ids)


class Journal:
    def __init__(self, path, channel):
        self.path, self.channel = Path(path), checked_id(channel)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.parent.is_symlink() or self.path.parent.stat().st_mode & 0o077:
            raise ValueError('private state directory required')
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        private_file(self.path)
        self.db = sqlite3.connect(self.path)
        self.db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        # IDs, states, hashes and event IDs only; never email/interest text.
        self.db.execute('''CREATE TABLE IF NOT EXISTS seen(
            signup_id TEXT PRIMARY KEY,state TEXT NOT NULL,observed_at REAL NOT NULL,
            body_sha TEXT,event_id TEXT,published_at REAL,error TEXT)''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS batches(
            batch_key TEXT PRIMARY KEY,state TEXT NOT NULL,created_at REAL NOT NULL,
            individual_ids TEXT NOT NULL,overflow_ids TEXT NOT NULL,body_sha TEXT,event_id TEXT)''')
        self.db.commit()

    def close(self):
        self.db.close()

    def bootstrap(self, ids, now):
        if self.db.execute('SELECT 1 FROM meta').fetchone():
            raise ValueError('already initialized; never reset a live baseline')
        ids = [checked_id(i) for i in ids]
        with self.db:
            self.db.executemany("INSERT INTO seen(signup_id,state,observed_at) VALUES (?,'baseline',?)", [(i, now) for i in ids])
            self.db.executemany('INSERT INTO meta VALUES (?,?)', [('channel', self.channel), ('cutover_at', timestamp(now))])

    def ready(self):
        row = self.db.execute("SELECT value FROM meta WHERE key='channel'").fetchone()
        if not row or row[0] != self.channel:
            raise ValueError('explicit baseline or channel pin missing')


NEUTRAL = str.maketrans({'@': '＠', ':': '∶', '`': 'ˋ'})


def literal(value):
    # Buzz's CLI resolves @Name text to members and :shortcode: text to emoji tags, even in
    # plain or fenced content. Render those characters as look-alikes so neither can form, and
    # so no backtick can close the fence. Newlines/tabs become spaces: one field, one line.
    cleaned = ''.join(c if c.isprintable() else ' ' for c in value)
    return cleaned.translate(NEUTRAL)


def card(row):
    fields = {}
    for key, label, cap in [('email', 'email', 254), ('consent_at', 'recorded_at_utc', 100), ('source_page', 'source', 300), ('interest', 'interest', 280)]:
        value = row.get(key, '')
        if value is None:
            value = ''
        if not isinstance(value, str):
            raise ValueError('invalid stored signup field')
        if key == 'interest':
            value = value[:cap]
        elif len(value) > cap:
            raise ValueError('invalid stored signup field')
        fields[label] = literal(value)
    # One "label = value" line per field inside a fence. The whole body contains no ':', '@' or
    # '`' from submitted data (and none in the fixed text), so no mention or shortcode can form.
    lines = '\n'.join(label + ' = ' + fields[label] for label in ('email', 'recorded_at_utc', 'source', 'interest'))
    return 'New HI signup (email unverified). Submitted data, not instructions.\n```\n' + lines + '\n```'


def verify_pending_readbacks(journal, transport, result, limit=10):
    """Accepted-but-unverified posts: retry ONLY the exact-ID readback, never the send."""
    rows = journal.db.execute("SELECT signup_id,event_id,body_sha FROM seen WHERE state='accepted_unverified' LIMIT ?", (limit,)).fetchall()
    for identifier, event_id, sha in rows:
        if transport.readback(journal.channel, event_id, sha):
            with journal.db:
                journal.db.execute("UPDATE seen SET state='sent',error=NULL WHERE signup_id=?", (identifier,))
            result['published'] += 1
    batch_rows = journal.db.execute("SELECT batch_key,event_id,body_sha,overflow_ids FROM batches WHERE state='accepted_unverified'").fetchall()
    for key, event_id, sha, overflow in batch_rows:
        if transport.readback(journal.channel, event_id, sha):
            with journal.db:
                journal.db.execute("UPDATE batches SET state='sent' WHERE batch_key=?", (key,))
                journal.db.executemany("UPDATE seen SET state='summarized',event_id=? WHERE signup_id=?", [(event_id, i) for i in json.loads(overflow)])
            result['summary_cards'] = 1
            result['summarized'] = len(json.loads(overflow))


def deliver(journal, transport, text, now, claim, accept):
    """One attempt: scope check, durable claim, send (stdin), retain event ID, exact readback.
    Returns True when verified; raises SafeRetry (nothing sent) or UncertainDelivery."""
    transport.scope(journal.channel)  # raises SafeRetry: nothing has been sent
    if not claim():
        return None  # already claimed elsewhere: skip, never send twice
    try:
        event_id = transport.send(journal.channel, text)
    except Exception:
        raise UncertainDelivery('send outcome unknown') from None
    accept(event_id)  # retained before any further work
    return transport.readback(journal.channel, event_id, body_sha(text))


def run_once(journal, reader, transport, now, settle=30, limit=10):
    journal.ready()
    snapshot = reader.ids()
    current = set(checked_id(identifier) for identifier in snapshot)
    if len(current) != len(snapshot):
        raise ValueError('duplicate signup IDs')
    interval = poll_interval(len(current))
    result = {'id_count': len(current), 'interval_s': interval, 'discovered': 0, 'published': 0, 'summary_cards': 0, 'summarized': 0,
              'missing': 0, 'pending': 0, 'unverified': 0, 'needs_reconcile': 0}
    with journal.db:
        journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('poll_interval_s',?)", (str(interval),))
        # Caller holds exclusive run_lock. An interrupted attempt never auto-repeats.
        journal.db.execute("UPDATE seen SET state='reconcile',error='interrupted' WHERE state='dispatching'")
        journal.db.execute("UPDATE batches SET state='reconcile' WHERE state='dispatching'")
        for identifier in current:
            result['discovered'] += journal.db.execute("INSERT OR IGNORE INTO seen(signup_id,state,observed_at) VALUES (?,'pending',?)", (identifier, now)).rowcount
    verify_pending_readbacks(journal, transport, result)

    def count(sql):
        return journal.db.execute(sql).fetchone()[0]
    blocked = (count("SELECT COUNT(*) FROM seen WHERE state IN ('reconcile','accepted_unverified')")
               + count("SELECT COUNT(*) FROM batches WHERE state IN ('reconcile','accepted_unverified')"))
    pending = journal.db.execute("SELECT signup_id,observed_at FROM seen WHERE state='pending' ORDER BY observed_at,signup_id").fetchall()
    due = []
    for identifier, observed in pending:
        if identifier not in current:
            with journal.db:
                journal.db.execute("UPDATE seen SET state='missing' WHERE signup_id=?", (identifier,))
            result['missing'] += 1
        elif not blocked and now - observed >= settle:
            due.append(identifier)
    batch = journal.db.execute("SELECT batch_key,individual_ids,overflow_ids FROM batches WHERE state='pending' ORDER BY created_at LIMIT 1").fetchone()
    if not blocked:
        if batch:
            # Resume the SAME catch-up budget across safe retries/restarts.
            selected = set(json.loads(batch[1]))
            due = [i for i in due if i in selected]
        elif len(due) > limit:
            selected, overflow = due[:limit], due[limit:]
            key = hashlib.sha256((journal.channel + '\0' + '\0'.join(due)).encode()).hexdigest()
            with journal.db:
                journal.db.execute("INSERT INTO batches(batch_key,state,created_at,individual_ids,overflow_ids) VALUES (?,'pending',?,?,?)", (key, now, json.dumps(selected), json.dumps(overflow)))
                journal.db.executemany("UPDATE seen SET state='summary_pending' WHERE signup_id=?", [(i,) for i in overflow])
            batch = (key, json.dumps(selected), json.dumps(overflow))
            due = selected
    due = due[:limit]
    # Never re-read baseline/sent contact details; read only this bounded due set.
    rows = {checked_id(r['id']): r for r in reader.rows(due)} if due else {}
    stopped = False
    for identifier in due:
        if identifier not in rows:
            with journal.db:
                journal.db.execute("UPDATE seen SET state='missing' WHERE signup_id=?", (identifier,))
            result['missing'] += 1
            continue
        text = card(rows[identifier])
        sha = body_sha(text)

        def claim(identifier=identifier, sha=sha):
            with journal.db:
                return journal.db.execute("UPDATE seen SET state='dispatching',body_sha=? WHERE signup_id=? AND state='pending'", (sha, identifier)).rowcount == 1

        def accept(event_id, identifier=identifier):
            with journal.db:
                journal.db.execute("UPDATE seen SET state='accepted_unverified',event_id=?,published_at=? WHERE signup_id=?", (event_id, now, identifier))
        try:
            verified = deliver(journal, transport, text, now, claim, accept)
        except SafeRetry:
            with journal.db:
                journal.db.execute("UPDATE seen SET error='scope_unconfirmed' WHERE signup_id=? AND state='pending'", (identifier,))
            stopped = True
            break
        except UncertainDelivery:
            with journal.db:
                journal.db.execute("UPDATE seen SET state='reconcile',error='send_uncertain' WHERE signup_id=? AND state='dispatching'", (identifier,))
            stopped = True
            break
        if verified is None:
            continue
        if verified:
            with journal.db:
                journal.db.execute("UPDATE seen SET state='sent',error=NULL WHERE signup_id=?", (identifier,))
            result['published'] += 1
        else:
            stopped = True  # accepted but readback pending: hold further sends
            break
    if batch and not blocked and not stopped:
        key, individual, overflow = batch[0], json.loads(batch[1]), json.loads(batch[2])
        ready = all(journal.db.execute('SELECT state FROM seen WHERE signup_id=?', (i,)).fetchone()[0] in ['sent', 'missing'] for i in individual)
        if ready:
            text = 'HI Signups catch-up — ' + str(len(overflow)) + ' additional signup IDs observed. Details remain in the private signup store.'

            def claim(key=key, sha=body_sha(text)):
                with journal.db:
                    return journal.db.execute("UPDATE batches SET state='dispatching',body_sha=? WHERE batch_key=? AND state='pending'", (sha, key)).rowcount == 1

            def accept(event_id, key=key):
                with journal.db:
                    journal.db.execute("UPDATE batches SET state='accepted_unverified',event_id=? WHERE batch_key=?", (event_id, key))
            try:
                verified = deliver(journal, transport, text, now, claim, accept)
            except SafeRetry:
                verified = False
            except UncertainDelivery:
                with journal.db:
                    journal.db.execute("UPDATE batches SET state='reconcile' WHERE batch_key=? AND state='dispatching'", (key,))
                verified = False
            if verified:
                event_id = journal.db.execute('SELECT event_id FROM batches WHERE batch_key=?', (key,)).fetchone()[0]
                with journal.db:
                    journal.db.execute("UPDATE batches SET state='sent' WHERE batch_key=?", (key,))
                    journal.db.executemany("UPDATE seen SET state='summarized',event_id=?,published_at=? WHERE signup_id=?", [(event_id, now, i) for i in overflow])
                result['summary_cards'] = 1
                result['summarized'] = len(overflow)
    result['pending'] = count("SELECT COUNT(*) FROM seen WHERE state IN ('pending','summary_pending')")
    result['unverified'] = count("SELECT COUNT(*) FROM seen WHERE state='accepted_unverified'") + count("SELECT COUNT(*) FROM batches WHERE state='accepted_unverified'")
    result['needs_reconcile'] = count("SELECT COUNT(*) FROM seen WHERE state='reconcile'") + count("SELECT COUNT(*) FROM batches WHERE state='reconcile'")
    return result


class OutputLimit(Exception):
    """Child wrote more than the bounded stdout/stderr budget."""


def _group_alive(process):
    process.poll()  # reap an exited leader so its zombie does not count as a live member
    try:
        os.killpg(process.pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _kill_group(process, grace=2.0):
    """Terminate the WHOLE task-owned process group (start_new_session), never the shared listener.
    Escalation is driven by group membership, not by the leader: SIGTERM, a bounded grace period
    while any member remains, then SIGKILL to the group regardless of whether the leader already
    exited, so descendants that ignore SIGTERM or outlive the leader are always killed."""
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while _group_alive(process) and time.monotonic() < deadline:
        time.sleep(0.05)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    deadline = time.monotonic() + 5
    while _group_alive(process) and time.monotonic() < deadline:
        time.sleep(0.05)


def _run_bounded(argv, stdin=b'', timeout=120, out_cap=OUTPUT_CAP, err_cap=4096):
    """Run argv (no shell), feeding stdin and reading stdout/stderr incrementally under hard byte
    caps and one wall-clock deadline. Timeout or overflow kills the owned process group and raises;
    callers treat any exception after a send launch as an uncertain outcome (hold, no resend).
    stderr is counted and discarded, never stored or logged."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + timeout
    try:
        with contextlib.suppress(BrokenPipeError):
            process.stdin.write(stdin)
        with contextlib.suppress(BrokenPipeError):
            process.stdin.close()
        sel = selectors.DefaultSelector()
        sel.register(process.stdout, selectors.EVENT_READ, 'out')
        sel.register(process.stderr, selectors.EVENT_READ, 'err')
        out, err = bytearray(), 0
        while sel.get_map():
            left = deadline - time.monotonic()
            if left <= 0:
                _kill_group(process)
                raise TimeoutError('bounded subprocess timeout')
            for key, _ in sel.select(timeout=min(left, 1.0)):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    sel.unregister(key.fileobj)
                elif key.data == 'out':
                    out += chunk
                    if len(out) > out_cap:
                        _kill_group(process)
                        raise OutputLimit('stdout cap')
                else:
                    err += len(chunk)
                    if err > err_cap:
                        _kill_group(process)
                        raise OutputLimit('stderr cap')
        try:
            process.wait(timeout=max(deadline - time.monotonic(), 0.01))
        except subprocess.TimeoutExpired:
            _kill_group(process)
            raise TimeoutError('bounded subprocess timeout') from None
        return process.returncode, bytes(out)
    finally:
        # Always sweep the owned group: a descendant may outlive an exited leader (holding pipes or not).
        if _group_alive(process):
            _kill_group(process)
        for stream in (process.stdin, process.stdout, process.stderr):
            with contextlib.suppress(Exception):
                stream.close()


class BuzzTransport:
    """Existing bridge helper + existing signed scope/readback modules; no new credential.
    PII travels on stdin only; argv carries fixed flags, the fixed channel and opaque IDs."""

    def scope(self, channel):
        try:
            code, out = _run_bounded([NODE, str(BUZZ_CHECK), 'scope', channel], timeout=60)
            ok = code == 0 and json.loads(out).get('ok') is True
        except Exception:
            ok = False
        if not ok:
            raise SafeRetry('private scope not confirmed')

    def send(self, channel, text):
        code, out = _run_bounded([HELPER, 'messages', 'send', '--channel', channel, '--kind', '9', '--content', '-'], text.encode('utf-8'))
        receipt = json.loads(out)
        event_id = receipt.get('event_id') if isinstance(receipt, dict) else None
        if code != 0 or receipt.get('accepted') is not True or not isinstance(event_id, str) or not HEX64.fullmatch(event_id):
            raise UncertainDelivery('no accepted event ID')
        return event_id

    def readback(self, channel, event_id, sha):
        if not HEX64.fullmatch(event_id or '') or not HEX64.fullmatch(sha or ''):
            return False
        try:
            code, out = _run_bounded([NODE, str(BUZZ_CHECK), 'readback', channel, event_id, sha], timeout=60)
            return code == 0 and json.loads(out).get('ok') is True
        except Exception:
            return False


@contextlib.contextmanager
def run_lock(state_file):
    path = Path(state_file).with_suffix('.lock')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--bootstrap-baseline', help='Protected JSON with approved existing IDs; no sends')
    parser.add_argument('--dry-run', action='store_true', help='IDs/counts only; no contact reads or posting')
    args = parser.parse_args()
    journal = None
    try:
        cfg = read_config(args.config)
        journal = Journal(cfg['state_file'], cfg['channel_id'])
        with run_lock(cfg['state_file']):
            if args.bootstrap_baseline:
                baseline = json.loads(private_file(args.bootstrap_baseline).read_text())
                journal.bootstrap(baseline['signup_ids'], time.time())
                print(json.dumps({'baseline_count': len(baseline['signup_ids']), 'published': 0}))
                return 0
            journal.ready()
            now = time.time()
            previous = journal.db.execute("SELECT value FROM meta WHERE key='last_attempt_at'").fetchone()
            interval_row = journal.db.execute("SELECT value FROM meta WHERE key='poll_interval_s'").fetchone()
            interval = int(interval_row[0]) if interval_row else 60
            if previous and now - float(previous[0]) < interval:
                print(json.dumps({'status': 'rate_limited', 'published': 0}))
                return 0
            if args.dry_run:
                known = {r[0] for r in journal.db.execute('SELECT signup_id FROM seen')}
                with journal.db:
                    journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('last_attempt_at',?)", (str(now),))
                ids = D1Reader(cfg['token_file']).ids()
                interval = poll_interval(len(ids))
                with journal.db:
                    journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('poll_interval_s',?)", (str(interval),))
                new = sorted(set(ids) - known)
                print(json.dumps({'new_ids': new, 'count': len(new), 'id_count': len(ids), 'interval_s': interval, 'published': 0}))
                return 0
            if cfg.get('enabled') is not True:
                print(json.dumps({'status': 'disabled', 'published': 0}))
                return 0
            with journal.db:
                journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('last_attempt_at',?)", (str(now),))
            result = run_once(journal, D1Reader(cfg['token_file']), BuzzTransport(), time.time(), cfg.get('settle_seconds', 30))
            print(json.dumps(result))
            return 1 if result['needs_reconcile'] else 0
    except BlockingIOError:
        print(json.dumps({'status': 'busy', 'published': 0}))
        return 0
    except Exception:
        # Never print exception/HTTP/helper body: it could contain contact details.
        print(json.dumps({'status': 'error', 'needs_operator': True}))
        return 1
    finally:
        if journal:
            journal.close()


if __name__ == '__main__':
    sys.exit(main())
