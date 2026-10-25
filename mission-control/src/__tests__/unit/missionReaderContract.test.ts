/**
 * Both mission readers answer the same questions the same way.
 *
 * The server reads through the Admin SDK and the browser through the client
 * SDK, and a reader is only substitutable for the other if a caller cannot
 * tell which it got. Before the two were split, every repository test faked
 * the Admin shape, so the browser's half of each read had never run under a
 * test. One dataset, one set of expectations, both readers.
 */

import { AdminFirestoreMissionRepository } from '@/infrastructure/persistence/AdminFirestoreMissionRepository';
import { BrowserFirestoreMissionReader } from '@/infrastructure/persistence/BrowserFirestoreMissionReader';
import type { FirestoreMissionReader } from '@/infrastructure/persistence/FirestoreMissionReader';

type Data = Record<string, unknown>;

interface Store {
  missions: Map<string, Data>;
  runs: Map<string, Map<string, Data>>;
}

function store(): Store {
  const missions = new Map<string, Data>([
    ['m1', { yardId: 'curiosity', learnerRef: 'r', sessionId: 's', code: 'rover.stop()', status: 'completed', submittedAt: '2026-10-01T10:00:00Z' }],
    ['m2', { yardId: 'curiosity', learnerRef: 'r', sessionId: 's', code: 'rover.stop()', status: 'queued', submittedAt: '2026-10-02T10:00:00Z' }],
    ['m3', { yardId: 'curiosity', learnerRef: 'r', sessionId: 's', code: 'rover.stop()', status: 'queued', submittedAt: '2026-10-03T10:00:00Z', deleted: true }],
    ['m4', { yardId: 'curiosity', learnerRef: 'r', sessionId: 's', code: 'rover.stop()', status: 'queued', submittedAt: '2026-10-04T10:00:00Z' }],
    ['other', { yardId: 'curiosity', learnerRef: 'r', sessionId: 's', code: 'rover.stop()', status: 'queued', submittedAt: '2026-09-01T10:00:00Z' }],
  ]);
  const runs = new Map([
    ['m1', new Map<string, Data>([
      ['run-a', { yardId: 'curiosity', status: 'completed', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }],
      ['run-b', { yardId: 'curiosity', status: 'completed', deleted: true }],
    ])],
  ]);
  return { missions, runs };
}

const asDocs = (entries: Array<[string, Data]>) => entries.map(([id, data]) => ({ id, data: () => data }));

/** Newest first by submittedAt then id: the order the feed reads in. */
function recentOrder(entries: Array<[string, Data]>): Array<[string, Data]> {
  return [...entries].sort(([aId, a], [bId, b]) =>
    String(b.submittedAt).localeCompare(String(a.submittedAt)) || bId.localeCompare(aId));
}

function afterCursor(entries: Array<[string, Data]>, cursor: unknown[] | undefined) {
  if (!cursor) return entries;
  const [submittedAt, id] = cursor as [string, string];
  const at = entries.findIndex(([eid, d]) => d.submittedAt === submittedAt && eid === id);
  return entries.slice(at + 1);
}

/** Just enough of the Admin SDK's chained query API for the reads under test. */
function adminFirestore(s: Store) {
  const missionsQuery = (state: { start?: string; end?: string; ordered?: boolean; cursor?: unknown[]; max?: number }) => ({
    where: (_field: string, op: string, value: string) =>
      missionsQuery({ ...state, ...(op === '>=' ? { start: value } : { end: value }) }),
    orderBy: () => missionsQuery({ ...state, ordered: true }),
    startAfter: (...cursor: unknown[]) => missionsQuery({ ...state, cursor }),
    limit: (max: number) => missionsQuery({ ...state, max }),
    get: async () => {
      let entries = [...s.missions.entries()];
      if (state.start !== undefined) entries = entries.filter(([id]) => id >= state.start! && id < state.end!);
      if (state.ordered) entries = afterCursor(recentOrder(entries), state.cursor);
      return { docs: asDocs(entries.slice(0, state.max)) };
    },
    doc: (id: string) => ({
      get: async () => ({ exists: s.missions.has(id), data: () => s.missions.get(id) }),
      collection: () => ({ get: async () => ({ docs: asDocs([...(s.runs.get(id) ?? new Map()).entries()]) }) }),
    }),
  });
  return { collection: () => missionsQuery({}) };
}

