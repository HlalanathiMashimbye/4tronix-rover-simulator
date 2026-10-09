/**
 * Mission names handed out from a counter in Firestore (IMissionNameRegistry).
 *
 * `counters/missionNames` holds the next number, and one transaction reads it,
 * turns it into a name and moves it on, so two missions sent at the same
 * moment cannot both get the same number: Firestore retries whichever
 * transaction lost the race, and it reads the moved-on counter.
 *
 * Each name handed out also gets `missionNames/{name}`. The numbers alone make
 * names unique; the record is there for the day someone edits a word list in
 * the middle instead of appending (missionNameGenerator.ts says why that would
 * remap the numbers). A name that already has a record is skipped, so that
 * mistake costs a number, not a duplicate. One read per mission sent.
 *
 * Server only. The rules deny both collections to browsers by matching
 * nothing, and the Admin SDK does not read the rules.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { IMissionNameRegistry } from '@/core/domain/repositories/IMissionNameRegistry';
import { MISSION_NAME_COMBINATIONS, missionNameForNumber } from '@/core/domain/services/missionNameGenerator';

const COUNTER = { collection: 'counters', doc: 'missionNames' } as const;
const NAMES_COLLECTION = 'missionNames';

export class FirestoreMissionNameRegistry implements IMissionNameRegistry {
  constructor(private readonly db: Firestore) {}

  async takeNext(): Promise<string> {
    const counterRef = this.db.collection(COUNTER.collection).doc(COUNTER.doc);
    return this.db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = counter.data()?.next;
      for (let n = typeof next === 'number' ? next : 0; n < MISSION_NAME_COMBINATIONS; n++) {
        // Combinations of only the original words are retired, not taken.
        const name = missionNameForNumber(n);
        if (name === null) continue;
        const nameRef = this.db.collection(NAMES_COLLECTION).doc(name);
        if ((await tx.get(nameRef)).exists) continue;
        tx.set(counterRef, { next: n + 1 });
        tx.create(nameRef, { takenAt: new Date().toISOString() });
        return name;
      }
      throw new Error('Every mission name has been used: append words to the lists in missionNameGenerator.ts');
    });
  }
}
