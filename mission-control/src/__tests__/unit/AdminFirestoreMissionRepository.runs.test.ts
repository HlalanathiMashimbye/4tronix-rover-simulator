/**
 * Reading and writing per-yard runs.
 *
 * The repository is dual-SDK: the browser reads runs to build the learner's
 * yard selector, the server writes them. These exercise the admin path, which
 * is the one that writes.
 */

import { AdminFirestoreMissionRepository } from '@/infrastructure/persistence/AdminFirestoreMissionRepository';
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

    const runs = await new AdminFirestoreMissionRepository(firestore).findRuns('m1');

    expect(runs.map((r) => r.yardId)).toEqual(['curiosity', 'durban-1']);
    expect(runs[0].youtubeUrl).toBe('https://youtu.be/a');
  });

  it('takes the runId from the document id, not a stored field', async () => {
    // The id IS the runId. A stale or wrong runId field must never win, or a
    // run could be confused with another execution attempt.
    const { firestore } = adminFirestore([
      { id: 'run-id-1', data: { runId: 'wrong-id', yardId: 'curiosity', status: 'completed' } },
    ]);

    const runs = await new AdminFirestoreMissionRepository(firestore).findRuns('m1');

    expect(runs[0].runId).toBe('run-id-1');
  });

  it('returns an empty list for a mission nobody has run', async () => {
    // Ordinary, not missing data: every mission submitted before runs existed
    // is in exactly this state until the backfill runs.
    const { firestore } = adminFirestore([]);

    expect(await new AdminFirestoreMissionRepository(firestore).findRuns('m1')).toEqual([]);
  });

  it('defaults a run with no status to queued rather than throwing', async () => {
    const { firestore } = adminFirestore([{ id: 'curiosity', data: {} }]);

    expect((await new AdminFirestoreMissionRepository(firestore).findRuns('m1'))[0].status).toBe('queued');
  });
});

describe('applyBookkeeping', () => {
  // What one batch writes to the run and to its mission, by document.
  function bookkeepingFirestore() {
    const writes: Array<{ doc: string; fields: Record<string, unknown> }> = [];
    const commit = jest.fn(async () => {});
    const docRef = (path: string) => ({
      path,
      collection: (sub: string) => ({ doc: (id: string) => docRef(`${path}/${sub}/${id}`) }),
    });
    const firestore = {
      collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
      batch: () => ({
        set: (ref: { path: string }, fields: Record<string, unknown>) => writes.push({ doc: ref.path, fields }),
        commit,
      }),
    } as unknown as AdminFirestore;
    const fieldsOf = (doc: string) => writes.find((w) => w.doc === doc)?.fields;
    return { firestore, commit, fieldsOf };
  }

  const decided = { decidedAt: '2026-10-25T10:00:00Z', decidedBy: 'op@example.com' };

  it('takes a video off by writing null to both the run and the mission, not by writing nothing', async () => {
    // An absent value is indistinguishable from "leave it alone", so a removal
    // that wrote nothing would leave the video on the learner's page.
    const { firestore, fieldsOf } = bookkeepingFirestore();

    await new AdminFirestoreMissionRepository(firestore).applyBookkeeping('m1', 'run-1', 'curiosity', { clearsVideo: true, ...decided });

    expect(fieldsOf('missions/m1/runs/run-1')).toMatchObject({ youtubeUrl: null });
    expect(fieldsOf('missions/m1')).toMatchObject({ youtubeUrl: null });
  });

  it('stamps completedAt on both documents only when completing', async () => {
    const { firestore, fieldsOf, commit } = bookkeepingFirestore();
    const repository = new AdminFirestoreMissionRepository(firestore);

    await repository.applyBookkeeping('m1', 'run-1', 'curiosity', { status: 'completed', ...decided });
    expect(fieldsOf('missions/m1/runs/run-1')).toMatchObject({ status: 'completed', completedAt: decided.decidedAt });
    expect(fieldsOf('missions/m1')).toMatchObject({ status: 'completed', completedAt: decided.decidedAt });
    expect(commit).toHaveBeenCalledTimes(1);

    const cancel = bookkeepingFirestore();
    await new AdminFirestoreMissionRepository(cancel.firestore).applyBookkeeping('m1', 'run-1', 'curiosity', { status: 'cancelled', ...decided });
    expect(cancel.fieldsOf('missions/m1')).not.toHaveProperty('completedAt');
  });

  it("writes an operator's note to the run only", async () => {
    // A second yard's run must not inherit a note written about the first.
    const { firestore, fieldsOf } = bookkeepingFirestore();

    await new AdminFirestoreMissionRepository(firestore).applyBookkeeping('m1', 'run-1', 'curiosity', { feedback: 'Nice square!', ...decided });

    expect(fieldsOf('missions/m1/runs/run-1')).toMatchObject({ feedback: 'Nice square!', feedbackBy: decided.decidedBy });
    expect(fieldsOf('missions/m1')).toBeUndefined();
  });
});
