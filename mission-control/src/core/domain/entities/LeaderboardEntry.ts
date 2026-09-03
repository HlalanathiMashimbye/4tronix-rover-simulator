/**
 * Leaderboard Entry Domain Entity
 *
 * Represents a learner's public presence on the leaderboard.
 * Uses pseudonymous identity: never exposes raw learner ID, email, or any PII.
 *
 * Design principles:
 * - Privacy-first: Only nickname, score, and challenge count are public
 * - Opt-in: Learners must explicitly join
 * - Immutable ID: Keyed by learnerRef hash (same as missions)
 * - Aggregated: Score is computed server-side from verified missions
 */

export interface LeaderboardEntry {
  // Identifiers
  id: string; // One-way hash of learner ID (learnerRef), never the raw ID
  leaderboardId: string; // For potential future multi-leaderboard support

  // Public profile (pseudonymous)
  displayName: string; // Random generated nickname
  score: number; // Total points from completed challenges
  completedChallenges: number; // Count of unique challenges completed
  completedChallengeIds: string[]; // IDs of completed challenges (for idempotency)

  // Opt-in status
  optedIn: boolean; // Whether learner is publicly visible
  optedInAt?: string; // When they joined

  // Timestamps
  createdAt: string; // When first added to leaderboard
  updatedAt: string; // Last score update
}

/**
 * Creates a new leaderboard entry
 */
export function createLeaderboardEntry(
  id: string,
  displayName: string,
  leaderboardId: string = 'default'
): LeaderboardEntry {
  const now = new Date().toISOString();

  return {
    id,
    leaderboardId,
    displayName,
    score: 0,
    completedChallenges: 0,
    completedChallengeIds: [],
    optedIn: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Type guard to check if entry is public
 */
export function isPublicEntry(entry: LeaderboardEntry): boolean {
  return entry.optedIn;
}
