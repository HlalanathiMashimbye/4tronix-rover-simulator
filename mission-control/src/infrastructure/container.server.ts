/**
 * Where the privileged, server-side implementations get chosen.
 *
 * `import 'server-only'` is the point of this file existing separately from
 * container.browser.ts. The Admin SDK bypasses Firestore rules completely: it
 * is not merely "the server one", it is the one with no authorisation at all,
 * and code holding it must check permissions itself. So it must never end up
 * in a browser bundle, and this import turns that from a convention into a
 * build error.
 *
 * That is not hypothetical. A first version of this put both builders in one
 * container.ts; app/page.tsx is a client component, importing it for the
 * browser repository dragged firebase-admin in behind it, and `next build`
 * failed with 44 module-not-found errors for child_process, dns and fs. The
 * bundler was refusing to do exactly what should never happen.
 */

import 'server-only';

import { IMissionRepository } from '@/core/domain/repositories/IMissionRepository';
import { MissionService } from '@/core/application/services/MissionService';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { IYardRepository } from '@/core/domain/repositories/IYardRepository';
import { FirestoreYardRepository } from '@/infrastructure/persistence/FirestoreYardRepository';
import { ILeaderboardRepository } from '@/core/domain/repositories/ILeaderboardRepository';
import { FirestoreLeaderboardRepository } from '@/infrastructure/persistence/FirestoreLeaderboardRepository';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';

/** Privileged. Firestore rules do not apply: check authorisation yourself. */
export function adminMissionRepository(): IMissionRepository {
  return new FirestoreMissionRepository(getFirestoreInstance());
}

/** The application service, wired to the privileged repository. */
export function missionService(): MissionService {
  return new MissionService(adminMissionRepository());
}

/** Privileged. Yards are world-readable but only ever written through here. */
export function adminYardRepository(): IYardRepository {
  return new FirestoreYardRepository(getFirestoreInstance());
}

/** Privileged. Leaderboard writes are server-side only. */
export function adminLeaderboardRepository(): ILeaderboardRepository {
  return new FirestoreLeaderboardRepository(getFirestoreInstance());
}
