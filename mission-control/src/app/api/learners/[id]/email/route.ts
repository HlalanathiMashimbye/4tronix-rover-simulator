/**
 * POST /api/learners/[id]/email
 *
 * Sets (or clears) a learner's contact address.
 *
 * Why this route exists at all, rather than the browser writing the field
 * itself as it used to:
 *
 * Mission documents are world-readable and carry `learnerId`, and learner
 * documents are readable by exact id. So anyone could read the public feed,
 * collect learner ids from it, fetch each learner document and read
 * `learnerEmail` in plaintext - harvesting a list of school children's email
 * addresses from public data, with no credentials. `list: false` on the
 * collection did not help, because the ids were already being published.
 *
 * Firestore rules cannot hide a single field on read, so the address moves to
 * a subcollection that browsers are denied entirely, and only the Admin SDK
 * (which bypasses rules) can reach it. The public learner document keeps the
 * harmless profile fields.
 *
 * KNOWN LIMITATION, deliberately not solved here: `learnerId` is still
 * published on public mission documents, so it is not a secret and this route
 * cannot prove the caller owns the learner it names. That means someone can
 * still WRITE an address onto another learner's record - exactly as they
 * could before this change, since the old browser-side rule was equally
 * unauthenticated. This change closes the bulk-read exposure only. The root
 * fix is to stop publishing learnerId (carry a one-way hash on missions, the
 * same trick already used for the address itself) so possession of the id
 * means something; that needs a backfill of existing mission documents and is
 * tracked separately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import {
  LEARNER_PRIVATE_COLLECTION,
  LEARNER_CONTACT_DOC,
} from '@/core/domain/services/learnerContact';

const bodySchema = z.object({
  // null clears the address (the learner removing it).
  email: z.string().email('Must be a valid email address').nullable(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const validation = bodySchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: validation.error.errors.map((e) => e.message).join(', '),
      },
      { status: 400 }
    );
  }

  const { email } = validation.data;

  try {
    const firestore = getFirestoreInstance();
    const contactRef = firestore
      .collection('learners')
      .doc(id)
      .collection(LEARNER_PRIVATE_COLLECTION)
      .doc(LEARNER_CONTACT_DOC);

    if (email === null) {
      await contactRef.delete();
    } else {
      await contactRef.set(
        { learnerEmail: email, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }

    // Clear any address left on the publicly readable parent document by the
    // old client-side write. Without this, existing learners stay exposed
    // even though nothing writes there any more.
    await firestore
      .collection('learners')
      .doc(id)
      .set({ learnerEmail: null }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[learners/email] Failed to persist contact address:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save email' },
      { status: 500 }
    );
  }
}
