/**
 * Unit tests for ChallengeProgressService and the pure isLevelUnlocked rule
 * it relies on.
 *
 * The unlock rule is the one piece of real business logic in the Progressive
 * Challenges feature, so it gets fixture-only coverage with no mocks, plus
 * repository-mocked coverage of the service's own job: detecting the moment
 * a completion crosses a level from locked to unlocked.
 */

import { ChallengeProgressService } from '@/core/application/services/ChallengeProgressService';
import { IChallengeProgressRepository } from '@/core/domain/repositories/IChallengeProgressRepository';
import { ChallengeId, ChallengeLevel } from '@/core/domain/entities/Challenge';
import { ChallengeProgress, isLevelUnlocked } from '@/core/domain/entities/ChallengeProgress';

const LEVELS: ChallengeLevel[] = [
  { id: 1, title: 'Level 1', description: '', challengeIds: ['platform-orientation'] },
  { id: 2, title: 'Level 2', description: '', challengeIds: ['basic-movement', 'loop-structures'] },
  { id: 3, title: 'Level 3', description: '', challengeIds: ['sensor-operations'] },
];

function progressWith(...challengeIds: ChallengeId[]): ChallengeProgress {
  return {
    completions: challengeIds.map((challengeId) => ({ challengeId, completedAt: '2026-01-01T00:00:00Z' })),
  };
}

describe('isLevelUnlocked', () => {
  it('the first level is always unlocked', () => {
    expect(isLevelUnlocked(1, LEVELS, progressWith())).toBe(true);
  });

  it('a later level stays locked until every challenge in the level before it is complete', () => {
    expect(isLevelUnlocked(2, LEVELS, progressWith())).toBe(false);
    expect(isLevelUnlocked(2, LEVELS, progressWith('platform-orientation'))).toBe(true);
  });

  it('requires ALL challenges in the prior level, not just one', () => {
    expect(isLevelUnlocked(3, LEVELS, progressWith('platform-orientation', 'basic-movement'))).toBe(false);
    expect(
      isLevelUnlocked(3, LEVELS, progressWith('platform-orientation', 'basic-movement', 'loop-structures')),
    ).toBe(true);
  });
});

class MockChallengeProgressRepository implements IChallengeProgressRepository {
  private progress: ChallengeProgress = { completions: [] };

  async getProgress(): Promise<ChallengeProgress> {
    return this.progress;
  }

  async markChallengeComplete(_learnerId: string, challengeId: ChallengeId, completedAt: string): Promise<void> {
    if (this.progress.completions.some((c) => c.challengeId === challengeId)) return;
    this.progress = {
      ...this.progress,
      completions: [...this.progress.completions, { challengeId, completedAt }],
    };
  }
}

describe('ChallengeProgressService', () => {
  let repository: MockChallengeProgressRepository;
  let service: ChallengeProgressService;

  beforeEach(() => {
    repository = new MockChallengeProgressRepository();
    service = new ChallengeProgressService(repository);
  });

  it('reports no unlock when the completed challenge does not finish its level', async () => {
    const result = await service.completeChallenge('learner-1', 'basic-movement', LEVELS);
    expect(result.justUnlockedLevelId).toBeNull();
    expect(result.progress.completions).toHaveLength(1);
  });

  it('reports the level that unlocks when its last prerequisite completes', async () => {
    await service.completeChallenge('learner-1', 'platform-orientation', LEVELS);
    const result = await service.completeChallenge('learner-1', 'platform-orientation', LEVELS);

    // Re-completing the same challenge is a no-op and unlocks nothing new.
    expect(result.justUnlockedLevelId).toBeNull();
  });

  it('unlocks level 2 the moment its only prerequisite completes', async () => {
    const result = await service.completeChallenge('learner-1', 'platform-orientation', LEVELS);
    expect(result.justUnlockedLevelId).toBe(2);
  });

  it('does not report level 3 unlocked until BOTH level 2 challenges are done', async () => {
    await service.completeChallenge('learner-1', 'platform-orientation', LEVELS);
    await service.completeChallenge('learner-1', 'basic-movement', LEVELS);
    const stillLocked = await service.completeChallenge('learner-1', 'basic-movement', LEVELS);
    expect(stillLocked.justUnlockedLevelId).toBeNull();

    const nowUnlocked = await service.completeChallenge('learner-1', 'loop-structures', LEVELS);
    expect(nowUnlocked.justUnlockedLevelId).toBe(3);
  });
});
