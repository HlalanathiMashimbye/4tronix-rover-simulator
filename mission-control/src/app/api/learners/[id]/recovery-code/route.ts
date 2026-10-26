/**
 * POST /api/learners/[id]/recovery-code
 *
 * Generates a new recovery code for a learner. The plaintext is returned
 * exactly once; only the SHA-256 hash is stored. Previous codes remain
 * valid — all codes for a learner resolve to the same identity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminRecoveryCodeRepository, learnerAccounts } from '@/infrastructure/container.server';
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
    await learnerAccounts().ensureExists(id, new Date().toISOString());

    const learnerRef = await hashLearnerId(id);
    const code = generateRecoveryCode();
    const codeHash = await hashRecoveryCode(code);

    const repo = adminRecoveryCodeRepository();
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
