/**
 * The live queue subscription (AB#376).
 *
 * The failure that matters here is silence: a listener that errors or filters
 * wrongly renders an empty queue, and an empty queue looks exactly like a
 * working one with nothing in it.
 */

const onSnapshot = jest.fn();
const where = jest.fn((...args: unknown[]) => ({ _where: args }));
const orderBy = jest.fn((...args: unknown[]) => ({ _orderBy: args }));
const limitFn = jest.fn((n: number) => ({ _limit: n }));
const query = jest.fn((...args: unknown[]) => ({ _query: args }));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({ _collection: 'missions' })),
  query: (...args: unknown[]) => query(...args),
  where: (...args: unknown[]) => where(...args),
  orderBy: (...args: unknown[]) => orderBy(...args),
  limit: (n: number) => limitFn(n),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
}));

jest.mock('@/infrastructure/persistence/firebase-client', () => ({ getFirestoreClient: () => ({}) }));

import {
  subscribeToYardQueue,
  ACTIVE_STATUSES,
  QUEUE_LIMIT,
} from '@/infrastructure/persistence/operatorQueueService';

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

/** Drive the success callback onSnapshot was registered with. */
function emit(docs: ReturnType<typeof doc>[]) {
  onSnapshot.mock.calls[0][1]({ docs });
}

/** Drive the error callback. */
function fail(error: Error) {
  onSnapshot.mock.calls[0][2](error);
}

beforeEach(() => {
  jest.clearAllMocks();
  onSnapshot.mockReturnValue(() => {});
  // The service logs listener failures on purpose; keep it out of test output.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the query', () => {
  it('scopes to the yard and to work that still needs an operator', () => {
    subscribeToYardQueue('curiosity', () => {}, () => {});

    expect(where).toHaveBeenCalledWith('yardId', '==', 'curiosity');
    expect(where).toHaveBeenCalledWith('status', 'in', ACTIVE_STATUSES);
    expect(ACTIVE_STATUSES).toEqual(['queued', 'processing']);
  });

  it('is bounded, because a listener re-reads everything on attach', () => {
    subscribeToYardQueue('curiosity', () => {}, () => {});
    expect(limitFn).toHaveBeenCalledWith(QUEUE_LIMIT);
  });

  it('orders oldest first, which is the order a queue is worked', () => {
    subscribeToYardQueue('curiosity', () => {}, () => {});
    expect(orderBy).toHaveBeenCalledWith('submittedAt', 'asc');
  });

  it('returns the unsubscribe handle so a yard switch tears down', () => {
    const unsub = jest.fn();
    onSnapshot.mockReturnValue(unsub);
    expect(subscribeToYardQueue('curiosity', () => {}, () => {})).toBe(unsub);
  });
});

describe('what reaches the operator', () => {
  it('leaves out soft-deleted missions', () => {
    // An operator removed it on purpose. Showing it back as work waiting would
    // undo that decision by accident.
    const seen: unknown[] = [];
    subscribeToYardQueue('curiosity', (m) => seen.push(...m), () => {});

    emit([
      doc('keep', { status: 'queued', code: 'x' }),
      doc('gone', { status: 'queued', code: 'x', deleted: true }),
    ]);

    expect(seen).toHaveLength(1);
    expect((seen[0] as { id: string }).id).toBe('keep');
  });

  it('carries the review flag and its reason through', () => {
    let got: { needsReview?: boolean; reviewReason?: string | null }[] = [];
    subscribeToYardQueue('curiosity', (m) => { got = m; }, () => {});

    emit([doc('m1', {
      status: 'queued', code: 'x', needsReview: true, reviewReason: 'rover unreachable',
    })]);

    expect(got[0].needsReview).toBe(true);
    expect(got[0].reviewReason).toBe('rover unreachable');
  });

  it('defaults a missing reason to null rather than undefined', () => {
    let got: { reviewReason?: string | null }[] = [];
    subscribeToYardQueue('curiosity', (m) => { got = m; }, () => {});
    emit([doc('m1', { status: 'queued', code: 'x', needsReview: true })]);
    expect(got[0].reviewReason).toBeNull();
  });

  it('survives a mission with no code', () => {
    let got: { code: string }[] = [];
    subscribeToYardQueue('curiosity', (m) => { got = m; }, () => {});
    emit([doc('m1', { status: 'queued' })]);
    expect(got[0].code).toBe('');
  });
});

describe('failure is reported, never rendered as quiet', () => {
  it('routes a listener error to onError and not to onMissions', () => {
    const onMissions = jest.fn();
    const onError = jest.fn();
    subscribeToYardQueue('curiosity', onMissions, onError);

    fail(new Error('permission-denied'));

    expect(onError).toHaveBeenCalled();
    // The caller must be able to say "this is broken" rather than showing an
    // empty queue, which is what a yard-id mismatch looked like on the
    // satellite for weeks.
    expect(onMissions).not.toHaveBeenCalled();
  });
});

describe('anonymity', () => {
  it('carries no learner field at all, not even the hash', () => {
    // AB#377 asked the queue to show who submitted. That cuts against the
    // model the platform has held to from the start, so the queue takes
    // nothing about the learner off the document - including learnerRef, which
    // is a one-way hash and would have been harmless. If a future change wants
    // it, this test should make them argue for it first.
    let got: Record<string, unknown>[] = [];
    subscribeToYardQueue('curiosity', (m) => { got = m as unknown as Record<string, unknown>[]; }, () => {});

    emit([doc('m1', {
      status: 'queued',
      code: 'x',
      name: 'Rock Lover',
      learnerRef: 'a-one-way-hash',
      sessionId: 'a-session-id',
      learnerEmailHash: 'an-email-hash',
    })]);

    const keys = Object.keys(got[0]);
    expect(keys).not.toContain('learnerRef');
    expect(keys).not.toContain('sessionId');
    expect(keys).not.toContain('learnerEmailHash');
    expect(keys.some((k) => /learner|session|email/i.test(k))).toBe(false);
  });

  it('keeps the mission name, which is the handle an operator needs', () => {
    // A child says "mine is Rock Lover" and the operator finds that row,
    // having learned nothing about them.
    let got: { name?: string }[] = [];
    subscribeToYardQueue('curiosity', (m) => { got = m; }, () => {});
    emit([doc('m1', { status: 'queued', code: 'x', name: 'Rock Lover' })]);
    expect(got[0].name).toBe('Rock Lover');
  });
});
