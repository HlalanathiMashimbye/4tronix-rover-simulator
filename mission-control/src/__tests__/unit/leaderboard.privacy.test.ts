/**
 * What the leaderboard is allowed to know about a child, and to publish.
 *
 * THIS FILE WAS REWRITTEN, and the reason matters more than the tests.
 *
 * It used to assert that fields named `email`, `ip`, `deviceFingerprint` and a
 * dozen others were `undefined` on a LeaderboardEntry. Those assertions cannot
 * fail: the entity is a fixed TypeScript interface, so it was re-testing the
 * compiler. Proved by embedding a literal 'child@school.example' in every entry
 * the factory returned - all sixteen tests still passed.
 *
 * It was also aimed at createLeaderboardEntry, which at the time had no
 * production callers at all. The repository built its entries by hand, so the
 * tested constructor was not the one that ran.
 *
 * A file called leaderboard.privacy.test.ts gets read as assurance. That one
 * was credited as coverage and delivered none, on a feature about children.
 *
 * These assert two things a denylist cannot:
 *
 *   1. The document actually written to Firestore carries ONLY approved keys.
 *      An allowlist fails on a field nobody anticipated, which is the whole
 *      point - a denylist only catches leaks somebody already thought of.
 *   2. What leaves the public endpoint is narrower still, because the entry
 *      is keyed by a learner hash and that hash must never be published.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { createLeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';
import { FirestoreLeaderboardRepository } from '@/infrastructure/persistence/FirestoreLeaderboardRepository';

/**
 * Every key a leaderboard document may carry, and nothing else.
 *
 * Adding a field to the entity fails this until it is added here on purpose.
 * That deliberate step is the control: it forces someone to look at a new
 * field and decide whether a child's record should hold it.
 */
const PERMITTED_STORED_KEYS = [
  'id',
  'leaderboardId',
  'displayName',
  'score',
  'completedChallenges',
  'completedChallengeIds',
  'optedIn',
  'optedInAt',
  'createdAt',
  'updatedAt',
].sort();

/** What a stranger may see. Narrower than what is stored: no id, no hash. */
const PERMITTED_PUBLIC_KEYS = ['displayName', 'score', 'completedChallenges'].sort();

/** A Firestore stand-in that records the document actually written. */
function fakeDb() {
  const written: Record<string, unknown>[] = [];
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false }),
        set: async (data: Record<string, unknown>) => {
          written.push(data);
        },
        update: async () => {},
      }),
    }),
  };
  // Typed off the constructor rather than importing Firestore: this file is
  // parsed without the TypeScript plugin, so `import type` does not survive.
  type Db = ConstructorParameters<typeof FirestoreLeaderboardRepository>[0];
  return { db: db as unknown as Db, written };
}

describe('what gets stored about a child', () => {
  it('writes only approved keys, so an unanticipated field fails', async () => {
    const { db, written } = fakeDb();
    const repository = new FirestoreLeaderboardRepository(db);

    await repository.getOrCreate('a'.repeat(64), 'Brave Rover');

    expect(written).toHaveLength(1);

    // Subset, not equality: optedInAt is optional and absent until a learner
    // opts in. What matters is that nothing UNAPPROVED appears, which a
    // subset check still catches - an unanticipated field is not in the list.
    const unapproved = Object.keys(written[0]).filter(
      (k) => !PERMITTED_STORED_KEYS.includes(k),
    );
    expect(unapproved).toEqual([]);

    // And the record is not hollow: the fields the leaderboard needs are there.
    expect(Object.keys(written[0])).toEqual(
      expect.arrayContaining(['id', 'displayName', 'score', 'optedIn']),
    );
  });

  it('stores no value that looks like an email address, anywhere', async () => {
    // Belt and braces on the allowlist, and it reads on VALUES not keys, so a
    // leak smuggled through an approved field is caught too.
    const { db, written } = fakeDb();
    const repository = new FirestoreLeaderboardRepository(db);

    await repository.getOrCreate('a'.repeat(64), 'Brave Rover');

    expect(JSON.stringify(written[0])).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  });

  it('is keyed by something that cannot be reversed to a learner', async () => {
    // The id IS a learner hash, which is why it must never be published. Here
    // it only has to be a hash rather than the raw 21-character nanoid.
    const { db, written } = fakeDb();
    const repository = new FirestoreLeaderboardRepository(db);

    await repository.getOrCreate('b'.repeat(64), 'Brave Rover');

    expect(written[0].id).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('starts opted out, so appearing publicly is always a choice', async () => {
    const { db, written } = fakeDb();
    const repository = new FirestoreLeaderboardRepository(db);

    await repository.getOrCreate('a'.repeat(64), 'Brave Rover');

    expect(written[0].optedIn).toBe(false);
  });

  it('builds the stored document with the domain factory, not a second copy', async () => {
    // The repository used to hand-roll this object, so the entity and the
    // document could drift and only one of them was ever tested.
    const { db, written } = fakeDb();
    const repository = new FirestoreLeaderboardRepository(db);

    await repository.getOrCreate('a'.repeat(64), 'Brave Rover');
    const fromFactory = createLeaderboardEntry('a'.repeat(64), 'Brave Rover');

    expect(Object.keys(written[0]).sort()).toEqual(Object.keys(fromFactory).sort());
  });
});

describe('what the public endpoint may publish', () => {
  it('is narrower than what is stored, and excludes the learner hash', () => {
    // The stored id is a hash OF a learner. Publishing it would turn the
    // leaderboard into a confirmation oracle for anyone holding a guess.
    expect(PERMITTED_PUBLIC_KEYS).not.toContain('id');
    expect(PERMITTED_PUBLIC_KEYS.every((k) => PERMITTED_STORED_KEYS.includes(k))).toBe(true);
    expect(PERMITTED_PUBLIC_KEYS.length).toBeLessThan(PERMITTED_STORED_KEYS.length);
  });

  it('matches what GET /api/leaderboard actually projects', () => {
    /**
     * Read out of the route source rather than restated, so the allowlist
     * above cannot quietly drift from the code that serves the data. A test
     * that keeps its own copy of the answer stops being a check.
     */
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leaderboard/route.ts'),
      'utf8',
    );
    const projection = source.match(/entries:\s*page\.entries\.map\(\(e\)\s*=>\s*\(\{([\s\S]*?)\}\)\)/);

    expect(projection).not.toBeNull();
    const projected = [...projection![1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
    expect(projected).toEqual(PERMITTED_PUBLIC_KEYS);
  });
});
