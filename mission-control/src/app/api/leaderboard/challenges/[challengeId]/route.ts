/**
 * POST /api/leaderboard/challenges/[challengeId] - Record verified challenge completion
 *
 * Called server-side after a challenge is verified as complete.
 * Updates learner's leaderboard score with idempotency.
 * Only accessible via Admin SDK (server-side only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminLeaderboardRepository } from '@/infrastructure/container.server';
import { LeaderboardService } from '@/core/application/services/LeaderboardService';
import { hashLearnerId } from '@/core/domain/services/learnerRef';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ challengeId: string }> }
) {
  try {
    const { challengeId } = await params;

    if (!challengeId) {
      return NextResponse.json(
        { success: false, error: 'Challenge ID required' },
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

    const { learnerId } = body as { learnerId?: string };

    if (!learnerId) {
      return NextResponse.json(
        { success: false, error: 'Learner ID required' },
        { status: 400 }
      );
    }

    // Hash the learner ID to get the public reference
    const learnerRefHash = await hashLearnerId(learnerId);

    // Create service and record challenge completion
    const repository = adminLeaderboardRepository();
    const service = new LeaderboardService(repository);

    const stats = await service.recordChallengeCompletion(learnerRefHash, challengeId);

    return NextResponse.json({
      success: true,
      message: 'Challenge completion recorded',
      stats: {
        score: stats.score,
        completedChallenges: stats.completedChallenges,
        rank: stats.rank,
      },
    });
  } catch (error) {
    console.error('[Leaderboard] Challenge completion recording failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
