/**
 * Where the browser-side implementation gets chosen.
 *
 * Separate from container.server.ts so that a client component can reach a
 * repository without pulling the Firebase Admin SDK in behind it. See that
 * file for what goes wrong when the two share a module.
 *
 * These repositories are subject to firestore.rules like any other visitor,
 * which is what makes them safe to construct in code that ships to a browser.
 * Missions are read here (the feed, a mission page); the only writes are the
 * learner's own record and the email stamp, both of which the rules allow.
 */

import type { ILearnerEmailStamp, IMissionReader } from '@/core/domain/repositories/IMissionRepository';
import type { ILearnerRepository } from '@/core/domain/repositories/ILearnerRepository';
import type { ILearnerMissionFeed, IOperatorQueueFeed } from '@/core/domain/repositories/IMissionFeeds';
import {
  subscribeToMission,
  subscribeToMissionRuns,
  subscribeToYardCompleted,
  subscribeToYardQueue,
} from '@/infrastructure/persistence/operatorQueueService';
import {
  subscribeMissionsByLearnerEmail,
  subscribeMissionsByLearnerId,
  subscribeRecentCompletions,
} from '@/infrastructure/persistence/missionQueryService';
import { BrowserFirestoreMissionReader } from '@/infrastructure/persistence/BrowserFirestoreMissionReader';
import { BrowserFirestoreLearnerRepository } from '@/infrastructure/persistence/BrowserFirestoreLearnerRepository';
import { getFirebaseAuth, getFirestoreClient } from '@/infrastructure/persistence/firebase-client';

/**
 * Unprivileged. Firestore rules apply.
 *
 * Typed as a reader, not the whole repository. Rules already deny the browser
 * every write, so the type now says the same thing: a client component that
 * tries to write does not compile, rather than failing at runtime in front of
 * a learner. architecture.test.ts fails if this widens again.
 */
export function browserMissionRepository(): IMissionReader {
  return new BrowserFirestoreMissionReader(getFirestoreClient());
}

/** The one mission write the rules allow a visitor. Its own narrow type, so a reader cannot reach it. */
export function browserLearnerEmailStamp(): ILearnerEmailStamp {
  return new BrowserFirestoreMissionReader(getFirestoreClient());
}

/** The learner's own record. Firestore rules limit what a visitor may write to it. */
export function browserLearnerRepository(): ILearnerRepository {
  return new BrowserFirestoreLearnerRepository(getFirestoreClient());
}

/** The operator console's live queue, settled list, mission and runs. */
export function operatorQueueFeed(): IOperatorQueueFeed {
  return { subscribeToYardQueue, subscribeToYardCompleted, subscribeToMission, subscribeToMissionRuns };
}

/** A learner's live history, and the completions bell. */
export function learnerMissionFeed(): ILearnerMissionFeed {
  return { subscribeMissionsByLearnerId, subscribeMissionsByLearnerEmail, subscribeRecentCompletions };
}

/** Firebase Auth in the browser, for the operator's sign-in. */
export function browserAuth() {
  return getFirebaseAuth();
}
