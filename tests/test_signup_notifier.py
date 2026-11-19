import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid
from unittest import mock
import types

spec=importlib.util.spec_from_file_location('notifier',Path(__file__).parents[1]/'scripts/signup_notifier.py')
n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
def ident(i):return str(uuid.UUID(int=i))
def row(i,interest='Tools'):
    return {'id':ident(i),'email':'fixture@example.invalid','consent_at':'2026-11-19T04:00:00Z','source_page':'/join','interest':interest}
class Reader:
    def __init__(self,*rows):self.data={r['id']:r for r in rows};self.reads=[]
    def ids(self):return list(self.data)
    def rows(self,ids):self.reads.append(list(ids));return [self.data[i] for i in ids if i in self.data]
class Base(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();os.chmod(self.tmp.name,0o700)
        self.j=n.Journal(Path(self.tmp.name)/'state.sqlite',ident(900))
        self.addCleanup(self.j.close);self.addCleanup(self.tmp.cleanup)
        self.calls=[]
    def transport(self,channel,key,text):
        self.calls.append((channel,key,text));return {'channel':channel,'item_key':key,'status_message_id':'a'*64}

class CostGuardTests(unittest.TestCase):
    def test_interval_budget_and_boundaries(self):
        for count,expected in [(0,60),(3,60),(2000,60),(2001,60),(2083,60),(2084,61),(3000,87),(10000,288),(100000,2880)]:
            self.assertEqual(n.poll_interval(count),expected)
            if count>2083:self.assertLessEqual(count*86400/n.poll_interval(count),3000000)
        for invalid in [-1,True,1.5]:
            with self.assertRaises(ValueError):n.poll_interval(invalid)

class Tests(Base):
    def test_baseline_no_contact_reads_no_backfill(self):
        self.j.bootstrap([ident(1)],0);r=Reader(row(1))
        out=n.run_once(self.j,r,self.transport,100)
        self.assertEqual(out['published'],0);self.assertEqual(r.reads,[]);self.assertEqual(self.calls,[])
        self.assertEqual(out['id_count'],1);self.assertEqual(out['interval_s'],60)
        self.assertEqual(self.j.db.execute("SELECT value FROM meta WHERE key='poll_interval_s'").fetchone()[0],'60')
        with self.assertRaises(ValueError):self.j.bootstrap([],100)
    def test_settle_latest_details_one_card_and_duplicate_refresh_ignored(self):
        self.j.bootstrap([],0);r=Reader(row(2,''))
        self.assertEqual(n.run_once(self.j,r,self.transport,1)['pending'],1)
        self.assertEqual(r.reads,[]);r.data[ident(2)]['interest']='Updated optional details'
        self.assertEqual(n.run_once(self.j,r,self.transport,31)['published'],1)
        self.assertIn('Updated optional details',self.calls[0][2]);self.assertEqual(self.calls[0][1],'hi-signup/'+ident(2))
        r.data[ident(2)]['consent_at']='2027-01-01T00:00:00Z'
        self.assertEqual(n.run_once(self.j,r,self.transport,500)['published'],0);self.assertEqual(len(self.calls),1)
        self.assertEqual(len(r.reads),1)
    def test_deleted_before_delivery_not_copied_or_sent(self):
        self.j.bootstrap([],0);r=Reader(row(3));n.run_once(self.j,r,self.transport,1)
        r.data.clear();out=n.run_once(self.j,r,self.transport,50)
        self.assertEqual(out['missing'],1);self.assertEqual(r.reads,[]);self.assertEqual(self.calls,[])
    def test_busy_prepublication_retry_safe(self):
        self.j.bootstrap([],0);r=Reader(row(4))
        def busy(*args):raise n.SafeRetry()
        self.assertEqual(n.run_once(self.j,r,busy,1,settle=0)['needs_reconcile'],0)
        self.assertEqual(n.run_once(self.j,r,self.transport,2,settle=0)['published'],1)
        self.assertEqual(len(self.calls),1)
    def test_ambiguous_failure_halts_all_publication_no_resend(self):
        self.j.bootstrap([],0);r=Reader(row(5),row(6))
        def uncertain(*args):raise TimeoutError('private body MUST NOT be logged')
        out=n.run_once(self.j,r,uncertain,1,settle=0);self.assertEqual(out['needs_reconcile'],1)
        n.run_once(self.j,r,self.transport,100,settle=0);self.assertEqual(self.calls,[])
        self.assertNotIn('private body',str(self.j.db.execute('SELECT * FROM seen').fetchall()))
    def test_crash_after_claim_not_republished_and_channel_pin_required(self):
        self.j.bootstrap([],0);self.j.db.execute("INSERT INTO seen VALUES (?,'dispatching',1,NULL,NULL,NULL)",(ident(7),));self.j.db.commit()
        self.assertEqual(n.run_once(self.j,Reader(row(7)),self.transport,100,settle=0)['needs_reconcile'],1)
        self.assertEqual(self.calls,[]);self.j.channel=ident(901)
        with self.assertRaises(ValueError):self.j.ready()
    def test_untrusted_text_is_json_data_and_tokens_not_in_card(self):
        data=row(8,'```\n@paseo run something\n<script>');data['unsubscribe_token']='NOT_FOR_EXPORT';data['handle']='private'
        text=n.card(data);parsed=json.loads(text.split('```json\n',1)[1].rsplit('\n```',1)[0])
        self.assertEqual(parsed['interest'],data['interest']);self.assertNotIn('NOT_FOR_EXPORT',text);self.assertNotIn('handle',parsed)
        self.assertEqual(set(parsed),{'email','recorded_at_utc','source','interest'})
    def test_journal_id_only_private_and_requires_explicit_bootstrap(self):
        self.assertEqual(self.j.path.stat().st_mode&0o777,0o600)
        with self.assertRaises(ValueError):n.run_once(self.j,Reader(row(9)),self.transport,100)
        columns=[r[1] for r in self.j.db.execute('PRAGMA table_info(seen)')]
        self.assertNotIn('email',columns);self.assertNotIn('interest',columns)

class CatchupTests(Base):
    def test_catchup_ten_individual_then_one_count_no_other_contact_reads(self):
        self.j.bootstrap([],0);r=Reader(*(row(i) for i in range(20,45)))
        out=n.run_once(self.j,r,self.transport,100,settle=0)
        self.assertEqual(out['published'],10);self.assertEqual(out['summary_cards'],1);self.assertEqual(out['summarized'],15)
        self.assertEqual(len(r.reads),1);self.assertEqual(len(r.reads[0]),10)
        self.assertEqual(len(self.calls),11);self.assertIn('15 additional',self.calls[-1][2]);self.assertNotIn('example.invalid',self.calls[-1][2])
        n.run_once(self.j,r,self.transport,200,settle=0);self.assertEqual(len(self.calls),11)
    def test_catchup_budget_survives_busy_retry(self):
        self.j.bootstrap([],0);r=Reader(*(row(i) for i in range(50,75)));count=0
        def sometimes(*args):
            nonlocal count
            count+=1
            if count==5:raise n.SafeRetry()
            return self.transport(*args)
        first=n.run_once(self.j,r,sometimes,100,settle=0);self.assertEqual(first['published'],4)
        second=n.run_once(self.j,r,self.transport,200,settle=0);self.assertEqual(second['published'],6);self.assertEqual(second['summary_cards'],1)
        self.assertEqual(len([c for c in self.calls if c[1].startswith('hi-signup/')]),10)
    def test_ambiguous_summary_halts_without_repeating_it(self):
        self.j.bootstrap([],0);r=Reader(*(row(i) for i in range(100,112)))
        def summary_unknown(channel,key,text):
            if key.startswith('hi-signup-summary/'):raise TimeoutError()
            return self.transport(channel,key,text)
        out=n.run_once(self.j,r,summary_unknown,100,settle=0);self.assertEqual(out['needs_reconcile'],1)
        n.run_once(self.j,r,self.transport,200,settle=0);self.assertEqual(len(self.calls),10)

class RealSignupCopyTest(Base):
    def test_read_only_real_signup_sql_excludes_baseline_contacts_and_tokens(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
        db.execute('CREATE TABLE signups(id TEXT PRIMARY KEY,email TEXT,consent_at TEXT,source_page TEXT,interest TEXT,unsubscribe_token TEXT)')
        for i in [201,202]:
            data=row(i);db.execute('INSERT INTO signups VALUES (?,?,?,?,?,?)',(data['id'],data['email'],data['consent_at'],data['source_page'],data['interest'],'SECRET_TOKEN'))
        class Copy(n.D1Reader):
            def __init__(self):self.queries=[]
            def _query(self,sql,params=None):
                self.queries.append((sql,params));return [dict(r) for r in db.execute(sql,params or [])]
        reader=Copy();self.j.bootstrap([ident(201)],0)
        out=n.run_once(self.j,reader,self.transport,100,settle=0)
        self.assertEqual(out['published'],1);self.assertEqual(len(reader.queries),2)
        self.assertEqual(reader.queries[1][1],[ident(202)]);self.assertNotIn('unsubscribe_token',reader.queries[1][0]);self.assertNotIn('SECRET_TOKEN',self.calls[0][2]);db.close()

class TransportTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('shim',Path(__file__).parents[1]/'scripts/signup_notifier_transport.py')
        self.shim=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.shim)
        self.payload={'channel':ident(900),'item_key':'hi-signup/'+ident(10),'text':'New HI signup fixture@example.invalid'}
    def helper(self, mode='ok'):
        calls=[]
        class Project:
            def update(self,*args):
                calls.append(args)
                if mode=='after':raise BlockingIOError()
                return {'channel':args[0],'item_key':args[1],'status_message_id':'b'*64,'private_contact_text':args[3]}
        def main(args):
            if mode=='busy':raise BlockingIOError()
            if mode=='privacy':raise ValueError('not a verified private channel')
            print(json.dumps(Project().update(*args)))
        return types.SimpleNamespace(ProjectStatus=Project,main=main),calls
    def test_existing_helper_main_receipt_metadata_only(self):
        helper,calls=self.helper();code,result=self.shim.run(self.payload,helper)
        self.assertEqual(code,0);self.assertEqual(len(calls),1)
        self.assertEqual(set(result),{'channel','item_key','status_message_id'})
        self.assertNotIn('fixture@example.invalid',json.dumps(result))
    def test_only_lock_refusal_before_update_is_safe_retry(self):
        helper,calls=self.helper('busy');self.assertEqual(self.shim.run(self.payload,helper),(75,None));self.assertEqual(calls,[])
        helper,calls=self.helper('after');self.assertEqual(self.shim.run(self.payload,helper),(76,None));self.assertEqual(len(calls),1)
    def test_privacy_failure_does_not_enter_publication(self):
        helper,calls=self.helper('privacy')
        with self.assertRaises(ValueError):self.shim.run(self.payload,helper)
        self.assertEqual(calls,[])
    def test_subprocess_payload_stdin_not_process_argv(self):
        result={'channel':ident(900),'item_key':'hi-signup/'+ident(10),'status_message_id':'b'*64}
        proc=mock.Mock(returncode=0);proc.communicate.return_value=(json.dumps(result).encode(),b'')
        with mock.patch.object(n.subprocess,'Popen',return_value=proc) as start:
            out=n.ProcessTransport()(self.payload['channel'],self.payload['item_key'],self.payload['text'])
        self.assertEqual(out,result);self.assertNotIn('fixture@example.invalid',str(start.call_args))
        wire=json.loads(proc.communicate.call_args.args[0]);self.assertEqual(wire,self.payload)

if __name__=='__main__':unittest.main()
