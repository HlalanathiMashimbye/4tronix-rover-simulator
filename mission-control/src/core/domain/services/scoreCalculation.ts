/**
 * Leaderboard scoring (AB#449). THE ONE PLACE THE RULE IS WRITTEN.
 *
 * All calculations are server-side. Points come from what a learner has shown
 * they can do, not from how many guided steps they clicked through: a
 * tutorial walks a learner through an idea, a level's test (AB#446) is where
 * they use it on their own with no help, so the test is worth five tutorials.
 *
 * Per challenge KIND, not per challenge. Each challenge used to carry its own
 * number, twice over - a scorePoints field on the content and a table here,
 * "kept in step" by a comment - and a new challenge had to be priced by hand
 * in both. Now a challenge is a tutorial or a test, and its kind sets its
 * worth.
 *
 * Which challenges are tests is content (infrastructure/config/challenges.ts),
 * and core may not import infrastructure (architecture.test.ts), so callers
 * pass a ChallengeKindOf - the content's challengeKind - rather than this file
 * reading the levels itself.
 */

export type ChallengeKind = 'tutorial' | 'test';

/** Starting points from AB#449: 50 a tutorial, 250 a level test. */
export const CHALLENGE_KIND_POINTS: Record<ChallengeKind, number> = {
  tutorial: 50,
  test: 250,
};

/** What kind of challenge an id is, or null when it is not a challenge at all. */
export type ChallengeKindOf = (challengeId: string) => ChallengeKind | null;

/**
 * Points for one completed challenge. An id that is not a challenge earns
 * nothing: the completion route accepts whatever id it is sent, and the old
 * default of 50 for an unknown id paid out for made-up ones.
 */
export function getChallengePoints(challengeId: string, kindOf: ChallengeKindOf): number {
  const kind = kindOf(challengeId);
  return kind ? CHALLENGE_KIND_POINTS[kind] : 0;
}

/**
 * A learner's total. Each challenge counts once however many times it was
 * completed - repeating a challenge does not earn its points again - so the
 * ids are de-duplicated here rather than trusted to arrive unique.
 */
export function calculateScore(completedChallengeIds: string[], kindOf: ChallengeKindOf): number {
  return [...new Set(completedChallengeIds)].reduce(
    (total, challengeId) => total + getChallengePoints(challengeId, kindOf),
    0,
  );
}

/**
 * Verify that score calculation is idempotent
 * (same input always produces same output, no side effects)
 */
export function verifyScoreIdempotent(challengeIds: string[], kindOf: ChallengeKindOf): boolean {
  return calculateScore(challengeIds, kindOf) === calculateScore(challengeIds, kindOf);
}
