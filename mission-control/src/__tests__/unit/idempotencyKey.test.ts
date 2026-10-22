/**
 * Idempotency key tests
 *
 * Verifies that the same user action produces the same key, and that the
 * time bucket window allows intentional reruns after it expires.
 */

import {
  generateIdempotencyKey,
  isSameIdempotencyKey,
  IDEMPOTENCY_WINDOW_SECONDS,
} from '@/core/domain/services/idempotencyKey';

describe('idempotencyKey', () => {
  const missionId = 'mission-1';
  const yardId = 'yard-1';
  const operatorId = 'op@example.com';
  const baseTime = new Date('2026-09-14T10:00:00.000Z');

  describe('generateIdempotencyKey', () => {
    it('generates the same key for the same mission, yard, and time bucket', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);
      const key2 = generateIdempotencyKey(
        missionId,
        yardId,
        operatorId,
        new Date(baseTime.getTime() + 2000), // 2 seconds later, same bucket
      );

      expect(isSameIdempotencyKey(key1, key2)).toBe(true);
    });

    it('generates different keys for different missions', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);
      const key2 = generateIdempotencyKey('mission-2', yardId, operatorId, baseTime);

      expect(isSameIdempotencyKey(key1, key2)).toBe(false);
    });

    it('generates different keys for different yards', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);
      const key2 = generateIdempotencyKey(missionId, 'yard-2', operatorId, baseTime);

      expect(isSameIdempotencyKey(key1, key2)).toBe(false);
    });

    it('generates different keys for different time buckets', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);
      const key2 = generateIdempotencyKey(
        missionId,
        yardId,
        operatorId,
        new Date(baseTime.getTime() + IDEMPOTENCY_WINDOW_SECONDS * 1000 + 1000), // Outside window
      );

      expect(isSameIdempotencyKey(key1, key2)).toBe(false);
    });

    it('handles missing operatorId gracefully', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, undefined, baseTime);
      const key2 = generateIdempotencyKey(missionId, yardId, '', baseTime);

      expect(isSameIdempotencyKey(key1, key2)).toBe(true);
    });

    it('is deterministic across multiple calls', () => {
      const key1 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);
      const key2 = generateIdempotencyKey(missionId, yardId, operatorId, baseTime);

      expect(key1).toBe(key2);
    });
  });

  describe('IDEMPOTENCY_WINDOW_SECONDS', () => {
    it('is 10 seconds', () => {
      expect(IDEMPOTENCY_WINDOW_SECONDS).toBe(10);
    });
  });
});
