#!/usr/bin/env python3
"""Owner-only remote signal lifecycle. Deletes only this run's synthetic rows.
Three real POST attempts; the normal shared rate limit remains active.
"""
import csv, io, json, pathlib, sys, urllib.request, uuid, datetime
origin, environment = sys.argv[1:3]
assert environment in ('preview', 'production')
private=json.loads(pathlib.Path('/home/dev/.config/cloudflare/hi-signup-'+environment+'-secrets.json').read_text())
db=pathlib.Path('/tmp/hi-'+environment+'-db-id').read_text().strip()
headers={'Authorization':'Bearer '+pathlib.Path('/home/dev/.config/cloudflare/d1-api-token').read_text().strip(),'Content-Type':'application/json'}
marker='/owner-anonymous-'+uuid.uuid4().hex
email='signal-smoke-'+uuid.uuid4().hex+'@example.com';seed_ids=[uuid.uuid4().hex for _ in range(3)]
def sql(statement,params):
    result=json.load(urllib.request.urlopen(urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/68d006db286e6366317c029df3bb76dd/d1/database/'+db+'/query',headers=headers,data=json.dumps({'sql':statement,'params':params}).encode())))
    assert result['success'];return result['result'][0]['results']
def http(path,data=None,extra=None):
    return urllib.request.urlopen(urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,headers={'User-Agent':'HI-interest-smoke/1.0',**(extra or {})}))
try:
    anonymous={'item_key':'build-thunderpledge','kind':'want','website':'','source_page':marker}
    response=http('/api/interest',anonymous,{'Content-Type':'application/json','Origin':origin});assert response.status==200 and json.load(response)=={'ok':True}
    anon=sql('SELECT kind,email,handle,letter_opt_in FROM interest_signals WHERE source_page=?',[marker])[0]
    assert anon=={'kind':'want','email':'','handle':'','letter_opt_in':0}
    print(environment+': anonymous want stored without contact details or letter consent')
    data={'item_key':'bookshelves','kind':'building','email':email,'handle':'hi_test','letter_opt_in':True,'source_page':'/owner-smoke','utm':{'utm_source':'release-smoke'}}
    for payload in [data,{**data,'kind':'want'}]:
        response=http('/api/interest',payload,{'Content-Type':'application/json','Origin':origin});assert response.status==200;assert json.load(response)=={'ok':True}
    rows=sql('SELECT * FROM interest_signals WHERE email=?',[email]);assert len(rows)==1 and rows[0]['kind']=='building' and rows[0]['letter_opt_in']==1
    subscriber=sql('SELECT * FROM signups WHERE email=?',[email])[0];assert subscriber['public_opt_in']==0
    export=http('/admin/interest.csv',extra={'Authorization':'Bearer '+private['ADMIN_EXPORT_TOKEN']}).read().decode();assert any(row['email']==email and row['kind']=='building' for row in csv.DictReader(io.StringIO(export)))
    print(environment+': private builder stored once, duplicate uniform, explicit email consent and owner export verified')
    before=sql("SELECT COUNT(*) AS total FROM interest_signals WHERE item_key=? AND kind='want'",['signudoc'])[0]['total']
    for identifier in seed_ids:
        sql('INSERT INTO interest_signals (id,item_key,kind,ip_hash,day,consent_at,source_page,utm,referrer) VALUES (?,?,?,?,?,?,?,?,?)',[identifier,'signudoc','want','synthetic-'+identifier,0,datetime.datetime.now(datetime.timezone.utc).isoformat(),'/owner-smoke','{}',''])
    counts=json.load(http('/api/interest/counts'))['counts'];assert counts['signudoc']==before+3;assert all(isinstance(n,int) and n>=3 for n in counts.values())
    print(environment+': public aggregate threshold verified with synthetic rows, no contact fields returned')
    assert http('/unsubscribe?t='+subscriber['unsubscribe_token']).status==200
    assert sql('SELECT unsubscribed_at FROM signups WHERE email=?',[email])[0]['unsubscribed_at']
    print(environment+': newsletter one-click unsubscribe stored')
finally:
    sql('DELETE FROM interest_signals WHERE source_page=?',[marker])
    sql('DELETE FROM interest_signals WHERE email=?',[email])
    for identifier in seed_ids:sql('DELETE FROM interest_signals WHERE id=?',[identifier])
    sql('DELETE FROM signups WHERE email=?',[email])
    assert sql('SELECT COUNT(*) AS n FROM interest_signals WHERE email=?',[email])[0]['n']==0
    assert sql('SELECT COUNT(*) AS n FROM interest_signals WHERE source_page=?',[marker])[0]['n']==0
    assert sql('SELECT COUNT(*) AS n FROM signups WHERE email=?',[email])[0]['n']==0
    assert sql('SELECT COUNT(*) AS n FROM interest_signals WHERE id IN (?,?,?)',seed_ids)[0]['n']==0
    print(environment+': all synthetic signal/signup rows deleted; absence verified')
