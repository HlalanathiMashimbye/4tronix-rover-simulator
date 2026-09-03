/**
 * Leaderboard Service
 *
 * Business logic for leaderboard operations.
 * Handles challenge-based scoring, opt-in/out, and rank calculation.
 * Integrates with Progressive Challenges for verified completions.
 * All score writes are server-side only (via Admin SDK).
 */

import { ILeaderboardRepository } from '@/core/domain/repositories/ILeaderboardRepository';
import { LeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';
import { ChallengeProgress } from '@/core/domain/entities/ChallengeProgress';
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
    let entry = await this.leaderboardRepository.getOrCreate(
      learnerRefHash,
      generateNickname()
    );

    // Check if challenge already completed (idempotency)
    if (entry.completedChallengeIds.includes(challengeId)) {
      // Already completed - return current stats without updating
      const rank = entry.optedIn
        ? await this.leaderboardRepository.getRank(learnerRefHash)
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
      ? await this.leaderboardRepository.getRank(learnerRefHash)
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
   * Sync leaderboard with challenge progress
   * Called server-side to update leaderboard from verified challenge completions
   *
   * @param learnerRefHash - Hash of learner ID
   * @param challengeProgress - Learner's challenge progress from Firestore
   * @returns Updated leaderboard stats
   */
  async syncWithChallengeProgress(
    learnerRefHash: string,
    challengeProgress: ChallengeProgress
  ): Promise<LeaderboardStats> {
    // Extract completed challenge IDs from progress
    const completedIds = challengeProgress.completions.map((c) => c.challengeId);

    // Ensure entry exists
    let entry = await this.leaderboardRepository.getOrCreate(
      learnerRefHash,
      generateNickname()
    );

    // Check if already in sync
    const currentIds = entry.completedChallengeIds;
    const newIds = completedIds.filter((id) => !currentIds.includes(id));

    if (newIds.length === 0) {
      // Already in sync
      const rank = entry.optedIn
        ? await this.leaderboardRepository.getRank(learnerRefHash)
        : undefined;

      return {
        score: entry.score,
        completedChallenges: entry.completedChallenges,
        completedChallengeIds: entry.completedChallengeIds,
        rank,
        entry,
      };
    }

    // Update with all completed challenges
    const allCompletedIds = [...currentIds, ...newIds];
    const newScore = calculateScore(allCompletedIds);

    const updated = await this.leaderboardRepository.updateScore(
      learnerRefHash,
      allCompletedIds.length,
      newScore,
      allCompletedIds
    );

    const rank = updated.optedIn
      ? await this.leaderboardRepository.getRank(learnerRefHash)
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
      ? await this.leaderboardRepository.getRank(learnerRefHash)
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