// The browser SDK is a set of free functions over descriptors, so the fake
// builds descriptors and resolves them against the store passed as `db`.
jest.mock('firebase/firestore', () => {
  type Constraint = { type: string; op?: string; value?: unknown; cursor?: unknown[]; max?: number };
  const resolve = (s: Store, path: string[], constraints: Constraint[]) => {
    if (path.length === 3) return [...(s.runs.get(path[1]) ?? new Map()).entries()];
    let entries = [...s.missions.entries()];
    for (const c of constraints) {
      if (c.type === 'where') entries = entries.filter(([id]) => (c.op === '>=' ? id >= String(c.value) : id < String(c.value)));
    }
    if (constraints.some((c) => c.type === 'orderBy')) {
      entries = afterCursor(recentOrder(entries), constraints.find((c) => c.type === 'startAfter')?.cursor);
    }
    const max = constraints.find((c) => c.type === 'limit')?.max;
    return entries.slice(0, max);
  };
  return {
    collection: (db: Store, ...path: string[]) => ({ db, path, constraints: [] }),
    doc: (db: Store, ...path: string[]) => ({ db, path }),
    query: (col: { db: Store; path: string[] }, ...constraints: Constraint[]) => ({ ...col, constraints }),
    where: (_field: string, op: string, value: unknown) => ({ type: 'where', op, value }),
    documentId: () => '__name__',
    orderBy: () => ({ type: 'orderBy' }),
    startAfter: (...cursor: unknown[]) => ({ type: 'startAfter', cursor }),
    limit: (max: number) => ({ type: 'limit', max }),
    getDocs: async (q: { db: Store; path: string[]; constraints: Constraint[] }) => ({
      docs: resolve(q.db, q.path, q.constraints).map(([id, data]) => ({ id, data: () => data })),
    }),
    getDoc: async (ref: { db: Store; path: string[] }) => {
      const data = ref.db.missions.get(ref.path[1]);
      return { exists: () => data !== undefined, data: () => data };
    },
    updateDoc: async (ref: { db: Store; path: string[] }, fields: Data) => {
      ref.db.missions.set(ref.path[1], { ...ref.db.missions.get(ref.path[1]), ...fields });
    },
  };
});

const readers: Array<[string, (s: Store) => FirestoreMissionReader]> = [
  ['the Admin repository', (s) => new AdminFirestoreMissionRepository(adminFirestore(s) as never)],
  ['the browser reader', (s) => new BrowserFirestoreMissionReader(s as never)],
];

describe.each(readers)('%s', (_name, build) => {
  it('finds a mission by id, and a deleted or missing one as absent', async () => {
    const reader = build(store());

    expect((await reader.findById('m1'))?.status).toBe('completed');
    expect(await reader.findById('m3')).toBeNull();
    expect(await reader.findById('nope')).toBeNull();
  });

  it('pages the feed newest first, leaving out deleted missions', async () => {
    const reader = build(store());

    // The deleted m3 still takes a slot on its page: filtering it in the
    // query would need an index and a backfill, so a page can come up short.
    const first = await reader.findRecent(2);
    expect(first.missions.map((m) => m.id)).toEqual(['m4']);
    expect(first.nextCursor).toEqual({ submittedAt: '2026-10-04T10:00:00Z', id: 'm4' });

    const second = await reader.findRecent(2, first.nextCursor!);
    expect(second.missions.map((m) => m.id)).toEqual(['m2']);

    const last = await reader.findRecent(2, second.nextCursor!);
    expect(last.missions.map((m) => m.id)).toEqual(['m1', 'other']);
    expect(last.nextCursor).toBeNull();
  });

  it('resolves a link prefix to the live missions it matches', async () => {
    const reader = build(store());

    expect((await reader.findByIdPrefix('m', 10)).map((m) => m.id)).toEqual(['m1', 'm2', 'm4']);
  });

  it("lists a mission's runs without the deleted ones", async () => {
    const reader = build(store());

    const runs = await reader.findRuns('m1');
    expect(runs.map((r) => r.runId)).toEqual(['run-a']);
    expect(runs[0].youtubeUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(await reader.findRuns('m2')).toEqual([]);
  });
});

describe("the browser's one write", () => {
  it('stamps an email hash onto a mission that has none, once', async () => {
    const s = store();
    const reader = new BrowserFirestoreMissionReader(s as never);

    expect(await reader.stampLearnerEmailHash('m2', 'a'.repeat(64))).toBe(true);
    expect(s.missions.get('m2')?.learnerEmailHash).toBe('a'.repeat(64));
    // A second save of the same address must not send its queued email twice.
    expect(await reader.stampLearnerEmailHash('m2', 'b'.repeat(64))).toBe(false);
    expect(s.missions.get('m2')?.learnerEmailHash).toBe('a'.repeat(64));
    expect(await reader.stampLearnerEmailHash('nope', 'a'.repeat(64))).toBe(false);
  });
});
