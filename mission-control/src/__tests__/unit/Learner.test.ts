/**
 * Unit Tests: Learner Entity
 */

import { createAnonymousLearner } from '@/core/domain/entities/Learner';

describe('Learner Entity', () => {
  describe('createAnonymousLearner', () => {
    it('uses the learner id as both the id and the session id', () => {
      const learner = createAnonymousLearner('test-session-123');

      expect(learner.id).toBe('test-session-123');
      expect(learner.sessionId).toBe('test-session-123');
    });

    it('assigns a random avatar color', () => {
      const learner = createAnonymousLearner('test-123');

      expect(learner.avatarColor).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('sets timestamps correctly', () => {
      const before = new Date().getTime();
      const learner = createAnonymousLearner('test-123');
      const after = new Date().getTime();

      const createdTime = new Date(learner.createdAt).getTime();

      expect(createdTime).toBeGreaterThanOrEqual(before);
      expect(createdTime).toBeLessThanOrEqual(after);
      expect(learner.lastActiveAt).toBe(learner.createdAt);
    });

    it('carries nothing that collects personal data', () => {
      // Learners are anonymous by design: no name, no address on creation.
      const learner = createAnonymousLearner('test-123');

      expect(learner).not.toHaveProperty('displayName');
      expect(learner).not.toHaveProperty('learnerEmail');
    });
  });
});
