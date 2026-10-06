/**
 * POST /api/learners/[id]/recovery-code
 *
 * Generates a new recovery code for a learner. The plaintext is returned
 * exactly once; only the SHA-256 hash is stored. If the learner already
 * has a code, the old one is retired first — one active code per learner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminRecoveryCodeRepository } from '@/infrastructure/container.server';
import { generateRecoveryCode, hashRecoveryCode, formatRecoveryCode } from '@/core/domain/services/recoveryCode';
import { hashLearnerId } from '@/core/domain/services/learnerRef';

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 }
    );
  }

  try {
    const firestore = getFirestoreInstance();
    const learnerSnap = await firestore.collection('learners').doc(id).get();
    if (!learnerSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Learner not found' },
        { status: 404 }
      );
    }

    const learnerRef = await hashLearnerId(id);
    const code = generateRecoveryCode();
    const codeHash = await hashRecoveryCode(code);

    const repo = adminRecoveryCodeRepository();
    await repo.retireByLearnerRef(learnerRef);
    await repo.storeCodeHash(id, learnerRef, codeHash);

    return NextResponse.json({
      success: true,
      code: formatRecoveryCode(code),
    });
  } catch (error) {
    console.error('[learners/recovery-code] Failed to generate recovery code:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate recovery code' },
      { status: 500 }
    );
  }
}
