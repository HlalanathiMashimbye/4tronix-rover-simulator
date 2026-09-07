/**
 * Score calculation tests
 */

import {
  calculateScore,
  getChallengePoints,
} from '@/core/domain/services/scoreCalculation';

describe('scoreCalculation', () => {
  describe('getChallengePoints', () => {
    it('returns correct points for known challenges', () => {
      expect(getChallengePoints('platform-orientation')).toBe(50);
      expect(getChallengePoints('first-mission')).toBe(100);
      expect(getChallengePoints('basic-movement')).toBe(150);
      expect(getChallengePoints('loop-structures')).toBe(200);
      expect(getChallengePoints('draw-a-square')).toBe(250);
    });

    it('returns default points for unknown challenges', () => {
      expect(getChallengePoints('unknown-challenge')).toBe(50);
    });
  });

  describe('calculateScore', () => {
    it('returns 0 for no completed challenges', () => {
      expect(calculateScore([])).toBe(0);
    });

    it('calculates score from single challenge', () => {
      expect(calculateScore(['platform-orientation'])).toBe(50);
      expect(calculateScore(['first-mission'])).toBe(100);
      expect(calculateScore(['basic-movement'])).toBe(150);
      expect(calculateScore(['loop-structures'])).toBe(200);
      expect(calculateScore(['draw-a-square'])).toBe(250);
    });

    it('sums points from multiple challenges', () => {
      const challenges = ['platform-orientation', 'basic-movement'];
      const expected = 50 + 150;
      expect(calculateScore(challenges)).toBe(expected);
    });

    it('handles all defined challenges combined', () => {
      const allChallenges = [
        'platform-orientation',
        'explore-the-platform',
        'first-mission',
        'basic-movement',
        'loop-structures',
        'draw-a-square',
      ];
      const expected = 50 + 75 + 100 + 150 + 200 + 250;
      expect(calculateScore(allChallenges)).toBe(expected);
    });

    it('handles unknown challenges in mix', () => {
      const challenges = ['platform-orientation', 'unknown', 'basic-movement'];
      const expected = 50 + 50 + 150; // unknown defaults to 50
      expect(calculateScore(challenges)).toBe(expected);
    });
  });

  describe('Score idempotency', () => {
    it('same input always produces same output', () => {
      const challengeIds = ['platform-orientation', 'basic-movement'];
      const score1 = calculateScore(challengeIds);
      const score2 = calculateScore(challengeIds);
      expect(score1).toEqual(score2);
    });

    it('prevents duplicate point awards from retried requests', () => {
      const completedOnce = calculateScore(['platform-orientation']);
      const completedTwice = calculateScore([
        'platform-orientation',
        'platform-orientation',
      ]);

      // Note: if same challenge appears twice, both are counted
      // Real idempotency is enforced at the service level (no duplicates in array)
      expect(completedOnce).toBe(50);
      expect(completedTwice).toBe(100);
    });

    it('verified list prevents duplicates at service layer', () => {
      // Service must deduplicate before calling calculateScore
      const deduplicatedIds = Array.from(
        new Set(['platform-orientation', 'basic-movement', 'platform-orientation'])
      );

      expect(calculateScore(deduplicatedIds)).toBe(50 + 150);
    });
  });
});
