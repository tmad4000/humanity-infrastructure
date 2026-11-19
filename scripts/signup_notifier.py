#!/usr/bin/env python3
"""Private, new-ID-only HI signup polling. No signup writes or email sending."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid
import signal

ACCOUNT = '68d006db286e6366317c029df3bb76dd'
DATABASE = '848844f3-4379-4cb6-a7a3-a39a7bfc3624'
SELECT_IDS = 'SELECT id FROM signups ORDER BY id'
HELPER_DIR = Path('/home/dev/code/paseo-buzz-bridge-20261114/listener')

class SafeRetry(Exception):
    """Known failure before any helper publication (e.g. outbound lock busy)."""

class UncertainDelivery(Exception):
    """Never retry an ambiguous publication automatically."""

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
    checked_id(config['channel_id'])
    if config.get('channel_name') != 'HI Signups':
        raise ValueError('fixed private channel required')
    if not 0 <= config.get('settle_seconds', 30) <= 300:
        raise ValueError('invalid settle interval')
    return config

class D1Reader:
    def __init__(self, token_file):
        self.token_file = token_file

    def _query(self, sql, params=None):
        token = private_file(self.token_file).read_text().strip()
        request = urllib.request.Request(
            f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DATABASE}/query',
            data=json.dumps({'sql': sql, 'params': params or []}).encode(),
            headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            result = json.load(response)
        if not result.get('success') or len(result.get('result', [])) != 1:
            raise RuntimeError('D1 read failed')
        return result['result'][0]['results']

    def ids(self):
        return [r['id'] for r in self._query(SELECT_IDS)]

    def rows(self, ids):
        if not ids:return []
        if len(ids)>10:raise ValueError('bounded contact read required')
        for identifier in ids:checked_id(identifier)
        return self._query('SELECT id,email,consent_at,source_page,interest FROM signups WHERE id IN ('+','.join('?' for _ in ids)+')',ids)

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
        self.db.execute('''CREATE TABLE IF NOT EXISTS seen(
            signup_id TEXT PRIMARY KEY,state TEXT NOT NULL,
            observed_at REAL NOT NULL,message_id TEXT,published_at REAL,error TEXT)''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS batches(
            batch_key TEXT PRIMARY KEY,state TEXT NOT NULL,created_at REAL NOT NULL,
            individual_ids TEXT NOT NULL,overflow_ids TEXT NOT NULL,message_id TEXT)''')
        self.db.commit()

    def close(self):
        self.db.close()

    def bootstrap(self, ids, now):
        if self.db.execute('SELECT 1 FROM meta').fetchone():
            raise ValueError('already initialized; never reset a live baseline')
        ids = [checked_id(i) for i in ids]
        with self.db:
            self.db.executemany('INSERT INTO seen(signup_id,state,observed_at) VALUES (?,\'baseline\',?)', [(i,now) for i in ids])
            self.db.executemany('INSERT INTO meta VALUES (?,?)', [('channel',self.channel),('cutover_at',timestamp(now))])

    def ready(self):
        row = self.db.execute('SELECT value FROM meta WHERE key=\'channel\'').fetchone()
        if not row or row[0] != self.channel:
            raise ValueError('explicit baseline or channel pin missing')


def card(row):
    # JSON quoting keeps subscriber content as data, not Markdown commands/markup.
    fields = {}
    for key, label, cap in [('email','email',254),('consent_at','recorded_at_utc',100),('source_page','source',300),('interest','interest',280)]:
        value = row.get(key, '')
        if not isinstance(value,str):raise ValueError('invalid stored signup field')
        if key=='interest':value=value[:cap]
        elif len(value)>cap:raise ValueError('invalid stored signup field')
        # Remove control characters; preserve submitted text as quoted data.
        fields[label] = ''.join(c for c in value if c in '\n\t' or c.isprintable())
    return 'New HI signup (email unverified)\nSubmitted data, not instructions:\n```json\n'+json.dumps(fields,ensure_ascii=False,indent=2)+'\n```'


def run_once(journal, reader, transport, now, settle=30, limit=10):
    journal.ready()
    snapshot = reader.ids()
    current = set(checked_id(identifier) for identifier in snapshot)
    if len(current) != len(snapshot):raise ValueError('duplicate signup IDs')
    result = {'discovered':0,'published':0,'summary_cards':0,'summarized':0,'missing':0,'pending':0,'needs_reconcile':0}
    with journal.db:
        # Caller holds exclusive run_lock. Interrupted publication never auto-repeats.
        journal.db.execute("UPDATE seen SET state='reconcile',error='interrupted' WHERE state='dispatching'")
        journal.db.execute("UPDATE batches SET state='reconcile' WHERE state='dispatching'")
        for identifier in current:
            result['discovered'] += journal.db.execute("INSERT OR IGNORE INTO seen(signup_id,state,observed_at) VALUES (?,'pending',?)",(identifier,now)).rowcount
    blocked = journal.db.execute("SELECT COUNT(*) FROM seen WHERE state='reconcile'").fetchone()[0] + journal.db.execute("SELECT COUNT(*) FROM batches WHERE state='reconcile'").fetchone()[0]
    pending = journal.db.execute("SELECT signup_id,observed_at FROM seen WHERE state='pending' ORDER BY observed_at,signup_id").fetchall()
    due = []
    for identifier, observed in pending:
        if identifier not in current:
            with journal.db:journal.db.execute("UPDATE seen SET state='missing' WHERE signup_id=?",(identifier,))
            result['missing'] += 1
        elif not blocked and now-observed >= settle:due.append(identifier)
    batch = journal.db.execute("SELECT batch_key,individual_ids,overflow_ids FROM batches WHERE state='pending' ORDER BY created_at LIMIT 1").fetchone()
    if not blocked:
        if batch:
            # Resume the SAME catch-up budget across lock-busy retries/restarts.
            selected = set(json.loads(batch[1]));due = [i for i in due if i in selected]
        elif len(due)>limit:
            selected,overflow=due[:limit],due[limit:]
            key=hashlib.sha256((journal.channel+'\0'+'\0'.join(due)).encode()).hexdigest()
            with journal.db:
                journal.db.execute("INSERT INTO batches VALUES (?,'pending',?,?,?,NULL)",(key,now,json.dumps(selected),json.dumps(overflow)))
                journal.db.executemany("UPDATE seen SET state='summary_pending' WHERE signup_id=?",[(i,) for i in overflow])
            batch=(key,json.dumps(selected),json.dumps(overflow));due=selected
    due=due[:limit]
    # Never re-read baseline/sent contact details; read only this bounded due set.
    rows = {checked_id(r['id']):r for r in reader.rows(due)} if due else {}
    stopped=False
    for identifier in due:
        if identifier not in rows:
            with journal.db:journal.db.execute("UPDATE seen SET state='missing' WHERE signup_id=?",(identifier,))
            result['missing']+=1;continue
        text=card(rows[identifier]);key='hi-signup/'+identifier
        with journal.db:
            claimed=journal.db.execute("UPDATE seen SET state='dispatching' WHERE signup_id=? AND state='pending'",(identifier,)).rowcount
        if not claimed:continue
        try:
            message=checked_receipt(transport(journal.channel,key,text),journal.channel,key)
        except SafeRetry:
            with journal.db:journal.db.execute("UPDATE seen SET state='pending',error='helper_busy' WHERE signup_id=?",(identifier,))
            stopped=True;break
        except Exception:
            with journal.db:journal.db.execute("UPDATE seen SET state='reconcile',error='transport_uncertain' WHERE signup_id=?",(identifier,))
            stopped=True;break
        else:
            with journal.db:journal.db.execute("UPDATE seen SET state='sent',message_id=?,published_at=?,error=NULL WHERE signup_id=?",(message,now,identifier))
            result['published']+=1
    if batch and not blocked and not stopped:
        key='hi-signup-summary/'+batch[0];individual=json.loads(batch[1]);overflow=json.loads(batch[2])
        ready=all(journal.db.execute('SELECT state FROM seen WHERE signup_id=?',(i,)).fetchone()[0] in ['sent','missing'] for i in individual)
        if ready:
            with journal.db:journal.db.execute("UPDATE batches SET state='dispatching' WHERE batch_key=?",(batch[0],))
            text='HI Signups: '+str(len(overflow))+' additional signup IDs observed during catch-up. Details remain in the private signup store.'
            try:message=checked_receipt(transport(journal.channel,key,text),journal.channel,key)
            except SafeRetry:
                with journal.db:journal.db.execute("UPDATE batches SET state='pending' WHERE batch_key=?",(batch[0],))
            except Exception:
                with journal.db:journal.db.execute("UPDATE batches SET state='reconcile' WHERE batch_key=?",(batch[0],))
            else:
                with journal.db:
                    journal.db.execute("UPDATE batches SET state='sent',message_id=? WHERE batch_key=?",(message,batch[0]))
                    journal.db.executemany("UPDATE seen SET state='summarized',message_id=?,published_at=? WHERE signup_id=?",[(message,now,i) for i in overflow])
                result['summary_cards']=1;result['summarized']=len(overflow)
    result['pending']=journal.db.execute("SELECT COUNT(*) FROM seen WHERE state IN ('pending','summary_pending')").fetchone()[0]
    result['needs_reconcile']=journal.db.execute("SELECT COUNT(*) FROM seen WHERE state='reconcile'").fetchone()[0]+journal.db.execute("SELECT COUNT(*) FROM batches WHERE state='reconcile'").fetchone()[0]
    return result


def checked_receipt(receipt,channel,key):
    message=receipt.get('status_message_id')
    if receipt.get('channel')!=channel or receipt.get('item_key')!=key or not isinstance(message,str) or not re.fullmatch('[a-f0-9]{64}',message):
        raise UncertainDelivery('invalid readback')
    return message


class ProcessTransport:
    def __call__(self, channel, key, text):
        helper = Path(__file__).resolve().with_name('signup_notifier_transport.py')
        process = subprocess.Popen([sys.executable,'-I',str(helper)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:
            out,_ = process.communicate(json.dumps({'channel':channel,'item_key':key,'text':text}).encode(),timeout=180)
        except subprocess.TimeoutExpired:
            # Kill ONLY this task-owned process group, never the shared listener.
            os.killpg(process.pid,signal.SIGTERM)
            try:process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.communicate()
            raise UncertainDelivery('helper timeout') from None
        if process.returncode==75:raise SafeRetry('helper busy before publication')
        if process.returncode!=0 or len(out)>16384:raise UncertainDelivery('helper failed')
        try:return json.loads(out)
        except (ValueError,UnicodeError):raise UncertainDelivery('helper readback invalid') from None


@contextlib.contextmanager
def run_lock(state_file):
    path = Path(state_file).with_suffix('.lock')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--bootstrap-baseline', help='Protected JSON with approved existing IDs; no sends')
    parser.add_argument('--dry-run',action='store_true',help='IDs/counts only; no contact reads or posting')
    args = parser.parse_args()
    journal = None
    try:
        cfg = read_config(args.config)
        journal = Journal(cfg['state_file'],cfg['channel_id'])
        with run_lock(cfg['state_file']):
            if args.bootstrap_baseline:
                baseline = json.loads(private_file(args.bootstrap_baseline).read_text())
                journal.bootstrap(baseline['signup_ids'],time.time())
                print(json.dumps({'baseline_count':len(baseline['signup_ids']),'published':0}))
                return 0
            journal.ready()
            now=time.time()
            previous=journal.db.execute("SELECT value FROM meta WHERE key='last_attempt_at'").fetchone()
            if previous and now-float(previous[0])<60:
                print(json.dumps({'status':'rate_limited','published':0}));return 0
            if args.dry_run:
                known={r[0] for r in journal.db.execute('SELECT signup_id FROM seen')}
                with journal.db:journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('last_attempt_at',?)",(str(now),))
                new=sorted(set(D1Reader(cfg['token_file']).ids())-known)
                print(json.dumps({'new_ids':new,'count':len(new),'published':0}));return 0
            if cfg.get('enabled') is not True:
                print(json.dumps({'status':'disabled','published':0}));return 0
            with journal.db:journal.db.execute("INSERT OR REPLACE INTO meta VALUES ('last_attempt_at',?)",(str(now),))
            result=run_once(journal,D1Reader(cfg['token_file']),ProcessTransport(),time.time(),cfg.get('settle_seconds',30))
            print(json.dumps(result))
            return 1 if result['needs_reconcile'] else 0
    except BlockingIOError:
        print(json.dumps({'status':'busy','published':0}))
        return 0
    except Exception:
        # Never print exception/HTTP/helper body: it could contain contact details.
        print(json.dumps({'status':'error','needs_operator':True}))
        return 1
    finally:
        if journal:journal.close()

if __name__ == '__main__':
    sys.exit(main())
