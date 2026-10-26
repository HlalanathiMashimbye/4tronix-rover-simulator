/**
 * Leaderboard scoring (AB#449): points for what a learner showed they can do.
 *
 * Run against the real content's challengeKind, so a challenge added later is
 * priced by its kind here without anyone writing it a test - and a level whose
 * test stops being its test changes what it is worth, visibly.
 */

import {
  CHALLENGE_KIND_POINTS,
  calculateScore,
  getChallengePoints,
} from '@/core/domain/services/scoreCalculation';
import { CHALLENGE_LEVELS, CHALLENGES, challengeKind } from '@/infrastructure/config/challenges';
import { LeaderboardService } from '@/core/application/services/LeaderboardService';
import type { ILeaderboardRepository } from '@/core/domain/repositories/ILeaderboardRepository';
import type { LeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';

const tests = CHALLENGE_LEVELS.map((level) => level.testId);
const tutorials = CHALLENGE_LEVELS.flatMap((level) => level.challengeIds.filter((id) => id !== level.testId));

describe('the scoring rule (AB#449)', () => {
  it('starts tutorials at 50 and level tests at 250', () => {
    expect(CHALLENGE_KIND_POINTS).toEqual({ tutorial: 50, test: 250 });
  });

  it("pays a level's test the most, and every tutorial the same small amount", () => {
    for (const id of tests) expect(getChallengePoints(id, challengeKind)).toBe(250);
    for (const id of tutorials) expect(getChallengePoints(id, challengeKind)).toBe(50);
  });

  it('prices every challenge in the track, and nothing else', () => {
    for (const id of Object.keys(CHALLENGES)) expect(getChallengePoints(id, challengeKind)).toBeGreaterThan(0);
    // The completion route accepts any id it is sent: a made-up one earns nothing.
    expect(getChallengePoints('not-a-challenge', challengeKind)).toBe(0);
  });

  it('does not pay twice for the same challenge', () => {
    const once = calculateScore([tests[0]], challengeKind);
    expect(calculateScore([tests[0], tests[0], tests[0]], challengeKind)).toBe(once);
  });

  it('adds up a level as its tutorials plus its test', () => {
    const level = CHALLENGE_LEVELS[0];
    const expected = (level.challengeIds.length - 1) * 50 + 250;
    expect(calculateScore([...level.challengeIds], challengeKind)).toBe(expected);
  });
});

/** An in-memory leaderboard, enough for the service's scoring path. */
function memoryRepository(): ILeaderboardRepository & { entry: () => LeaderboardEntry | null } {
  let entry: LeaderboardEntry | null = null;
  const now = '2026-10-08T00:00:00Z';
  return {
    entry: () => entry,
    getOrCreate: async (id, nickname) =>
      (entry ??= {
        id,
        leaderboardId: 'global',
        displayName: nickname,
        score: 0,
        completedChallenges: 0,
        completedChallengeIds: [],
        optedIn: false,
        createdAt: now,
        updatedAt: now,
      } as LeaderboardEntry),
    findByLearnerRef: async () => entry,
    updateScore: async (_id, completedChallenges, score, completedChallengeIds) => {
      entry = { ...entry!, completedChallenges, score, completedChallengeIds: completedChallengeIds ?? [] };
      return entry;
    },
    optIn: async () => entry!,
    optOut: async () => {},
    getPublicLeaderboard: async () => ({ entries: [], nextCursor: null }) as never,
    getRank: async () => null,
    updateDisplayName: async () => entry!,
  };
}

describe('recording completions on the leaderboard', () => {
  it('scores a test at 250 and a tutorial at 50', async () => {
    const repo = memoryRepository();
    const service = new LeaderboardService(repo, challengeKind);

    await service.recordChallengeCompletion('learner', tutorials[0]);
    await service.recordChallengeCompletion('learner', tests[0]);

    expect(repo.entry()!.score).toBe(300);
  });

  it('gives nothing for completing the same challenge again', async () => {
    const repo = memoryRepository();
    const service = new LeaderboardService(repo, challengeKind);

    await service.recordChallengeCompletion('learner', tests[0]);
    const again = await service.recordChallengeCompletion('learner', tests[0]);

    expect(again.score).toBe(250);
    expect(repo.entry()!.completedChallengeIds).toEqual([tests[0]]);
  });

  it('gives nothing for an id that is not a challenge', async () => {
    const repo = memoryRepository();
    await new LeaderboardService(repo, challengeKind).recordChallengeCompletion('learner', 'free-points');

    expect(repo.entry()!.score).toBe(0);
  });
});
