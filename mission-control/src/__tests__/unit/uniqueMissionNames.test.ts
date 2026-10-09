/**
 * Mission names never repeat (David, 8 October 2026).
 *
 * Names used to be random, from 8,000, so repeats were certain once a few
 * hundred missions existed. Now each mission takes the next number from a
 * counter and missionNameForNumber turns it into words one-to-one. These check
 * the mapping really is one-to-one, that it never hands out a name an older
 * mission may carry, and that the Firestore registry walks the counter
 * without skipping back or handing a name out twice.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  MISSION_NAME_COMBINATIONS,
  allGeneratedMissionNames,
  missionNameForNumber,
} from '@/core/domain/services/missionNameGenerator';
import { FirestoreMissionNameRegistry } from '@/infrastructure/persistence/FirestoreMissionNameRegistry';

const handedOut = () =>
  Array.from({ length: MISSION_NAME_COMBINATIONS }, (_, n) => missionNameForNumber(n)).filter(
    (name): name is string => name !== null,
  );

describe('the number to name mapping', () => {
  it('gives every number its own name', () => {
    const names = handedOut();
    expect(new Set(names).size).toBe(names.length);
  });

  it('hands out every combination except the 8,000 the random names came from', () => {
    expect(MISSION_NAME_COMBINATIONS).toBe(32 ** 3);
    const names = handedOut();
    expect(names).toHaveLength(MISSION_NAME_COMBINATIONS - 20 ** 3);
    const vocabulary = new Set(allGeneratedMissionNames());
    expect(names.every((name) => vocabulary.has(name))).toBe(true);
  });

  it('never hands out a name an older mission may carry', () => {
    // Real names off live missions, from the original twenty words of each list.
    const names = new Set(handedOut());
    for (const old of ['Swift Helios Explorer', 'Curious Rock Seeker', 'Lucky Solar Sentinel', 'Sunny Peak Traveler']) {
      expect(names.has(old)).toBe(false);
    }
  });

  it('changes at least two of the three words from one mission to the next', () => {
    const names = Array.from({ length: 400 }, (_, n) => missionNameForNumber(n)).filter((n): n is string => n !== null);
    for (let i = 1; i < names.length; i++) {
      const [a, b] = [names[i - 1].split(' '), names[i].split(' ')];
      expect(a.filter((word, j) => word === b[j]).length).toBeLessThanOrEqual(1);
    }
  });

  it('has nothing past the last combination', () => {
    expect(missionNameForNumber(MISSION_NAME_COMBINATIONS)).toBeNull();
    expect(missionNameForNumber(-1)).toBeNull();
    expect(missionNameForNumber(1.5)).toBeNull();
  });
});

/**
 * Just enough of the Admin SDK: documents in a map, and a transaction whose
 * writes land together when it finishes, as Firestore's do.
 */
function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (collection: string, id: string) => ({ path: `${collection}/${id}` });
  const db = {
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Record<string, unknown>, boolean][] = [];
      const tx = {
        get: async ({ path }: { path: string }) => ({ exists: docs.has(path), data: () => docs.get(path) }),
        set: ({ path }: { path: string }, data: Record<string, unknown>) => writes.push([path, data, false]),
        create: ({ path }: { path: string }, data: Record<string, unknown>) => writes.push([path, data, true]),
      };
      const result = await fn(tx);
      for (const [path, data, mustBeNew] of writes) {
        if (mustBeNew && docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        docs.set(path, data);
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, docs };
}

describe('the Firestore registry', () => {
  it('hands out names in counter order and moves the counter past each', async () => {
    const { db, docs } = fakeFirestore();
    const registry = new FirestoreMissionNameRegistry(db);
    const expected = handedOut();

    const numberOf = (name: string) => Array.from({ length: 2000 }, (_, n) => n).find((n) => missionNameForNumber(n) === name)!;
    const counter = () => (docs.get('counters/missionNames') as { next: number }).next;

    expect(await registry.takeNext()).toBe(expected[0]);
    expect(counter()).toBe(numberOf(expected[0]) + 1);
    expect(await registry.takeNext()).toBe(expected[1]);
    expect(counter()).toBe(numberOf(expected[1]) + 1);
    expect(docs.has(`missionNames/${expected[0]}`)).toBe(true);
  });

  it('carries on from where the counter is, not from the start', async () => {
    const { db } = fakeFirestore({ 'counters/missionNames': { next: 1000 } });
    const first = await new FirestoreMissionNameRegistry(db).takeNext();
    const n = Array.from({ length: MISSION_NAME_COMBINATIONS }, (_, i) => i).find((i) => missionNameForNumber(i) === first)!;
    expect(n).toBeGreaterThanOrEqual(1000);
  });

  it('skips a name that already has a record, rather than handing it out again', async () => {
    // What an edit in the middle of a word list would cause: a number whose
    // name an earlier number already produced.
    const [first, second] = handedOut();
    const { db } = fakeFirestore({ [`missionNames/${first}`]: { takenAt: 'earlier' } });
    expect(await new FirestoreMissionNameRegistry(db).takeNext()).toBe(second);
  });

  it('never hands out the same name twice', async () => {
    const { db } = fakeFirestore();
    const registry = new FirestoreMissionNameRegistry(db);
    const names = [];
    for (let i = 0; i < 300; i++) names.push(await registry.takeNext());
    expect(new Set(names).size).toBe(300);
  });

  it('says so when every name has gone', async () => {
    const { db } = fakeFirestore({ 'counters/missionNames': { next: MISSION_NAME_COMBINATIONS } });
    await expect(new FirestoreMissionNameRegistry(db).takeNext()).rejects.toThrow(/append words/);
  });
});
