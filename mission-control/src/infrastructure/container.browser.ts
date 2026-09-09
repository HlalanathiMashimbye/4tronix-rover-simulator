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

import { IMissionReader } from '@/core/domain/repositories/IMissionRepository';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { IChallengeProgressRepository } from '@/core/domain/repositories/IChallengeProgressRepository';
import { FirestoreChallengeProgressRepository } from '@/infrastructure/persistence/FirestoreChallengeProgressRepository';
import { ChallengeProgressService } from '@/core/application/services/ChallengeProgressService';
import { getFirestoreClient } from '@/infrastructure/persistence/firebase-client';

/**
 * Unprivileged. Firestore rules apply.
 *
 * Typed as a reader, not the whole repository. Rules already deny the browser
 * every write, so the type now says the same thing: a client component that
 * tries to write does not compile, rather than failing at runtime in front of
 * a learner. architecture.test.ts fails if this widens again.
 */
export function browserMissionRepository(): IMissionReader {
  return new FirestoreMissionRepository(getFirestoreClient());
}

/** Unprivileged. Firestore rules apply. */
export function browserChallengeProgressRepository(): IChallengeProgressRepository {
  return new FirestoreChallengeProgressRepository(getFirestoreClient());
}

export function challengeProgressService(): ChallengeProgressService {
  return new ChallengeProgressService(browserChallengeProgressRepository());
}
