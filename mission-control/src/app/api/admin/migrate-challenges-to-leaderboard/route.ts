/**
 * POST /api/admin/migrate-challenges-to-leaderboard
 *
 * Admin endpoint: Syncs all existing challenge completions to the leaderboard.
 * Creates leaderboard entries for learners who completed challenges before
 * the leaderboard existed, with their scores and challenge counts.
 *
 * Uses Admin SDK to:
 * 1. Query all learner documents with challenge progress
 * 2. For each learner, create/update leaderboard entry
 * 3. Calculate score from their completed challenges
 * 4. Set them as opted-in (they earned their score through challenges)
 * 5. Generate a random nickname for privacy
 *
 * Idempotent: Running twice won't duplicate entries or re-score.
 * Non-blocking: Reports progress as it goes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminLeaderboardRepository } from '@/infrastructure/container.server';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { calculateScore } from '@/core/domain/services/scoreCalculation';
import { generateNickname } from '@/core/domain/services/nicknameGenerator';

interface MigrationStats {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export async function POST(request: NextRequest) {
  try {
    const db = getFirestoreInstance();
    const leaderboardRepo = adminLeaderboardRepository();

    const stats: MigrationStats = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Query all learner documents
    const snapshot = await db.collection('learners').get();

    console.log(`[Migration] Found ${snapshot.size} learner documents`);

    for (const learnerDoc of snapshot.docs) {
      try {
        const learnerId = learnerDoc.id;
        const learnerData = learnerDoc.data();
        const progress = learnerData.progress;

        // Skip learners with no challenge progress
        if (!progress?.completions || progress.completions.length === 0) {
          stats.skipped++;
          continue;
        }

        stats.processed++;

        // Extract challenge IDs from completions
        const completedChallengeIds = progress.completions.map(
          (c: { challengeId: string }) => c.challengeId
        );

        // Hash the learner ID for privacy
        const learnerRefHash = await hashLearnerId(learnerId);

        // Calculate score from completed challenges
        const score = calculateScore(completedChallengeIds);

        // Check if leaderboard entry already exists
        const existingEntry = await leaderboardRepo.findByLearnerRef(learnerRefHash);

        if (existingEntry) {
          // Entry exists - only update if their score is different
          if (existingEntry.score !== score ||
              existingEntry.completedChallenges !== completedChallengeIds.length) {
            // Update with their actual completion data
            await leaderboardRepo.updateScore(
              learnerRefHash,
              completedChallengeIds.length,
              score,
              completedChallengeIds
            );
            stats.updated++;
            console.log(`[Migration] Updated ${learnerId}: ${completedChallengeIds.length} challenges, ${score} points`);
          } else {
            stats.skipped++;
          }
        } else {
          // Create new entry - mark as opted-in since they earned this score
          const nickname = generateNickname();

          // Create entry
          await leaderboardRepo.getOrCreate(learnerRefHash, nickname);

          // Update with their actual completion data
          await leaderboardRepo.updateScore(
            learnerRefHash,
            completedChallengeIds.length,
            score,
            completedChallengeIds
          );

          // Opt them in (they earned this score, they're on the leaderboard)
          await leaderboardRepo.optIn(learnerRefHash, nickname);

          stats.created++;
          console.log(`[Migration] Created ${learnerId}: ${nickname}, ${completedChallengeIds.length} challenges, ${score} points`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        stats.errors.push(`Learner ${learnerDoc.id}: ${errorMsg}`);
        console.error(`[Migration] Error processing learner ${learnerDoc.id}:`, error);
      }
    }

    const message = `Migration complete: ${stats.processed} processed, ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`;
    console.log(`[Migration] ${message}`);

    return NextResponse.json({
      success: true,
      message,
      stats,
    });
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
