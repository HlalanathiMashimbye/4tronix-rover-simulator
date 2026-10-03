/**
 * @jest-environment jsdom
 */

/**
 * The operator queue shows the newest waiting missions (3 Oct 2026).
 *
 * It read the OLDEST 50, so once more than 50 were waiting every new mission
 * was cut off: 54 were waiting at curiosity, untouched test missions from
 * 11 August among them, and the four newest - real children's work, visible
 * on the homepage - never reached the console. The operator chooses what to
 * run, so when the cap bites it is the stale end that should drop off, and
 * the console must say that it has.
 */

let snapshotDocs: { id: string; data: () => Record<string, unknown> }[] = [];

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  query: () => ({}),
  onSnapshot: (_q: unknown, next: (snap: { docs: typeof snapshotDocs }) => void) => {
    next({ docs: snapshotDocs });
    return () => {};
  },
}));
jest.mock('@/infrastructure/persistence/firebase-client', () => ({ getFirestoreClient: () => ({}) }));

import { subscribeToYardQueue, QUEUE_LIMIT } from '@/infrastructure/persistence/operatorQueueService';

const waiting = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    data: () => ({ name: `Mission ${i}`, code: '', status: 'queued', submittedAt: `2026-09-26T12:${String(i).padStart(2, '0')}:00Z` }),
  }));

describe('the queue query, at the cap', () => {
  it('says when older missions were left out, and shows only the cap', () => {
    snapshotDocs = waiting(QUEUE_LIMIT + 1);
    const onMissions = jest.fn();
    subscribeToYardQueue('curiosity', onMissions, () => {});
    const [missions, olderHidden] = onMissions.mock.calls[0];
    expect(missions).toHaveLength(QUEUE_LIMIT);
    expect(olderHidden).toBe(true);
  });

  it('says nothing is hidden when everything fits', () => {
    snapshotDocs = waiting(3);
    const onMissions = jest.fn();
    subscribeToYardQueue('curiosity', onMissions, () => {});
    expect(onMissions.mock.calls[0][1]).toBe(false);
  });
});
