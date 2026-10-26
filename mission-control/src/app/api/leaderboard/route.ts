/**
 * GET /api/leaderboard - Get public leaderboard entries
 *
 * Returns paginated leaderboard with only opted-in learners.
 * World-readable - no authentication required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminLeaderboardRepository } from '@/infrastructure/container.server';
import { LeaderboardCursor } from '@/core/domain/repositories/ILeaderboardRepository';

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor');

    let leaderboardCursor: LeaderboardCursor | undefined;
    if (cursor) {
      try {
        leaderboardCursor = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid cursor' },
          { status: 400 }
        );
      }
    }

    const repository = adminLeaderboardRepository();
    const page = await repository.getPublicLeaderboard(PAGE_SIZE, leaderboardCursor);

    const nextCursor = page.nextCursor
      ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64')
      : null;

    return NextResponse.json({
      success: true,
      entries: page.entries.map((e) => ({
        displayName: e.displayName,
        score: e.score,
        completedChallenges: e.completedChallenges,
      })),
      nextCursor,
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
