/**
 * Resolve learner refs to display names, for the operator queue (AB#377).
 *
 * WHY THIS CANNOT BE DONE IN THE BROWSER
 *
 * A mission carries `learnerRef`, a one-way hash of the learner's id, because
 * mission documents are world-readable and the feed used to print raw ids. The
 * hash cannot be reversed, and `learners` denies `list` to browsers precisely
 * so the collection cannot be enumerated. So the queue's live listener can see
 * that two missions came from the same person, and nothing more.
 *
 * The Admin SDK bypasses those rules, and this route is behind requireOperator.
 * That keeps the collection unenumerable for everyone else while letting an
 * operator standing in the room see whose mission is next.
 *
 * WHAT IT RETURNS, AND WHY IT IS NOT A NAME
 *
 * No learner has a display name. `updateDisplayName` exists in LearnerContext
 * but nothing in the UI calls it, so all 170 learner records have none. The
 * field is still read here, so the queue starts showing names the day a learner
 * can set one, without this route changing.
 *
 * What identity actually exists is the avatar colour the learner already sees
 * on their own screen, and how many missions they have submitted. "The purple
 * one, their third mission" is enough for an operator to match a queue row to a
 * child standing in front of them, which is the whole job.
 *
 * Email addresses are never returned. They live in learners/{id}/private, which
 * browsers are denied entirely, and they have no business on a queue screen
 * that may be facing a room.
 *
 * This is something the Flask console structurally cannot do: the satellite's
 * SQLite mirror has no learnerRef column at all.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { requireOperator, UnauthorizedError, ForbiddenError } from '@/lib/auth/dal';

/**
 * Firestore caps an `in` filter at 30 values, and the queue is capped at 50
 * missions, so a full queue can need two batches.
 */
const IN_QUERY_LIMIT = 30;

/** Never resolve more than one full queue's worth in a single request. */
const QUEUE_REF_CAP = 50;

/** What an operator may see about a learner. Deliberately small. */
export interface LearnerProfile {
  displayName?: string;
  avatarColor?: string;
  missionCount?: number;
}

export async function POST(request: NextRequest) {
  try {
    await requireOperator();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
    }
    console.error('[operator/learners] auth check failed:', error);
    return NextResponse.json({ success: false, error: 'Could not verify access' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const refs = (body as { refs?: unknown })?.refs;
  if (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string')) {
    return NextResponse.json({ success: false, error: 'refs must be an array of strings' }, { status: 400 });
  }

  const unique = [...new Set(refs as string[])].filter(Boolean).slice(0, QUEUE_REF_CAP);
  if (unique.length === 0) {
    return NextResponse.json({ success: true, profiles: {} });
  }

  try {
    const db = getFirestoreInstance();
    const profiles: Record<string, LearnerProfile> = {};

    for (let i = 0; i < unique.length; i += IN_QUERY_LIMIT) {
      const batch = unique.slice(i, i + IN_QUERY_LIMIT);
      const snapshot = await db
        .collection('learners')
        .where('learnerRef', 'in', batch)
        .get();

      for (const doc of snapshot.docs) {
        const ref = doc.get('learnerRef');
        if (typeof ref !== 'string') continue;

        const displayName = doc.get('displayName');
        const avatarColor = doc.get('avatarColor');
        const missionCount = doc.get('missionCount');

        profiles[ref] = {
          // Absent for every learner today. Read anyway, so the queue shows a
          // name the day one can be set rather than needing this route changed.
          displayName: typeof displayName === 'string' && displayName ? displayName : undefined,
          avatarColor: typeof avatarColor === 'string' ? avatarColor : undefined,
          missionCount: typeof missionCount === 'number' ? missionCount : undefined,
        };
      }
    }

    return NextResponse.json({ success: true, profiles });
  } catch (error) {
    console.error('[operator/learners] lookup failed:', error);
    return NextResponse.json({ success: false, error: 'Could not resolve names' }, { status: 500 });
  }
}
