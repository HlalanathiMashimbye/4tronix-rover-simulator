/**
 * findByIdPrefix: what a /missions/<name>-<prefix> link resolves through.
 * Driven through the admin SDK's shape, the simpler of the two to fake.
 */

import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';

type Doc = { id: string; data: () => Record<string, unknown> };

function fakeAdmin(docs: Doc[]) {
  const calls: { where: unknown[][]; limit?: number } = { where: [] };
  const q = {
    where: (...args: unknown[]) => { calls.where.push(args); return q; },
    limit: (n: number) => { calls.limit = n; return q; },
    get: async () => {
      // Apply the range the repository asked for, as Firestore would.
      const [lo, hi] = [calls.where[0][2] as string, calls.where[1][2] as string];
      return { docs: docs.filter((d) => d.id >= lo && d.id < hi).slice(0, calls.limit) };
    },
  };
  const db = { collection: () => q };
  return { db, calls };
}

const mission = (id: string, extra: Record<string, unknown> = {}): Doc => ({
  id,
  data: () => ({ name: 'x', code: '', status: 'completed', submittedAt: '2026-10-06T00:00:00Z', ...extra }),
});

it('asks for exactly the IDs that start with the prefix, capped', async () => {
  const { db, calls } = fakeAdmin([mission('jLSLqPa'), mission('jLSLqQz'), mission('jLSLqO1')]);
  const repo = new FirestoreMissionRepository(db as never);
  const found = await repo.findByIdPrefix('jLSLqP', 5);
  expect(found.map((m) => m.id)).toEqual(['jLSLqPa']);
  expect(calls.where[0]).toEqual(['__name__', '>=', 'jLSLqP']);
  expect(calls.where[1][0]).toBe('__name__');
  expect(calls.where[1][1]).toBe('<');
  expect(calls.limit).toBe(5);
});

it('leaves out a deleted mission, so its link stops working like its old one did', async () => {
  const { db } = fakeAdmin([mission('jLSLqPa', { deleted: true })]);
  const repo = new FirestoreMissionRepository(db as never);
  expect(await repo.findByIdPrefix('jLSLqP', 5)).toEqual([]);
});
