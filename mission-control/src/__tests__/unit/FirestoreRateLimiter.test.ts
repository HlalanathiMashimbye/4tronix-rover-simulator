/**
 * The fixed-window counter behind the public routes' rate limits.
 *
 * Driven against an in-memory stand-in for Firestore and a hand-wound clock,
 * so the window boundary and the fail-open path are exercised without a real
 * database. The transaction is modelled as a plain read-then-write, which is
 * all the counter needs of it here.
 */

import { FirestoreRateLimiter } from '@/infrastructure/persistence/FirestoreRateLimiter';

type Doc = { windowIndex: number; count: number };

/** A Firestore stand-in: one map of docs, a runTransaction that reads then
 * writes. `now` is wound by the test. */
function fakeFirestore(clock: { ms: number }) {
  const store = new Map<string, Doc>();
  const db = {
    store,
    collection: () => ({ doc: (id: string) => ({ id }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<boolean>) =>
      fn({
        get: async (ref: { id: string }) => ({
          exists: store.has(ref.id),
          data: () => store.get(ref.id),
        }),
        set: (ref: { id: string }, data: Partial<Doc>, options?: { merge?: boolean }) => {
          const next = options?.merge ? { ...(store.get(ref.id) ?? {}), ...data } : data;
          store.set(ref.id, next as Doc);
        },
      }),
  };
  return { db, now: () => clock.ms };
}

describe('FirestoreRateLimiter', () => {
  it('allows up to the limit in a window and refuses the rest', async () => {
    const clock = { ms: 0 };
    const { db, now } = fakeFirestore(clock);
    const limiter = new FirestoreRateLimiter(db as never, now);

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await limiter.allow('ip:1.2.3.4', 3, 60));
    }

    expect(results).toEqual([true, true, true, false]);
  });

  it('starts a fresh count in the next window', async () => {
    const clock = { ms: 0 };
    const { db, now } = fakeFirestore(clock);
    const limiter = new FirestoreRateLimiter(db as never, now);

    expect(await limiter.allow('k', 1, 60)).toBe(true);
    expect(await limiter.allow('k', 1, 60)).toBe(false);

    clock.ms = 60_000; // the next 60-second window
    expect(await limiter.allow('k', 1, 60)).toBe(true);
  });

  it('keeps each key to its own count', async () => {
    const clock = { ms: 0 };
    const { db, now } = fakeFirestore(clock);
    const limiter = new FirestoreRateLimiter(db as never, now);

    expect(await limiter.allow('a', 1, 60)).toBe(true);
    expect(await limiter.allow('a', 1, 60)).toBe(false);
    // A different key is untouched by the first key's flood.
    expect(await limiter.allow('b', 1, 60)).toBe(true);
  });

  it('fails open when the store cannot be reached', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const brokenDb = {
      collection: () => ({ doc: () => ({ id: 'k' }) }),
      runTransaction: async () => {
        throw new Error('Firestore unreachable');
      },
    };
    const limiter = new FirestoreRateLimiter(brokenDb as never, () => 0);

    // A counter outage must not stop a child submitting a mission.
    expect(await limiter.allow('k', 1, 60)).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
