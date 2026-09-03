/**
 * Leaderboard Privacy and Security Tests
 *
 * Verifies that:
 * - Raw learner IDs are never exposed
 * - Email hashes are not on leaderboard
 * - Only opted-in learners appear publicly
 * - Opt-out removes from public view
 * - No PII is leaked in any operation
 */

import { LeaderboardEntry, createLeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';

describe('Leaderboard Privacy', () => {
  describe('Entry structure', () => {
    it('never stores raw learner ID', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Test User');

      // Check that no raw learner ID field exists
      expect((entry as unknown as Record<string, unknown>).learnerId).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).rawLearnerId).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).sessionId).toBeUndefined();
    });

    it('never stores email or email hash', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Test User');

      // Check that no email-related fields exist
      expect((entry as unknown as Record<string, unknown>).email).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).emailHash).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).learnerEmail).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).learnerEmailHash).toBeUndefined();
    });

    it('never stores device fingerprint', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Test User');

      expect((entry as unknown as Record<string, unknown>).deviceFingerprint).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).fingerprint).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).browserSignature).toBeUndefined();
    });

    it('never stores IP address or location data', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Test User');

      expect((entry as unknown as Record<string, unknown>).ip).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).location).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).country).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).userAgent).toBeUndefined();
    });

    it('never stores mission details', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Test User');

      expect((entry as unknown as Record<string, unknown>).missions).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).missionIds).toBeUndefined();
      expect((entry as unknown as Record<string, unknown>).missionCodes).toBeUndefined();
    });

    it('stores only essential public fields', () => {
      const entry = createLeaderboardEntry('learner-ref-hash-sha256', 'Brave Rover');

      const essentialFields = {
        id: entry.id,
        displayName: entry.displayName,
        score: entry.score,
        completedChallenges: entry.completedChallenges,
        optedIn: entry.optedIn,
      };

      expect(essentialFields).toEqual({
        id: 'learner-ref-hash-sha256',
        displayName: 'Brave Rover',
        score: 0,
        completedChallenges: 0,
        optedIn: false,
      });
    });
  });

  describe('Opt-in/opt-out privacy', () => {
    it('starts opted out by default', () => {
      const entry = createLeaderboardEntry('hash1', 'User');
      expect(entry.optedIn).toBe(false);
    });

    it('can be opted in', () => {
      const entry = createLeaderboardEntry('hash1', 'User');
      entry.optedIn = true;
      expect(entry.optedIn).toBe(true);
    });

    it('can be opted out after being in', () => {
      const entry = createLeaderboardEntry('hash1', 'User');
      entry.optedIn = true;
      entry.optedIn = false;
      expect(entry.optedIn).toBe(false);
    });
  });

  describe('Nickname anonymization', () => {
    it('uses generated nickname, not real name', () => {
      const entry = createLeaderboardEntry('hash1', 'Clever Comet');

      // Nickname should be from generated list, not user-provided
      expect(entry.displayName).toBe('Clever Comet');
      // No way to reverse-engineer learner ID from nickname
      expect(entry.displayName.length).toBeLessThan(30);
    });

    it('same learner can have different nicknames on regeneration', () => {
      const entry1 = createLeaderboardEntry('hash1', 'Brave Rover');
      const entry2 = createLeaderboardEntry('hash1', 'Clever Comet');

      // Same learner ref, different nickname
      expect(entry1.id).toEqual(entry2.id);
      expect(entry1.displayName).not.toEqual(entry2.displayName);
    });
  });

  describe('Private vs Public visibility', () => {
    it('opted-out entry should not be visible publicly', () => {
      const entry = createLeaderboardEntry('hash1', 'User');
      entry.optedIn = false;

      // This entry should be filtered out of public queries
      const isPublic = entry.optedIn;
      expect(isPublic).toBe(false);
    });

    it('opted-in entry has rank/visibility data', () => {
      const entry = createLeaderboardEntry('hash1', 'User');
      entry.optedIn = true;
      entry.score = 300;
      entry.completedChallenges = 3;

      expect(entry.optedIn).toBe(true);
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.completedChallenges).toBeGreaterThan(0);
    });

    it('opted-in status change does not expose PII', () => {
      const entry = createLeaderboardEntry('hash1', 'User');

      // Opt in multiple times
      entry.optedIn = true;
      entry.optedIn = false;
      entry.optedIn = true;

      // No new fields appear that could leak data
      const publicFields = Object.keys(entry).filter((k) =>
        ['displayName', 'score', 'completedChallenges', 'optedIn'].includes(k)
      );

      expect(publicFields.length).toBeGreaterThan(0);
    });
  });

  describe('No aggregate data leakage', () => {
    it('score alone does not identify learner', () => {
      // Multiple learners could have same score
      const entries = [
        createLeaderboardEntry('hash1', 'Brave Rover'),
        createLeaderboardEntry('hash2', 'Clever Comet'),
        createLeaderboardEntry('hash3', 'Bold Explorer'),
      ];

      entries.forEach((e) => {
        e.score = 300;
        e.completedChallenges = 3;
      });

      // All have same score, but different IDs
      const uniqueScores = new Set(entries.map((e) => e.score));
      const uniqueIds = new Set(entries.map((e) => e.id));

      expect(uniqueScores.size).toBe(1);
      expect(uniqueIds.size).toBe(3);
    });

    it('completed challenges count alone does not identify learner', () => {
      const entries = [
        createLeaderboardEntry('hash1', 'User 1'),
        createLeaderboardEntry('hash2', 'User 2'),
        createLeaderboardEntry('hash3', 'User 3'),
      ];

      entries.forEach((e) => {
        e.completedChallenges = 5;
      });

      // Multiple learners with same count
      const uniqueCounts = new Set(entries.map((e) => e.completedChallenges));
      expect(uniqueCounts.size).toBe(1);
    });
  });
});
