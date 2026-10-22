/**
 * Mission names never repeat (David, 8 October 2026).
 *
 * Names used to be random, from 8,000, and kept whatever they were, so
 * repeats were certain once a few hundred missions existed. Now the roll is
 * still free and still random, and the name is made unique at the one moment
 * it is taken: the registry lets exactly one mission claim it, and gives a
 * mission that lost the next name from a counter. These check the roll only
 * offers names a new mission may take, that a claim can be won once, and that
 * the counter's names are one-to-one and never ones an older mission carries.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  MISSION_NAME_COMBINATIONS,
  allGeneratedMissionNames,
  isNewMissionName,
  missionNameForNumber,
  rollMissionName,
} from '@/core/domain/services/missionNameGenerator';
import { FirestoreMissionNameRegistry } from '@/infrastructure/persistence/FirestoreMissionNameRegistry';

const handedOut = () =>
  Array.from({ length: MISSION_NAME_COMBINATIONS }, (_, n) => missionNameForNumber(n)).filter(
    (name): name is string => name !== null,
  );

describe('the roll', () => {
  it('only ever offers a name a new mission may take', () => {
    for (let i = 0; i < 500; i++) expect(isNewMissionName(rollMissionName())).toBe(true);
  });

  it('rolls again past a combination of only the original words', () => {
    // Number 0 is "Swift Red Pathfinder", all original words. The second draw
    // lands on the first number that is not.
    expect(missionNameForNumber(0)).toBeNull();
    const usable = Array.from({ length: 100 }, (_, n) => n).find((n) => missionNameForNumber(n) !== null)!;
    const draws = [0, (usable + 0.5) / MISSION_NAME_COMBINATIONS];
    let drawn = 0;
    const name = rollMissionName(() => draws[drawn++]);
    expect(name).toBe(missionNameForNumber(usable));
    expect(drawn).toBe(2);
  });

  it('can reach every name the counter can', () => {
    // The roll and the counter draw on the same names, so neither can produce
    // one the other would not recognise as taken.
    expect(handedOut().every(isNewMissionName)).toBe(true);
  });
});

describe('a name a new mission may take', () => {
  it('has at least one word added when names became unique', () => {
    expect(isNewMissionName('Swift Comet Explorer')).toBe(true);
    expect(isNewMissionName('Valiant Red Explorer')).toBe(true);
    expect(isNewMissionName('Swift Red Voyager')).toBe(true);
  });

  it('is not one an older mission may carry, nor anything typed', () => {
    for (const name of ['Swift Helios Explorer', 'Red Explorer', 'meet me at the gate', 'swift comet explorer', 'Comet Swift Explorer', '']) {
      expect(isNewMissionName(name)).toBe(false);
    }
  });
});

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
  const taken = () => Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
  const ref = (collection: string, id: string) => {
    const path = `${collection}/${id}`;
    return {
      path,
      create: async (data: Record<string, unknown>) => {
        if (docs.has(path)) throw taken();
        docs.set(path, data);
      },
    };
  };
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
        if (mustBeNew && docs.has(path)) throw taken();
        docs.set(path, data);
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, docs };
}

describe('claiming a rolled name', () => {
  it('can be won once, and only once', async () => {
    const { db, docs } = fakeFirestore();
    const registry = new FirestoreMissionNameRegistry(db);

    expect(await registry.claim('Swift Comet Explorer')).toBe(true);
    expect(await registry.claim('Swift Comet Explorer')).toBe(false);
    expect(docs.has('missionNames/Swift Comet Explorer')).toBe(true);
  });

  it('does not swallow a failure that is not "taken"', async () => {
    const db = { collection: () => ({ doc: () => ({ create: async () => { throw new Error('unavailable'); } }) }) };
    await expect(new FirestoreMissionNameRegistry(db as unknown as Firestore).claim('Swift Comet Explorer')).rejects.toThrow('unavailable');
  });

  it('is never then handed out by the counter', async () => {
    const { db } = fakeFirestore();
    const registry = new FirestoreMissionNameRegistry(db);
    const [first, second] = handedOut();

    expect(await registry.claim(first)).toBe(true);
    expect(await registry.takeNext()).toBe(second);
  });
});

describe('the counter, for a mission whose name was taken', () => {
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
