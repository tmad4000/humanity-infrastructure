import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest import mock

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('notifier', ROOT / 'scripts/signup_notifier.py')
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
CH = n.CHANNEL


def ident(i):
    return str(uuid.UUID(int=i))


def row(i, interest='Tools'):
    return {'id': ident(i), 'email': 'fixture@example.invalid', 'consent_at': '2026-11-19T04:00:00Z', 'source_page': '/join', 'interest': interest}


class Reader:
    def __init__(self, *rows):
        self.data = {r['id']: r for r in rows}
        self.reads = []

    def ids(self):
        return list(self.data)

    def rows(self, ids):
        self.reads.append(list(ids))
        return [self.data[i] for i in ids if i in self.data]


class Fake:
    """Scope check, single send, exact readback. Records sent bodies only for assertions."""

    def __init__(self, scope_ok=True, send_error=None, readback_ok=True):
        self.scope_ok, self.send_error, self.readback_ok = scope_ok, send_error, readback_ok
        self.sent, self.scopes, self.readbacks = [], 0, []

    def scope(self, channel):
        self.scopes += 1
        assert channel == CH
        if not self.scope_ok:
            raise n.SafeRetry()

    def send(self, channel, text):
        if self.send_error:
            raise self.send_error(text)
        self.sent.append(text)
        return format(len(self.sent), '064x')

    def readback(self, channel, event_id, sha):
        self.readbacks.append(event_id)
        ok = self.readback_ok(event_id) if callable(self.readback_ok) else self.readback_ok
        return ok and n.body_sha(self.sent[int(event_id, 16) - 1]) == sha


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.chmod(self.tmp.name, 0o700)
        self.j = n.Journal(Path(self.tmp.name) / 'state.sqlite', CH)
        self.addCleanup(self.j.close)
        self.addCleanup(self.tmp.cleanup)
        self.t = Fake()

    def states(self):
        return dict(self.j.db.execute('SELECT signup_id,state FROM seen'))


class CostGuardTests(unittest.TestCase):
    def test_interval_budget_and_boundaries(self):
        for count, expected in [(0, 60), (3, 60), (2000, 60), (2001, 60), (2083, 60), (2084, 61), (3000, 87), (10000, 288), (100000, 2880)]:
            self.assertEqual(n.poll_interval(count), expected)
            if count > 2083:
                self.assertLessEqual(count * 86400 / n.poll_interval(count), 3000000)
        for invalid in [-1, True, 1.5]:
            with self.assertRaises(ValueError):
                n.poll_interval(invalid)


