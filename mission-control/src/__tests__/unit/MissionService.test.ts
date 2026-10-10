/**
 * Unit Tests for MissionService
 *
 * Tests business logic layer in isolation using mocked repository.
 * Demonstrates Repository pattern benefits for testability.
 */

import { MissionService } from '@/core/application/services/MissionService';
import {
  IMissionReader,
  IMissionWriter,
  MissionCursor,
  MissionPage,
} from '@/core/domain/repositories/IMissionRepository';
import { Mission } from '@/core/domain/entities/Mission';
import { CreateMissionDto } from '@/core/application/dto/mission';
import type { IMissionNameRegistry } from '@/core/domain/repositories/IMissionNameRegistry';

/** The registry's contract without Firestore: a name is taken once, and the next free one is "Name N". */
class InMemoryNameRegistry implements IMissionNameRegistry {
  readonly taken = new Set<string>();
  private counter = 0;
  async claim(name: string): Promise<boolean> {
    if (this.taken.has(name)) return false;
    this.taken.add(name);
    return true;
  }
  async takeNext(): Promise<string> {
    const name = `Name ${++this.counter}`;
    this.taken.add(name);
    return name;
  }
}

class MockMissionRepository implements IMissionReader, IMissionWriter {
  private missions: Map<string, Mission> = new Map();
  private idCounter = 0;

  async create(mission: Omit<Mission, 'id' | 'queuePosition' | 'estimatedWait'>): Promise<Mission> {
    const id = `mock-id-${++this.idCounter}`;
    const newMission: Mission = {
      ...mission,
      id,
    };
    this.missions.set(id, newMission);
    return newMission;
  }

  async findById(id: string): Promise<Mission | null> {
    return this.missions.get(id) || null;
  }

