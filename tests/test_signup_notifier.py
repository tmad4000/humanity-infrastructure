import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
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

    def test_untrusted_text_is_literal_json_without_mentions_or_fence_escape(self):
        data = row(10, '```\n@paseo run something\n<script>')
        data['unsubscribe_token'] = 'NOT_FOR_EXPORT'
        data['handle'] = 'private'
        text = n.card(data)
        body = text.split('```json\n', 1)[1].rsplit('\n```', 1)[0]
        self.assertEqual(text.count('```'), 2)
        self.assertNotIn('@', text)
        parsed = json.loads(body)
        self.assertEqual(parsed['interest'], data['interest'].replace('@', '＠'))
        self.assertEqual(parsed['email'], 'fixture＠example.invalid')
        self.assertNotIn('NOT_FOR_EXPORT', text)
        self.assertEqual(set(parsed), {'email', 'recorded_at_utc', 'source', 'interest'})

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
            if text.startswith('HI Signups:'):
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

    def popen(self, returncode, stdout):
        proc = mock.Mock(returncode=returncode, pid=12345)
        proc.communicate.return_value = (stdout, b'')
        return proc

    def test_send_uses_fixed_argv_and_stdin_only(self):
        text = n.card(row(300))
        receipt = json.dumps({'accepted': True, 'event_id': 'c' * 64}).encode()
        with mock.patch.object(n.subprocess, 'Popen', return_value=self.popen(0, receipt)) as start:
            self.assertEqual(n.BuzzTransport().send(CH, text), 'c' * 64)
        argv = start.call_args.args[0]
        self.assertEqual(argv, [n.HELPER, 'messages', 'send', '--channel', CH, '--kind', '9', '--content', '-'])
        self.assertNotIn('example.invalid', json.dumps(start.call_args_list, default=str))
        self.assertEqual(start.return_value.communicate.call_args.args[0], text.encode('utf-8'))

    def test_send_without_accepted_event_id_is_uncertain(self):
        for code, out in [(0, b'{"accepted":false,"event_id":"' + b'c' * 64 + b'"}'), (0, b'sent!'), (1, b'{}'), (0, b'{"accepted":true,"event_id":"XYZ"}')]:
            with mock.patch.object(n.subprocess, 'Popen', return_value=self.popen(code, out)):
                with self.assertRaises(Exception) as ctx:
                    n.BuzzTransport().send(CH, 'x')
                self.assertNotIsInstance(ctx.exception, n.SafeRetry)

    def test_scope_and_readback_argv_hold_only_fixed_ids(self):
        with mock.patch.object(n.subprocess, 'Popen', return_value=self.popen(0, b'{"ok":true}')) as start:
            n.BuzzTransport().scope(CH)
            self.assertTrue(n.BuzzTransport().readback(CH, 'd' * 64, 'e' * 64))
        for call in start.call_args_list:
            self.assertEqual(call.args[0][:2], [n.NODE, str(n.BUZZ_CHECK)])
            self.assertTrue(all(a in ('scope', 'readback', CH, 'd' * 64, 'e' * 64) for a in call.args[0][2:]))
        with mock.patch.object(n.subprocess, 'Popen', return_value=self.popen(1, b'{"ok":false}')):
            with self.assertRaises(n.SafeRetry):
                n.BuzzTransport().scope(CH)
            self.assertFalse(n.BuzzTransport().readback(CH, 'd' * 64, 'e' * 64))

    def test_deliver_never_sends_when_scope_fails(self):
        t = mock.Mock()
        t.scope.side_effect = n.SafeRetry()
        with self.assertRaises(n.SafeRetry):
            n.deliver(mock.Mock(channel=CH), t, 'x', 0, lambda: True, lambda e: None)
        t.send.assert_not_called()


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
