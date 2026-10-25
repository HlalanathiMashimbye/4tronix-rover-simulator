"""Whether a mission handed over in a link really came from Mission Control.

Send to Rover opens the run station with the mission in the address. Anything
can open a link, so the run station sends by itself only when this says the
link carries Mission Control's signature: HMAC-SHA256 over the yard, mission,
expiry and the code's hash, keyed with the secret this satellite already
holds for uploads (youtube_upload). A link that fails waits for someone to
press Send, as a pasted mission always has.

The format is mission-control's infrastructure/yard/HmacHandoffSigner.ts.
Both are tested against tests/mission_handoff_vector.json.
"""

import hashlib
import hmac
import threading
import time

# Mission Control signs for five minutes. Anything claiming much longer was
# not signed by it, and a Pi whose clock is a little behind still accepts.
_MAX_AHEAD_SECONDS = 15 * 60

_used = {}
_lock = threading.Lock()


def message(yard_id, mission_id, expires, code):
    code_hash = hashlib.sha256(code.encode('utf-8')).hexdigest()
    return '\n'.join(['mission-handoff/v1', yard_id, mission_id, str(expires), code_hash])


def signature(secret, yard_id, mission_id, expires, code):
    return hmac.new(secret.encode('utf-8'), message(yard_id, mission_id, expires, code).encode('utf-8'),
                    hashlib.sha256).hexdigest()


def verify(secret, yard_id, mission_id, code, expires, sig, now=None):
    """(True, None) for a signature to act on, else (False, why). Each verifies once."""
    if not secret:
        return False, 'no shared secret on this satellite'
    try:
        expires = int(expires)
    except (TypeError, ValueError):
        return False, 'no expiry'
    now = time.time() if now is None else now
    if expires < now:
        return False, 'expired'
    if expires > now + _MAX_AHEAD_SECONDS:
        return False, 'expiry too far ahead'
    expected = signature(secret, yard_id, mission_id, expires, code)
    if not hmac.compare_digest(expected, str(sig or '')):
        return False, 'signature does not match'
    with _lock:
        for seen, until in list(_used.items()):
            if until < now:
                del _used[seen]
        # Once: a reload, or the same link opened again, waits for Send.
        if expected in _used:
            return False, 'already used'
        _used[expected] = expires
    return True, None