  async findByLearnerId(learnerRef: string): Promise<Mission[]> {
    return Array.from(this.missions.values())
      .filter((m) => m.learnerRef === learnerRef)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async findBySessionId(sessionId: string): Promise<Mission[]> {
    return Array.from(this.missions.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getQueuedMissions(yardId: string): Promise<Mission[]> {
    return Array.from(this.missions.values())
      .filter((m) => m.yardId === yardId && m.status === 'queued')
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  }

  async update(id: string, updates: Partial<Mission>): Promise<Mission | null> {
    const mission = this.missions.get(id);
    if (!mission) return null;

    const updated = { ...mission, ...updates };
    this.missions.set(id, updated);
    return updated;
  }

  async getQueueLength(yardId: string): Promise<number> {
    return Array.from(this.missions.values()).filter(
      (m) => m.yardId === yardId && m.status === 'queued'
    ).length;
  }

  // Part of IMissionReader. The four run-bookkeeping stubs that used to sit
  // here are gone: MissionService is typed against the reader and writer only,
  // so a mock of it no longer has to pretend to delete anything.
  async findRuns() { return []; }

  async findByIdPrefix(prefix: string, max: number): Promise<Mission[]> {
    return [...this.missions.values()].filter((m) => m.id.startsWith(prefix)).slice(0, max);
  }

  async findRecent(limit: number, cursor?: MissionCursor): Promise<MissionPage> {
    const ordered = Array.from(this.missions.values()).sort((a, b) => {
      const byDate = b.submittedAt.localeCompare(a.submittedAt);
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    });

    const start = cursor
      ? ordered.findIndex((m) => m.submittedAt === cursor.submittedAt && m.id === cursor.id) + 1
      : 0;
    const page = ordered.slice(start, start + limit);
    const last = page[page.length - 1];

    return {
      missions: page,
      nextCursor:
        start + limit < ordered.length && last
          ? { submittedAt: last.submittedAt, id: last.id }
          : null,
    };
  }

  async findAll(): Promise<Mission[]> {
    return Array.from(this.missions.values()).sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt)
    );
  }

  clear() {
    this.missions.clear();
  }
}

/**
 * Build a fully-typed CreateMissionDto, filling required fields with defaults
 * so individual tests only specify what they care about.
 */
const makeDto = (
  overrides: Partial<CreateMissionDto> & { yardId: string; code: string }
): CreateMissionDto => ({
  learnerId: 'learner-123',
  sessionId: 'session-123',
  // Rolled by the dice: "Comet" is one of the words added with unique names.
  name: 'Swift Comet Explorer',
  ...overrides,
});

describe('MissionService', () => {
  let service: MissionService;
  let repository: MockMissionRepository;
  let names: InMemoryNameRegistry;

  beforeEach(() => {
    repository = new MockMissionRepository();
    names = new InMemoryNameRegistry();
    service = new MissionService(repository, names);
  });

  describe('naming', () => {
    const send = (name: string) => service.submitMission(makeDto({ yardId: 'yard-1', code: 'rover.forward(60)', name }));

    it('keeps the name the learner rolled when no mission has it', async () => {
      expect((await send('Brave Nebula Scout')).mission?.name).toBe('Brave Nebula Scout');
    });

    it('never gives two missions the same name, even when they rolled the same one', async () => {
      const first = await send('Brave Nebula Scout');
      const second = await send('Brave Nebula Scout');

      expect(first.mission?.name).toBe('Brave Nebula Scout');
      expect(second.mission?.name).toBe('Name 1');
    });

    it('does not let a mission keep a name made only of the original words', async () => {
      // An older mission may carry it, from before names were recorded, so it
      // is never claimed: a stale tab still sends, under the next free name.
      const result = await send('Swift Helios Explorer');

      expect(result.mission?.name).toBe('Name 1');
      expect(names.taken.has('Swift Helios Explorer')).toBe(false);
    });

    it('does not claim free text, should any get past the schema', async () => {
      expect((await send('meet me at the gate')).mission?.name).toBe('Name 1');
    });
  });

  describe('submitMission', () => {
    it('should successfully submit a mission', async () => {
      const result = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.forward(100)' })
      );

      expect(result.success).toBe(true);
      expect(result.mission).toBeDefined();
      expect(result.mission?.yardId).toBe('yard-1');
      // The raw id must NOT survive onto the mission - only its hash. Mission
      // documents are world-readable, and publishing the id is what made
      // possession of one meaningless.
      expect(result.mission?.learnerRef).not.toBe('learner-123');
      expect(result.mission?.learnerRef).toMatch(/^[0-9a-f]{64}$/);
      expect(result.mission?.code).toBe('rover.forward(100)');
      expect(result.mission?.status).toBe('queued');
      expect(result.mission?.id).toBeDefined();
    });

    it('should submit a minimal mission', async () => {
      const result = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.spinLeft(50)' })
      );

      expect(result.success).toBe(true);
      expect(result.mission?.code).toBe('rover.spinLeft(50)');
    });

    it('should set initial status to queued', async () => {
      const result = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.forward(100)' })
      );

      expect(result.mission?.status).toBe('queued');
    });

    it('carries a Progressive Challenges origin/challengeId onto the mission', async () => {
      const result = await service.submitMission(
        makeDto({
          yardId: 'yard-1',
          code: 'rover.forward(100)',
          origin: 'challenge',
          challengeId: 'basic-movement',
        })
      );

      expect(result.mission?.origin).toBe('challenge');
      expect(result.mission?.challengeId).toBe('basic-movement');
    });

    it('leaves origin/challengeId unset for a freeform mission', async () => {
      const result = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.forward(100)' })
      );

      expect(result.mission?.origin).toBeUndefined();
      expect(result.mission?.challengeId).toBeUndefined();
    });

  });

  describe('getMissionById', () => {
    it('should retrieve existing mission', async () => {
      const submitted = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.forward(100)' })
      );
      const retrieved = await service.getMissionById(submitted.mission!.id);

      expect(retrieved).toEqual(submitted.mission);
    });

    it('should return null for non-existent mission', async () => {
      const retrieved = await service.getMissionById('non-existent-id');

      expect(retrieved).toBeNull();
    });
  });

  describe('updateMission', () => {
    it('should update mission status', async () => {
      const submitted = await service.submitMission(
        makeDto({ yardId: 'yard-1', code: 'rover.forward(100)' })
      );

      const updated = await service.updateMission(submitted.mission!.id, {
        status: 'processing',
        startedAt: new Date().toISOString(),
      });

      expect(updated?.status).toBe('processing');
      expect(updated?.startedAt).toBeDefined();
    });

    it('should return null for non-existent mission', async () => {
      const updated = await service.updateMission('non-existent-id', {
        status: 'completed',
      });

      expect(updated).toBeNull();
    });
  });
});
