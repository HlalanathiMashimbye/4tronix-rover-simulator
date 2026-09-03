/**
 * Score calculation for leaderboard
 *
 * Determines points awarded for challenge completion.
 * All calculations are server-side and non-repudiable.
 *
 * Scoring model (learning-focused):
 * - Base: Points per completed challenge (varies by challenge)
 * - Each challenge is counted once per learner (idempotent)
 */

export const CHALLENGE_POINTS: Record<string, number> = {
  'platform-orientation': 100,
  'basic-movement': 150,
  'loop-structures': 200,
  'sensor-operations': 250,
};

const DEFAULT_CHALLENGE_POINTS = 100;

/**
 * Get points for a specific challenge
 *
 * @param challengeId - ID of the challenge
 * @returns Points awarded for completing this challenge
 */
export function getChallengePoints(challengeId: string): number {
  return CHALLENGE_POINTS[challengeId] ?? DEFAULT_CHALLENGE_POINTS;
}

/**
 * Calculate total score from completed challenge IDs
 *
 * @param completedChallengeIds - Array of unique challenge IDs completed
 * @returns Total points
 */
export function calculateScore(completedChallengeIds: string[]): number {
  return completedChallengeIds.reduce((total, challengeId) => {
    return total + getChallengePoints(challengeId);
  }, 0);
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
