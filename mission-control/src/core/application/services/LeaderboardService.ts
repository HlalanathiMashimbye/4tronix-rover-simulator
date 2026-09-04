/**
 * Leaderboard Service
 *
 * Business logic for leaderboard operations.
 * Handles challenge-based scoring, opt-in/out, and rank calculation.
 * All score writes are server-side only (via Admin SDK).
 */

import { ILeaderboardRepository } from '@/core/domain/repositories/ILeaderboardRepository';
import { LeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';
import { calculateScore } from '@/core/domain/services/scoreCalculation';
import { generateNickname } from '@/core/domain/services/nicknameGenerator';

export interface LeaderboardStats {
  score: number;
  completedChallenges: number;
  completedChallengeIds: string[];
  rank?: number;
  entry: LeaderboardEntry;
}

export class LeaderboardService {
  constructor(
    private readonly leaderboardRepository: ILeaderboardRepository
  ) {}

  /**
   * Record a completed challenge for a learner
   * Called server-side after challenge completion verification
   *
   * @param learnerRefHash - Hash of learner ID
   * @param challengeId - ID of the challenge completed
   * @returns Updated leaderboard stats
   */
  async recordChallengeCompletion(
    learnerRefHash: string,
    challengeId: string
  ): Promise<LeaderboardStats> {
    // Ensure entry exists
    const entry = await this.leaderboardRepository.getOrCreate(
      learnerRefHash,
      generateNickname()
    );

    // Check if challenge already completed (idempotency)
    if (entry.completedChallengeIds.includes(challengeId)) {
      // Already completed - return current stats without updating
      const rank = entry.optedIn
        ? (await this.leaderboardRepository.getRank(learnerRefHash)) ?? undefined
        : undefined;

      return {
        score: entry.score,
        completedChallenges: entry.completedChallenges,
        completedChallengeIds: entry.completedChallengeIds,
        rank,
        entry,
      };
    }

    // Add challenge to completed list
    const updatedChallengeIds = [...entry.completedChallengeIds, challengeId];
    const newScore = calculateScore(updatedChallengeIds);

    const updated = await this.leaderboardRepository.updateScore(
      learnerRefHash,
      updatedChallengeIds.length,
      newScore,
      updatedChallengeIds
    );

    const rank = updated.optedIn
      ? (await this.leaderboardRepository.getRank(learnerRefHash)) ?? undefined
      : undefined;

    return {
      score: updated.score,
      completedChallenges: updated.completedChallenges,
      completedChallengeIds: updated.completedChallengeIds,
      rank,
      entry: updated,
    };
  }

  /**
   * Opt learner into leaderboard
   */
  async optIn(learnerRefHash: string, displayName: string): Promise<LeaderboardEntry> {
    return this.leaderboardRepository.optIn(learnerRefHash, displayName);
  }

  /**
   * Opt learner out of leaderboard
   */
  async optOut(learnerRefHash: string): Promise<void> {
    return this.leaderboardRepository.optOut(learnerRefHash);
  }

  /**
   * Regenerate learner's display name
   */
  async regenerateNickname(learnerRefHash: string): Promise<LeaderboardEntry> {
    return this.leaderboardRepository.updateDisplayName(learnerRefHash, generateNickname());
  }

  /**
   * Get learner's current leaderboard stats
   */
  async getStats(learnerRefHash: string): Promise<LeaderboardStats | null> {
    const entry = await this.leaderboardRepository.findByLearnerRef(learnerRefHash);
    if (!entry) return null;

    const rank = entry.optedIn
      ? (await this.leaderboardRepository.getRank(learnerRefHash)) ?? undefined
      : undefined;

    return {
      score: entry.score,
      completedChallenges: entry.completedChallenges,
      completedChallengeIds: entry.completedChallengeIds,
      rank,
      entry,
    };
  }
}
