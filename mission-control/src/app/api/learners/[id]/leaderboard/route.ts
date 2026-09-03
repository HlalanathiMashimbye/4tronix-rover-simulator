/**
 * Learner leaderboard endpoints
 * - GET: Get current leaderboard status for learner
 * - POST: Opt in/out and manage leaderboard settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminLeaderboardRepository } from '@/infrastructure/container.server';
import { generateNickname } from '@/core/domain/services/nicknameGenerator';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: learnerRefHash } = await params;

    if (!learnerRefHash) {
      return NextResponse.json(
        { success: false, error: 'Learner ID required' },
        { status: 400 }
      );
    }

    const repository = adminLeaderboardRepository();
    const entry = await repository.findByLearnerRef(learnerRefHash);

    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found' },
        { status: 404 }
      );
    }

    const rank = entry.optedIn ? await repository.getRank(learnerRefHash) : null;

    return NextResponse.json({
      success: true,
      optedIn: entry.optedIn,
      displayName: entry.displayName,
      score: entry.score,
      completedChallenges: entry.completedChallenges,
      rank,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: learnerRefHash } = await params;

    if (!learnerRefHash) {
      return NextResponse.json(
        { success: false, error: 'Learner ID required' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 }
      );
    }

    const { action } = body as { action?: string };

    const repository = adminLeaderboardRepository();

    switch (action) {
      case 'opt-in': {
        const entry = await repository.optIn(learnerRefHash, generateNickname());
        return NextResponse.json({
          success: true,
          message: 'Opted in to leaderboard',
          displayName: entry.displayName,
        });
      }

      case 'opt-out': {
        await repository.optOut(learnerRefHash);
        return NextResponse.json({
          success: true,
          message: 'Opted out of leaderboard',
        });
      }

      case 'regenerate-nickname': {
        const entry = await repository.updateDisplayName(
          learnerRefHash,
          generateNickname()
        );
        return NextResponse.json({
          success: true,
          displayName: entry.displayName,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
