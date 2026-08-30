/**
 * Where the concrete classes get chosen.
 *
 * Every other file asks for an interface; this one file decides what actually
 * implements it. Before, seven call sites did `new FirestoreMissionRepository(
 * getFirestoreClient())` inline - three of them in app/page.tsx alone - which
 * meant a React page component was the composition root, and swapping the
 * persistence layer meant editing routes and components.
 *
 * The two builders below are not interchangeable, and the distinction is a
 * security boundary rather than a preference:
 *
 *   adminMissionRepository()   Firebase Admin SDK, server only. Bypasses
 *                             Firestore rules entirely, so it must never be
 *                             constructed in code that ships to a browser.
 *   browserMissionRepository() Firebase client SDK, subject to firestore.rules
 *                             like any other visitor. Reads only, in practice.
 *
 * FirestoreMissionRepository deliberately accepts either SDK, which is what
 * lets one class serve both. That makes picking the right one important, and
 * having exactly one place to pick is the point of this file.
 */

import { IMissionRepository } from '@/core/domain/repositories/IMissionRepository';
import { MissionService } from '@/core/application/services/MissionService';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { getFirestoreClient } from '@/lib/firebase';

/** Privileged, server-side. Rules do not apply: check authorisation yourself. */
export function adminMissionRepository(): IMissionRepository {
  return new FirestoreMissionRepository(getFirestoreInstance());
}

/** Unprivileged, browser-side. Firestore rules apply. */
export function browserMissionRepository(): IMissionRepository {
  return new FirestoreMissionRepository(getFirestoreClient());
}

/** The application service, wired to the privileged repository. */
export function missionService(): MissionService {
  return new MissionService(adminMissionRepository());
}
