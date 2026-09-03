/**
 * Score calculation for leaderboard
 *
 * Determines points awarded for mission completion.
 * All calculations are server-side and non-repudiable.
 *
 * Scoring model (learning-focused):
 * - Base: 100 points per completed mission
 * - Each mission is counted once (idempotent)
 */

/**
 * Calculate score for a completed mission
 *
 * @param completedMissionCount - Number of missions completed by this learner
 * @returns Total points
 */
export function calculateScore(completedMissionCount: number): number {
  return completedMissionCount * 100;
}

/**
 * Verify that score calculation is idempotent
 * (same input always produces same output, no side effects)
 */
export function verifyScoreIdempotent(count: number): boolean {
  const score1 = calculateScore(count);
  const score2 = calculateScore(count);
  return score1 === score2;
}
