#!/usr/bin/env python3
"""PII travels on stdin only; reuse075's existing private project-status helper."""
import contextlib
import io
import json
from pathlib import Path
import re
import sys
import uuid

HELPER_DIR = Path('/home/dev/code/paseo-buzz-bridge-20261114/listener')


def run(payload, helper):
    channel = payload['channel']
    if str(uuid.UUID(channel)) != channel:
        raise ValueError('invalid channel')
    key, text = payload['item_key'], payload['text']
    if not re.fullmatch(r'(hi-signup/[a-f0-9-]{36}|hi-signup-summary/[a-f0-9]{64})', key) or not isinstance(text,str) or not text.strip() or len(text.encode())>8192:
        raise ValueError('invalid private card')
    entered = False
    original = helper.ProjectStatus.update
    def update(*args, **kwargs):
        nonlocal entered
        entered = True
        return original(*args, **kwargs)
    helper.ProjectStatus.update = update
    output = io.StringIO()
    try:
        with contextlib.redirect_stdout(output):
            # Calls the existing CLI main IN MEMORY: contact data is never OS argv.
            # Its own lock, registry, fresh signed two-member ACL and readback apply.
            helper.main([channel,key,'done',text])
    except BlockingIOError:
        # Only a lock refusal BEFORE entering update is definitely unpublished.
        return 76 if entered else 75, None
    finally:
        helper.ProjectStatus.update = original
    result = json.loads(output.getvalue())
    if result.get('channel') != channel or result.get('item_key') != key:
        raise ValueError('scope mismatch')
    message = result.get('status_message_id')
    if not isinstance(message,str) or not re.fullmatch('[a-f0-9]{64}',message):
        raise ValueError('unverified message')
    return 0, {'channel':channel,'item_key':key,'status_message_id':message}


def main():
    try:
        raw=sys.stdin.buffer.read(32769)
        if len(raw)>32768:raise ValueError('payload cap')
        payload=json.loads(raw)
        sys.path.insert(0,str(HELPER_DIR))
        import project_status
        code,result=run(payload,project_status)
        if result:print(json.dumps(result))
        return code
    except BaseException:
        # No tracebacks, provider bodies or subscriber text on stdout/stderr.
        return 76

if __name__=='__main__':sys.exit(main())
