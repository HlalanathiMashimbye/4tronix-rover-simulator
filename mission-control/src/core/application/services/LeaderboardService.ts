/**
 * Leaderboard Service
 *
 * Business logic for leaderboard operations.
 * Handles scoring, opt-in/out, and rank calculation.
 * All score writes are server-side only (via Admin SDK).
 */

import { ILeaderboardRepository } from '@/core/domain/repositories/ILeaderboardRepository';
import { IMissionRepository } from '@/core/domain/repositories/IMissionRepository';
import { LeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';
import { isCompletedAnywhere } from '@/core/domain/entities/MissionRun';
import { calculateScore } from '@/core/domain/services/scoreCalculation';
import { generateNickname } from '@/core/domain/services/nicknameGenerator';

export interface LeaderboardStats {
  score: number;
  completedChallenges: number;
  rank?: number;
  entry: LeaderboardEntry;
}

export class LeaderboardService {
  constructor(
    private readonly leaderboardRepository: ILeaderboardRepository,
    private readonly missionRepository: IMissionRepository
  ) {}

  /**
   * Calculate and update learner's leaderboard score
   * Called server-side after mission completion
   */
  async updateLeaderboardScore(learnerRefHash: string): Promise<LeaderboardStats> {
    // Ensure entry exists
    const entry = await this.leaderboardRepository.getOrCreate(
      learnerRefHash,
      generateNickname()
    );

    // Count completed missions for this learner
    // This requires querying all missions by learnerRef
    // For now, we'll use a placeholder - in production, this would need
    // a dedicated Firestore index or a batch job
    const completedCount = await this.countCompletedMissions(learnerRefHash);

    const score = calculateScore(completedCount);

    const updated = await this.leaderboardRepository.updateScore(
      learnerRefHash,
      completedCount,
      score
    );

    const rank = updated.optedIn ? await this.leaderboardRepository.getRank(learnerRefHash) : undefined;

    return {
      score: updated.score,
      completedChallenges: updated.completedChallenges,
      rank,
      entry: updated,
    };
  }

  /**
   * Count missions completed by a learner
   * This is a simplified version - in production, would use Firestore query
   */
  private async countCompletedMissions(learnerRefHash: string): Promise<number> {
    // Query for missions by this learner that have been completed
    // This would require a Firestore index or a separate tracking collection
    // For now, return 0 as placeholder - actual implementation depends on
    // how missions track learnerRef
    return 0;
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

    const rank = entry.optedIn ? await this.leaderboardRepository.getRank(learnerRefHash) : undefined;

    return {
      score: entry.score,
      completedChallenges: entry.completedChallenges,
      rank,
      entry,
    };
  }
}
