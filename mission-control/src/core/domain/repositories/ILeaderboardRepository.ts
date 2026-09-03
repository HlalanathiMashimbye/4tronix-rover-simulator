/**
 * Leaderboard Repository Interface
 *
 * Implements the Repository pattern for leaderboard operations.
 * Maintains separation between domain and persistence layers.
 */

import { LeaderboardEntry } from '../entities/LeaderboardEntry';

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  nextCursor?: LeaderboardCursor;
}

export interface LeaderboardCursor {
  lastId: string;
  lastScore: number;
  lastName: string;
}

export interface ILeaderboardRepository {
  /**
   * Get or create a leaderboard entry for a learner
   */
  getOrCreate(learnerRefHash: string, nickname: string): Promise<LeaderboardEntry>;

  /**
   * Find entry by learner ref hash
   */
  findByLearnerRef(learnerRefHash: string): Promise<LeaderboardEntry | null>;

  /**
   * Update leaderboard entry with new score
   */
  updateScore(
    learnerRefHash: string,
    completedChallenges: number,
    score: number
  ): Promise<LeaderboardEntry>;

  /**
   * Opt learner into leaderboard (make public)
   */
  optIn(learnerRefHash: string, displayName: string): Promise<LeaderboardEntry>;

  /**
   * Opt learner out of leaderboard (hide from public)
   */
  optOut(learnerRefHash: string): Promise<void>;

  /**
   * Get public leaderboard entries, sorted by score descending
   * Paginated to avoid expensive reads
   */
  getPublicLeaderboard(limit: number, cursor?: LeaderboardCursor): Promise<LeaderboardPage>;

  /**
   * Get learner's rank on the leaderboard
   */
  getRank(learnerRefHash: string): Promise<number | null>;

  /**
   * Regenerate a learner's display name
   */
  updateDisplayName(learnerRefHash: string, newName: string): Promise<LeaderboardEntry>;
}
