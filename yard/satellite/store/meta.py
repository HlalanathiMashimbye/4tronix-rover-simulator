"""
Sync cursors and other small key/value state.

Used by sync_worker to remember where the last pull got to, which is what
keeps the Firestore read cost proportional to what changed rather than to how
many missions exist.
"""

from store.db import _connect, _db_lock

def get_meta(key, default=None):
    with _db_lock:
        conn = _connect()
        row = conn.execute('SELECT value FROM sync_meta WHERE key = ?', (key,)).fetchone()
        conn.close()
    return row['value'] if row else default


def set_meta(key, value):
    with _db_lock:
        conn = _connect()
        conn.execute('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?,?)', (key, value))
        conn.commit()
        conn.close()
