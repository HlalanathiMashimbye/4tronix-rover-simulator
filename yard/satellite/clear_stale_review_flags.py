"""One-off cleanup: clear needs_review on missions that already finished.

Until this release, resolve_review was the only code path that ever cleared
needs_review, and it has no UI. So a mission that was flagged for review, then
rerun and completed normally, kept the flag forever. The console's review count
could only ever go up, and no action available to an operator brought it down.

The code fix stops new ones accumulating. It cannot clear the ones already on
disk, because nothing will touch those missions again - they are already
terminal.

Only terminal missions are cleared. A mission still sitting in 'processing' is
genuinely ambiguous (the satellite died mid-run and nobody knows whether the
rover finished), and that is exactly what the flag is for. Those are left alone
for an operator to decide.

Writes go through the outbox, so the change reaches Firestore on the next sync
cycle rather than only fixing the local mirror.

Usage, from yard/satellite:

    python clear_stale_review_flags.py            # dry run, shows what it would do
    python clear_stale_review_flags.py --apply    # actually clear them
"""

import sys

from mission_store import get_needs_review, init_db, write_and_enqueue

TERMINAL = ('completed', 'failed', 'cancelled')


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def find_stale():
    """Flagged missions that have already reached a terminal status."""
    return [m for m in get_needs_review() if m.get('status') in TERMINAL]


def clear(mission_id):
    write_and_enqueue(
        mission_id,
        {'needs_review': 0, 'review_reason': None},
        'review',
        {'needsReview': False, 'reviewReason': None,
         'statusUpdatedAt': _now_iso()},
    )


def main(argv):
    apply_changes = '--apply' in argv
    init_db()

    flagged = get_needs_review()
    stale = find_stale()
    ambiguous = [m for m in flagged if m not in stale]

    print(f'{len(flagged)} mission(s) currently flagged for review')
    print(f'  {len(stale)} already finished -> stale flag, safe to clear')
    print(f'  {len(ambiguous)} still processing -> genuinely ambiguous, left alone')

    for m in stale:
        print(f"    [clear] {m['id']}  status={m['status']}  reason={m.get('review_reason')}")
    for m in ambiguous:
        print(f"    [keep ] {m['id']}  status={m['status']}  reason={m.get('review_reason')}")

    if not stale:
        print('\nNothing to do.')
        return 0

    if not apply_changes:
        print(f'\nDry run. Re-run with --apply to clear {len(stale)} flag(s).')
        return 0

    for m in stale:
        clear(m['id'])
    print(f'\nCleared {len(stale)} stale flag(s). They will reach Firestore on the'
          ' next sync cycle.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
