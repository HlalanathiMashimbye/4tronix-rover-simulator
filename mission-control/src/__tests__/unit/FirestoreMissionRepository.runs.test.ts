/**
 * Reading and writing per-yard runs.
 *
 * The repository is dual-SDK: the browser reads runs to build the learner's
 * yard selector, the server writes them. These exercise the admin path, which
 * is the one that writes.
 */

import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';

jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'testmissionid12345') }));

let runIdCounter = 0;
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => `run-id-${++runIdCounter}`),
}));

function adminFirestore(runDocs: Array<{ id: string; data: Record<string, unknown> }>) {
  const set = jest.fn(
    async (_payload: Record<string, unknown>, _options?: { merge?: boolean }) => undefined,
  );
  const runsGet = jest.fn(async () => ({
    docs: runDocs.map((d) => ({ id: d.id, data: () => d.data })),
  }));
  const runDoc = jest.fn((_runId: string) => ({ set }));
  const runsCollection = jest.fn(() => ({ get: runsGet, doc: runDoc }));

  const firestore = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ collection: runsCollection })),
    })),
  } as unknown as AdminFirestore;

  return { firestore, set, runDoc, runsCollection };
}

describe('findRuns', () => {
  it('reads every yard that attempted the mission', async () => {
    const { firestore } = adminFirestore([
      { id: 'run-id-1', data: { yardId: 'curiosity', status: 'completed', youtubeUrl: 'https://youtu.be/a' } },
      { id: 'run-id-2', data: { yardId: 'durban-1', status: 'processing' } },
    ]);

    const runs = await new FirestoreMissionRepository(firestore).findRuns('m1');

    expect(runs.map((r) => r.yardId)).toEqual(['curiosity', 'durban-1']);
    expect(runs[0].youtubeUrl).toBe('https://youtu.be/a');
  });

  it('takes the runId from the document id, not a stored field', async () => {
    // The id IS the runId. A stale or wrong runId field must never win, or a
    // run could be confused with another execution attempt.
    const { firestore } = adminFirestore([
      { id: 'run-id-1', data: { runId: 'wrong-id', yardId: 'curiosity', status: 'completed' } },
    ]);

    const runs = await new FirestoreMissionRepository(firestore).findRuns('m1');

    expect(runs[0].runId).toBe('run-id-1');
  });

  it('returns an empty list for a mission nobody has run', async () => {
    // Ordinary, not missing data: every mission submitted before runs existed
    // is in exactly this state until the backfill runs.
    const { firestore } = adminFirestore([]);

    expect(await new FirestoreMissionRepository(firestore).findRuns('m1')).toEqual([]);
  });

  it('defaults a run with no status to queued rather than throwing', async () => {
    const { firestore } = adminFirestore([{ id: 'curiosity', data: {} }]);

    expect((await new FirestoreMissionRepository(firestore).findRuns('m1'))[0].status).toBe('queued');
  });
});

describe('upsertRun', () => {
  it('writes to the run document and merges', async () => {
    // Merge matters: the video is attached minutes after the run finishes, so
    // a later status write must not wipe a youtubeUrl set earlier.
    const { firestore, set, runDoc } = adminFirestore([]);

    await new FirestoreMissionRepository(firestore).upsertRun('m1', {
      runId: 'run-id-1',
      yardId: 'curiosity',
      status: 'completed',
      completedAt: '2026-08-27T10:00:00Z',
    });

    expect(runDoc).toHaveBeenCalledWith('run-id-1');
    const [payload, options] = set.mock.calls[0];
    expect(options).toEqual({ merge: true });
    expect(payload).toMatchObject({ yardId: 'curiosity', status: 'completed' });
  });

  it('strips undefined fields so they do not land in Firestore', async () => {
    const { firestore, set } = adminFirestore([]);

    await new FirestoreMissionRepository(firestore).upsertRun('m1', {
      runId: 'run-id-1',
      yardId: 'curiosity',
      status: 'queued',
      youtubeUrl: undefined,
      completedAt: undefined,
    });

    const [payload] = set.mock.calls[0];
    expect(payload).not.toHaveProperty('youtubeUrl');
    expect(payload).not.toHaveProperty('completedAt');
  });

  it('writes each run to its own document, so two yards can run the same mission concurrently', async () => {
    // Each run has a unique runId, so concurrent attempts from different yards
    // never overwrite each other.
    const { firestore, runDoc } = adminFirestore([]);
    const repository = new FirestoreMissionRepository(firestore);

    await repository.upsertRun('m1', { runId: 'run-id-1', yardId: 'curiosity', status: 'processing' });
    await repository.upsertRun('m1', { runId: 'run-id-2', yardId: 'durban-1', status: 'processing' });

    expect(runDoc.mock.calls.map((c) => c[0])).toEqual(['run-id-1', 'run-id-2']);
  });
});