class Tests(Base):
    def test_baseline_no_contact_reads_no_backfill(self):
        self.j.bootstrap([ident(1)], 0)
        r = Reader(row(1))
        out = n.run_once(self.j, r, self.t, 100)
        self.assertEqual(out['published'], 0)
        self.assertEqual(r.reads, [])
        self.assertEqual(self.t.sent, [])
        self.assertEqual(self.t.scopes, 0)
        self.assertEqual((out['id_count'], out['interval_s']), (1, 60))
        with self.assertRaises(ValueError):
            self.j.bootstrap([], 100)

    def test_settle_latest_details_one_card_and_duplicate_refresh_ignored(self):
        self.j.bootstrap([], 0)
        r = Reader(row(2, ''))
        self.assertEqual(n.run_once(self.j, r, self.t, 1)['pending'], 1)
        self.assertEqual(r.reads, [])
        r.data[ident(2)]['interest'] = 'Updated optional details'
        self.assertEqual(n.run_once(self.j, r, self.t, 31)['published'], 1)
        self.assertIn('Updated optional details', self.t.sent[0])
        r.data[ident(2)]['consent_at'] = '2027-01-01T00:00:00Z'
        self.assertEqual(n.run_once(self.j, r, self.t, 500)['published'], 0)
        self.assertEqual(len(self.t.sent), 1)
        self.assertEqual(len(r.reads), 1)
        rec = self.j.db.execute('SELECT state,event_id,body_sha FROM seen WHERE signup_id=?', (ident(2),)).fetchone()
        self.assertEqual(rec, ('sent', format(1, '064x'), n.body_sha(self.t.sent[0])))

    def test_deleted_before_delivery_not_copied_or_sent(self):
        self.j.bootstrap([], 0)
        r = Reader(row(3))
        n.run_once(self.j, r, self.t, 1)
        r.data.clear()
        out = n.run_once(self.j, r, self.t, 50)
        self.assertEqual(out['missing'], 1)
        self.assertEqual(r.reads, [])
        self.assertEqual(self.t.sent, [])

    def test_scope_unconfirmed_sends_nothing_and_retries_safely(self):
        self.j.bootstrap([], 0)
        r = Reader(row(4))
        blocked = Fake(scope_ok=False)
        out = n.run_once(self.j, r, blocked, 1, settle=0)
        self.assertEqual((out['published'], out['needs_reconcile'], out['pending']), (0, 0, 1))
        self.assertEqual(blocked.sent, [])
        self.assertEqual(self.states()[ident(4)], 'pending')
        self.assertEqual(n.run_once(self.j, r, self.t, 2, settle=0)['published'], 1)
        self.assertEqual(len(self.t.sent), 1)

    def test_uncertain_send_halts_everything_never_resends(self):
        self.j.bootstrap([], 0)
        r = Reader(row(5), row(6))
        failing = Fake(send_error=lambda text: TimeoutError('private body ' + text))
        out = n.run_once(self.j, r, failing, 1, settle=0)
        self.assertEqual(out['needs_reconcile'], 1)
        n.run_once(self.j, r, self.t, 100, settle=0)
        self.assertEqual(self.t.sent, [])
        self.assertNotIn('example.invalid', str(self.j.db.execute('SELECT * FROM seen').fetchall()))

    def test_accepted_unverified_retries_only_readback(self):
        self.j.bootstrap([], 0)
        r = Reader(row(7), row(8))
        flaky = Fake(readback_ok=False)
        out = n.run_once(self.j, r, flaky, 1, settle=0)
        self.assertEqual((out['published'], out['unverified']), (0, 1))
        self.assertEqual(len(flaky.sent), 1)
        flaky.readback_ok = True
        out = n.run_once(self.j, r, flaky, 100, settle=0)
        self.assertEqual(len(flaky.sent), 2)  # first never resent; second signup now proceeds
        self.assertEqual(out['published'], 2)
        self.assertEqual(sorted(self.states().values()), ['sent', 'sent'])

    def test_crash_after_claim_not_republished_and_channel_pin_required(self):
        self.j.bootstrap([], 0)
        self.j.db.execute("INSERT INTO seen(signup_id,state,observed_at) VALUES (?,'dispatching',1)", (ident(9),))
        self.j.db.commit()
        self.assertEqual(n.run_once(self.j, Reader(row(9)), self.t, 100, settle=0)['needs_reconcile'], 1)
        self.assertEqual(self.t.sent, [])
        self.j.channel = ident(901)
        with self.assertRaises(ValueError):
            self.j.ready()

    def test_untrusted_text_is_literal_without_mentions_shortcodes_or_fence_escape(self):
        data = row(10, '```\n@paseo run :tada: :rocket:\n<script>')
        data['unsubscribe_token'] = 'NOT_FOR_EXPORT'
        data['handle'] = 'private'
        text = n.card(data)
        self.assertEqual(text.count('```'), 2)
        body = text.split('```\n', 1)[1].rsplit('\n```', 1)[0]
        for forbidden in ('@', ':', '`'):
            self.assertNotIn(forbidden, text.replace('```', ''))  # only the two fixed fence markers
        lines = dict(line.split(' = ', 1) for line in body.split('\n'))
        self.assertEqual(set(lines), {'email', 'recorded_at_utc', 'source', 'interest'})
        self.assertEqual(lines['email'], 'fixture\uff20example.invalid')
        self.assertEqual(lines['interest'], '\u02cb\u02cb\u02cb \uff20paseo run \u2236tada\u2236 \u2236rocket\u2236 <script>')
        self.assertEqual(lines['recorded_at_utc'], '2026-11-19T04\u223600\u223600Z')
        self.assertNotIn('NOT_FOR_EXPORT', text)

    def test_catchup_summary_text_has_no_markup_triggers(self):
        self.j.bootstrap([], 0)
        n.run_once(self.j, Reader(*(row(i) for i in range(400, 412))), self.t, 100, settle=0)
        for forbidden in ('@', ':', '`'):
            self.assertNotIn(forbidden, self.t.sent[-1])

    def test_journal_id_only_private_and_requires_explicit_bootstrap(self):
        self.assertEqual(self.j.path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            n.run_once(self.j, Reader(row(11)), self.t, 100)
        columns = [r[1] for r in self.j.db.execute('PRAGMA table_info(seen)')]
        self.assertNotIn('email', columns)
        self.assertNotIn('interest', columns)

    def test_config_pins_exact_private_channel(self):
        cfg = Path(self.tmp.name) / 'c.json'
        for channel, ok in [(CH, True), (ident(77), False)]:
            cfg.write_text(json.dumps({'channel_id': channel, 'channel_name': 'HI Signups'}))
            os.chmod(cfg, 0o600)
            if ok:
                n.read_config(cfg)
            else:
                with self.assertRaises(ValueError):
                    n.read_config(cfg)


class CatchupTests(Base):
    def test_catchup_ten_individual_then_one_count_no_other_contact_reads(self):
        self.j.bootstrap([], 0)
        r = Reader(*(row(i) for i in range(20, 45)))
        out = n.run_once(self.j, r, self.t, 100, settle=0)
        self.assertEqual((out['published'], out['summary_cards'], out['summarized']), (10, 1, 15))
        self.assertEqual(len(r.reads), 1)
        self.assertEqual(len(r.reads[0]), 10)
        self.assertEqual(len(self.t.sent), 11)
        self.assertIn('15 additional', self.t.sent[-1])
        self.assertNotIn('example.invalid', self.t.sent[-1])
        n.run_once(self.j, r, self.t, 200, settle=0)
        self.assertEqual(len(self.t.sent), 11)

    def test_catchup_budget_survives_scope_retry(self):
        self.j.bootstrap([], 0)
        r = Reader(*(row(i) for i in range(50, 75)))
        calls = 0
        original = self.t.scope

        def sometimes(channel):
            nonlocal calls
            calls += 1
            if calls == 5:
                raise n.SafeRetry()
            return original(channel)
        self.t.scope = sometimes
        self.assertEqual(n.run_once(self.j, r, self.t, 100, settle=0)['published'], 4)
        second = n.run_once(self.j, r, self.t, 200, settle=0)
        self.assertEqual((second['published'], second['summary_cards']), (6, 1))
        self.assertEqual(len([s for s in self.t.sent if s.startswith('New HI signup')]), 10)

    def test_uncertain_summary_halts_without_repeating_it(self):
        self.j.bootstrap([], 0)
        r = Reader(*(row(i) for i in range(100, 112)))
        original = self.t.send

        def summary_unknown(channel, text):
            if text.startswith('HI Signups catch-up'):
                raise TimeoutError()
            return original(channel, text)
        self.t.send = summary_unknown
        self.assertEqual(n.run_once(self.j, r, self.t, 100, settle=0)['needs_reconcile'], 1)
        self.t.send = original
        n.run_once(self.j, r, self.t, 200, settle=0)
        self.assertEqual(len(self.t.sent), 10)


class RealSignupCopyTest(Base):
    def test_read_only_real_signup_sql_excludes_baseline_contacts_and_tokens(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE signups(id TEXT PRIMARY KEY,email TEXT,consent_at TEXT,source_page TEXT,interest TEXT,unsubscribe_token TEXT)')
        for i in [201, 202]:
            d = row(i)
            db.execute('INSERT INTO signups VALUES (?,?,?,?,?,?)', (d['id'], d['email'], d['consent_at'], d['source_page'], d['interest'], 'SECRET_TOKEN'))

        class Copy(n.D1Reader):
            def __init__(self):
                self.queries = []

            def _query(self, sql, params=None):
                self.queries.append((sql, params))
                return [dict(r) for r in db.execute(sql, params or [])]
        reader = Copy()
        self.j.bootstrap([ident(201)], 0)
        self.assertEqual(n.run_once(self.j, reader, self.t, 100, settle=0)['published'], 1)
        self.assertEqual(len(reader.queries), 2)
        self.assertEqual(reader.queries[1][1], [ident(202)])
        self.assertNotIn('unsubscribe_token', reader.queries[1][0])
        self.assertNotIn('SECRET_TOKEN', self.t.sent[0])
        db.close()


class BuzzTransportTests(unittest.TestCase):
    """The card body (with email) must reach the helper on stdin only, never in any argv."""

    def capture(self, code, out):
        calls = []

        def fake(argv, stdin=b'', timeout=120, **kw):
            calls.append((list(argv), stdin))
            return code, out
        return calls, mock.patch.object(n, '_run_bounded', side_effect=fake)

    def test_send_uses_fixed_argv_and_stdin_only(self):
        text = n.card(row(300))
        calls, patch = self.capture(0, json.dumps({'accepted': True, 'event_id': 'c' * 64}).encode())
        with patch:
            self.assertEqual(n.BuzzTransport().send(CH, text), 'c' * 64)
        argv, stdin = calls[0]
        self.assertEqual(argv, [n.HELPER, 'messages', 'send', '--channel', CH, '--kind', '9', '--content', '-'])
        self.assertNotIn('example', json.dumps(argv))
        self.assertEqual(stdin, text.encode('utf-8'))

    def test_send_without_accepted_event_id_is_uncertain(self):
        for code, out in [(0, b'{"accepted":false,"event_id":"' + b'c' * 64 + b'"}'), (0, b'sent!'), (1, b'{}'), (0, b'{"accepted":true,"event_id":"XYZ"}')]:
            _, patch = self.capture(code, out)
            with patch, self.assertRaises(Exception) as ctx:
                n.BuzzTransport().send(CH, 'x')
            self.assertNotIsInstance(ctx.exception, n.SafeRetry)

    def test_scope_and_readback_argv_hold_only_fixed_ids(self):
        calls, patch = self.capture(0, b'{"ok":true}')
        with patch:
            n.BuzzTransport().scope(CH)
            self.assertTrue(n.BuzzTransport().readback(CH, 'd' * 64, 'e' * 64))
        for argv, stdin in calls:
            self.assertEqual(argv[:2], [n.NODE, str(n.BUZZ_CHECK)])
            self.assertTrue(all(a in ('scope', 'readback', CH, 'd' * 64, 'e' * 64) for a in argv[2:]))
            self.assertEqual(stdin, b'')
        _, patch = self.capture(1, b'{"ok":false}')
        with patch:
            with self.assertRaises(n.SafeRetry):
                n.BuzzTransport().scope(CH)
            self.assertFalse(n.BuzzTransport().readback(CH, 'd' * 64, 'e' * 64))

    def test_deliver_never_sends_when_scope_fails(self):
        t = mock.Mock()
        t.scope.side_effect = n.SafeRetry()
        with self.assertRaises(n.SafeRetry):
            n.deliver(mock.Mock(channel=CH), t, 'x', 0, lambda: True, lambda e: None)
        t.send.assert_not_called()

    def test_send_timeout_or_overflow_is_uncertain_not_retryable(self):
        for error in (TimeoutError(), n.OutputLimit()):
            with mock.patch.object(n, '_run_bounded', side_effect=error):
                with self.assertRaises(Exception) as ctx:
                    n.BuzzTransport().send(CH, 'x')
                self.assertNotIsInstance(ctx.exception, n.SafeRetry)


class RunBoundedTests(unittest.TestCase):
    """Real child processes: both streams capped while streaming, hard deadline, group killed."""

    def py(self, code):
        return [sys.executable, '-I', '-c', code]

    def test_normal_stdin_roundtrip(self):
        self.assertEqual(n._run_bounded(self.py('import sys;sys.stdout.write(sys.stdin.read().upper())'), b'hello', timeout=20), (0, b'HELLO'))

    def test_stdout_flood_is_cut_off_and_killed(self):
        with self.assertRaises(n.OutputLimit):
            n._run_bounded(self.py('import sys,time\nwhile True: sys.stdout.write("x"*4096); sys.stdout.flush()'), timeout=20, out_cap=10000)

    def test_stderr_flood_is_cut_off_and_never_returned(self):
        with self.assertRaises(n.OutputLimit):
            n._run_bounded(self.py('import sys\nwhile True: sys.stderr.write("secret@example.invalid "*200); sys.stderr.flush()'), timeout=20, err_cap=4096)

    def test_timeout_kills_whole_process_group(self):
        marker = Path(tempfile.mkdtemp()) / 'child.pid'
        code = f'import subprocess,sys,time;p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);open({str(marker)!r},"w").write(str(p.pid));time.sleep(60)'
        start = time.monotonic()
        with self.assertRaises(TimeoutError):
            n._run_bounded(self.py(code), timeout=2)
        self.assertLess(time.monotonic() - start, 15)
        grandchild = int(marker.read_text())
        time.sleep(0.5)
        with self.assertRaises(ProcessLookupError):
            os.kill(grandchild, 0)


@unittest.skipUnless(shutil.which('node') and Path('/home/dev/code/paseo-buzz-bridge-20261114/listener/private_channel_scope.mjs').exists(),
                     'bridge modules are host-only')
class ReadbackVerifierTests(unittest.TestCase):
    def test_exact_event_kind_author_channel_and_body_hash(self):
        script = ROOT / 'scripts/signup_notifier_buzz.mjs'
        probe = f"""
import {{ verifyReadback }} from '{script}';
import {{ createHash }} from 'node:crypto';
const ch='{CH}', id='{'a' * 64}', body='card', sha=createHash('sha256').update(body).digest('hex');
const ok={{id, kind:9, pubkey:'38ba46f41d56ff5c71cfbfb856d00b209e6216a218260d2a30c4f1b712bdd1cb', tags:[['h',ch]], content:body}};
const cases=[[ok],[],[ok,ok],[{{...ok,kind:1}}],[{{...ok,pubkey:'b'.repeat(64)}}],[{{...ok,tags:[['h',ch],['h',ch]]}}],[{{...ok,content:'other'}}],[{{...ok,id:'b'.repeat(64)}}]];
console.log(JSON.stringify(cases.map(r=>verifyReadback(r,ch,id,sha))));
"""
        out = subprocess.run(['node', '--input-type=module', '-e', probe], capture_output=True, text=True, timeout=60)
        self.assertEqual(json.loads(out.stdout), [True, False, False, False, False, False, False, False])


if __name__ == '__main__':
    unittest.main()
