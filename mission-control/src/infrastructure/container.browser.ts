/**
 * Where the browser-side implementation gets chosen.
 *
 * Separate from container.server.ts so that a client component can reach a
 * repository without pulling the Firebase Admin SDK in behind it. See that
 * file for what goes wrong when the two share a module.
 *
 * This repository is subject to firestore.rules like any other visitor, which
 * is what makes it safe to construct in code that ships to a browser. In
 * practice it is used for reads: the feed, a mission page, and the realtime
 * subscriptions.
 */

import { IMissionRepository } from '@/core/domain/repositories/IMissionRepository';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { getFirestoreClient } from '@/lib/firebase';

/** Unprivileged. Firestore rules apply. */
export function browserMissionRepository(): IMissionRepository {
  return new FirestoreMissionRepository(getFirestoreClient());
}
