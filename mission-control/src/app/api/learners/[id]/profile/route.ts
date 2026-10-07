/**
 * POST /api/learners/[id]/profile
 *
 * Sets the learner's display name and avatar. Both fields are validated
 * server-side: the name must come from the display-name generator's closed
 * vocabulary, and the avatar style must be on the allowlist. This is the
 * safety boundary — the browser picker is convenience, not trust.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { isGeneratedDisplayName } from '@/core/domain/services/displayNameGenerator';
import { AVATAR_STYLES } from '@/core/domain/entities/Learner';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { adminLeaderboardRepository } from '@/infrastructure/container.server';

const bodySchema = z.object({
  displayName: z
    .string()
    .refine(isGeneratedDisplayName, 'Display names are generated, not typed'),
  avatar: z.object({
    style: z
      .string()
      .refine(
        (s): s is string => (AVATAR_STYLES as readonly string[]).includes(s),
        'Avatar style not recognised',
      ),
    seed: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, 'Seed has an unexpected format'),
  }),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validation = bodySchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: validation.error.errors.map((e) => e.message).join(', '),
      },
      { status: 400 },
    );
  }

  const { displayName, avatar } = validation.data;

  try {
    const firestore = getFirestoreInstance();
    await firestore
      .collection('learners')
      .doc(id)
      .set(
        { displayName, avatar, lastActiveAt: new Date().toISOString() },
        { merge: true },
      );

    // Keep the leaderboard entry in sync if one exists.
    try {
      const learnerRefHash = await hashLearnerId(id);
      const repo = adminLeaderboardRepository();
      const entry = await repo.findByLearnerRef(learnerRefHash);
      if (entry) {
        await repo.updateDisplayName(learnerRefHash, displayName);
      }
    } catch {
      // Best-effort: a failed leaderboard sync is not worth failing the profile save.
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[learners/profile] Failed to save profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save profile' },
      { status: 500 },
    );
  }
}
