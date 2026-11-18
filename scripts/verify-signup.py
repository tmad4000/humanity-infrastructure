#!/usr/bin/env python3
"""Owner-only remote lifecycle smoke test. Never prints CSV, secrets or unsubscribe tokens."""
import csv, io, json, pathlib, sys, urllib.request, uuid
base, environment = sys.argv[1:3]
assert environment in ('preview', 'production')
secrets = json.loads(pathlib.Path('/home/dev/.config/cloudflare/hi-signup-'+environment+'-secrets.json').read_text())
db = pathlib.Path('/tmp/hi-'+environment+'-db-id').read_text().strip()
d1_token = pathlib.Path('/home/dev/.config/cloudflare/d1-api-token').read_text().strip()
email = 'hi-smoke-'+uuid.uuid4().hex+'@example.com'
def http(path, data=None, headers=None):
    return urllib.request.urlopen(urllib.request.Request(base+path, data=json.dumps(data).encode() if data is not None else None, headers={'User-Agent':'HI-release-smoke/1.0', **(headers or {})}))
def sql(statement, params):
    request=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/68d006db286e6366317c029df3bb76dd/d1/database/'+db+'/query',data=json.dumps({'sql':statement,'params':params}).encode(),headers={'Authorization':'Bearer '+d1_token,'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request))
    assert result['success']
    return result['result'][0]['results']
try:
    response=http('/api/signup',{'email':email,'interest':'smoke lifecycle','handle':'hi_test','public_opt_in':False,'source_page':'/smoke','utm':{'utm_source':'release-smoke'},'referrer':'https://example.com/'},{'Content-Type':'application/json','Origin':base})
    body=json.load(response); assert body == {'ok': True}
    duplicate=json.load(http('/api/signup',{'email':email,'interest':'smoke lifecycle'},{'Content-Type':'application/json','Origin':base}))
    assert duplicate == body
    print(environment+': new/duplicate signup responses identical, no unsubscribe token exposed')
    row=sql('SELECT * FROM signups WHERE email = ?', [email])[0]
    assert row['interest']=='smoke lifecycle' and row['public_opt_in']==0 and row['unsubscribed_at'] is None
    assert json.loads(row['utm'])['utm_source']=='release-smoke' and row['consent_at']
    print(environment+': signup stored with consent, source, UTM/referrer and private handle')
    export=http('/admin/signups.csv',headers={'Authorization':'Bearer '+secrets['ADMIN_EXPORT_TOKEN']}).read().decode()
    assert any(r['email']==email for r in csv.DictReader(io.StringIO(export)))
    print(environment+': authenticated CSV export verified')
    unsubscribe=urllib.request.urlopen(urllib.request.Request(base+'/unsubscribe?t='+row['unsubscribe_token'], headers={'User-Agent':'HI-release-smoke/1.0'}));assert unsubscribe.status==200
    assert sql('SELECT unsubscribed_at FROM signups WHERE email = ?', [email])[0]['unsubscribed_at']
    print(environment+': one-click unsubscribe stored')
finally:
    sql('DELETE FROM signups WHERE email = ?', [email])
    assert sql('SELECT count(*) AS n FROM signups WHERE email = ?', [email])[0]['n']==0
    print(environment+': test row deleted and absence verified')
