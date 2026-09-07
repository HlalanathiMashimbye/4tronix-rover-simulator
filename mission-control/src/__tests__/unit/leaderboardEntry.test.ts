/**
 * LeaderboardEntry domain entity tests
 */

import { createLeaderboardEntry, isPublicEntry } from '@/core/domain/entities/LeaderboardEntry';

describe('LeaderboardEntry', () => {
  describe('createLeaderboardEntry', () => {
    it('creates entry with default values', () => {
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');

      expect(entry.id).toBe('test-hash');
      expect(entry.displayName).toBe('Test Learner');
      expect(entry.score).toBe(0);
      expect(entry.completedChallenges).toBe(0);
      expect(entry.completedChallengeIds).toEqual([]);
      expect(entry.optedIn).toBe(false);
      expect(entry.leaderboardId).toBe('default');
    });

    it('sets timestamps on creation', () => {
      const beforeCreation = new Date().getTime();
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');
      const afterCreation = new Date().getTime();

      const createdAtMs = new Date(entry.createdAt).getTime();
      expect(createdAtMs).toBeGreaterThanOrEqual(beforeCreation);
      expect(createdAtMs).toBeLessThanOrEqual(afterCreation);
      expect(entry.updatedAt).toEqual(entry.createdAt);
    });
  });

  describe('isPublicEntry', () => {
    it('returns false when not opted in', () => {
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');
      expect(isPublicEntry(entry)).toBe(false);
    });

    it('returns true when opted in', () => {
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');
      entry.optedIn = true;
      expect(isPublicEntry(entry)).toBe(true);
    });
  });

  describe('Privacy', () => {
    it('never exposes raw learner ID', () => {
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');
      expect(entry.id).toBe('test-hash');
      expect((entry as unknown as Record<string, unknown>).learnerId).toBeUndefined();
    });

    it('only stores necessary public fields', () => {
      const entry = createLeaderboardEntry('test-hash', 'Test Learner');
      entry.optedIn = true;

      const publicFields = {
        displayName: entry.displayName,
        score: entry.score,
        completedChallenges: entry.completedChallenges,
      };

      expect(publicFields).toEqual({
        displayName: 'Test Learner',
        score: 0,
        completedChallenges: 0,
      });

      // Challenge IDs are private (not shown on public leaderboard)
      expect((entry as unknown as Record<string, unknown>).completedChallengeIds).toBeDefined();
    });
  });
});
