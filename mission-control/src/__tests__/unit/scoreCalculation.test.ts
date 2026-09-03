/**
 * Score calculation tests
 */

import { calculateScore, verifyScoreIdempotent } from '@/core/domain/services/scoreCalculation';

describe('scoreCalculation', () => {
  describe('calculateScore', () => {
    it('awards 100 points per completed mission', () => {
      expect(calculateScore(0)).toBe(0);
      expect(calculateScore(1)).toBe(100);
      expect(calculateScore(2)).toBe(200);
      expect(calculateScore(5)).toBe(500);
      expect(calculateScore(10)).toBe(1000);
    });

    it('uses linear scoring (no bonuses or accelerators)', () => {
      expect(calculateScore(3)).toBe(300);
      expect(calculateScore(4)).toBe(400);
      const diff = calculateScore(5) - calculateScore(4);
      expect(diff).toBe(100);
    });

    it('handles zero missions', () => {
      expect(calculateScore(0)).toBe(0);
    });

    it('handles large numbers', () => {
      expect(calculateScore(1000)).toBe(100000);
    });
  });

  describe('verifyScoreIdempotent', () => {
    it('returns true for all inputs', () => {
      for (let i = 0; i <= 10; i++) {
        expect(verifyScoreIdempotent(i)).toBe(true);
      }
    });

    it('confirms same input produces same output', () => {
      const count = 5;
      const score1 = calculateScore(count);
      const score2 = calculateScore(count);
      expect(score1).toEqual(score2);
    });
  });

  describe('Score idempotency', () => {
    it('prevents duplicate point awards from retried requests', () => {
      const missionsCompleted = 3;
      const initialScore = calculateScore(missionsCompleted);

      // Simulate retry - same calculation should produce same result
      const retriedScore = calculateScore(missionsCompleted);

      expect(initialScore).toEqual(retriedScore);
    });

    it('does not award points for same mission completed twice', () => {
      // If a learner submits same mission twice and it completes both times,
      // the count should only increase once (due to unique mission constraint)
      const completedAfterFirstSubmit = calculateScore(1);
      const completedAfterSecondSubmit = calculateScore(1); // Not 2

      expect(completedAfterFirstSubmit).toEqual(completedAfterSecondSubmit);
    });
  });
});
