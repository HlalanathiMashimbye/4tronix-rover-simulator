/**
 * Mission names taken in Firestore (IMissionNameRegistry).
 *
 * A taken name is a document, `missionNames/{name}`, and taking one is
 * create(), which fails if the document exists. That one write is the whole
 * guarantee: however many missions ask for a name at once, Firestore lets
 * exactly one create it. No read first, so claiming costs one write.
 *
 * `counters/missionNames` is for the mission that lost: one transaction reads
 * the next number, turns it into a name (missionNameForNumber, one-to-one),
 * skips any that already has a document, and moves the counter on.
 *
 * Missions sent before 8 October 2026 have no documents here. They do not
 * need them: their names use only the original words, and no name with only
 * those is ever claimed or handed out (isNewMissionName).
 *
 * Server only. The rules deny both collections to browsers by matching
 * nothing, and the Admin SDK does not read the rules.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { IMissionNameRegistry } from '@/core/domain/repositories/IMissionNameRegistry';
import { MISSION_NAME_COMBINATIONS, missionNameForNumber } from '@/core/domain/services/missionNameGenerator';

const COUNTER = { collection: 'counters', doc: 'missionNames' } as const;
const NAMES_COLLECTION = 'missionNames';

/** gRPC's ALREADY_EXISTS, which create() fails with when the document is there. */
const ALREADY_EXISTS = 6;

export class FirestoreMissionNameRegistry implements IMissionNameRegistry {
  constructor(private readonly db: Firestore) {}

  async claim(name: string): Promise<boolean> {
    try {
      await this.db.collection(NAMES_COLLECTION).doc(name).create({ takenAt: new Date().toISOString() });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
      throw error;
    }
  }

  async takeNext(): Promise<string> {
    const counterRef = this.db.collection(COUNTER.collection).doc(COUNTER.doc);
    return this.db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = counter.data()?.next;
      for (let n = typeof next === 'number' ? next : 0; n < MISSION_NAME_COMBINATIONS; n++) {
        // Combinations of only the original words are never handed out.
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
