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
import { AdminFirestoreMissionRepository } from '@/infrastructure/persistence/AdminFirestoreMissionRepository';
import { FirestoreMissionNameRegistry } from '@/infrastructure/persistence/FirestoreMissionNameRegistry';
import { IYardRepository } from '@/core/domain/repositories/IYardRepository';
import { FirestoreYardRepository } from '@/infrastructure/persistence/FirestoreYardRepository';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { MissionNotificationService } from '@/core/application/services/MissionNotificationService';
import { EXCLUDED_MISSION_IDS } from '@/infrastructure/config/notificationExclusions';
import { FirestoreLearnerContactReader } from '@/infrastructure/persistence/FirestoreLearnerContactReader';
import { ResendEmailSender } from '@/infrastructure/email/resend-client';
import { missionEmailComposer } from '@/infrastructure/email/missionStatusTemplates';
import { resolveAppUrl } from '@/infrastructure/config/appUrl';
import { OperatorMissionCommands } from '@/core/application/services/OperatorMissionCommands';
import { VideoLinker } from '@/core/application/services/VideoLinker';
import { OperatorTeamService } from '@/core/application/services/OperatorTeamService';
import { FirebaseOperatorDirectory } from '@/infrastructure/auth/FirebaseOperatorDirectory';
import { buildAccessGrantedEmail } from '@/infrastructure/email/accessRequestTemplate';
import { nanoid } from 'nanoid';

/** Privileged. Firestore rules do not apply: check authorisation yourself. */
export function adminMissionRepository(): IMissionRepository {
  return new AdminFirestoreMissionRepository(getFirestoreInstance());
}

/** The application service, wired to the privileged repository. */
export function missionService(): MissionService {
  return new MissionService(adminMissionRepository(), new FirestoreMissionNameRegistry(getFirestoreInstance()));
}

/** Privileged. Yards are world-readable but only ever written through here. */
export function adminYardRepository(): IYardRepository {
  return new FirestoreYardRepository(getFirestoreInstance());
}

/**
 * Learner status emails: Resend delivers, the learner's private contact record
 * says where. Assembled here and nowhere else - three routes used to build it
 * inline, each free to wire it differently, and architecture.test.ts now fails
 * if one does again.
 */
export function notificationService(): MissionNotificationService {
  return new MissionNotificationService(
    new ResendEmailSender(),
    missionEmailComposer,
    new FirestoreLearnerContactReader(getFirestoreInstance()),
    resolveAppUrl(),
    EXCLUDED_MISSION_IDS,
  );
}

/** The operator's bookkeeping commands, on the privileged repository. */
export function operatorMissionCommands(): OperatorMissionCommands {
  return new OperatorMissionCommands(adminMissionRepository(), notificationService(), nanoid);
}

/** A found or uploaded video, attached to its run: the linker and automatic upload both. */
export function videoLinker(): VideoLinker {
  return new VideoLinker(adminMissionRepository(), notificationService(), nanoid);
}

/**
 * Operator access, announced by email with a link to the console. APP_URL
 * wins; `origin`, the request's, is the fallback, so an unconfigured staging
 * still links to itself.
 */
export function operatorTeamService(origin?: string): OperatorTeamService {
  return new OperatorTeamService(new FirebaseOperatorDirectory(), async (to, role) => {
    try {
      const { subject, html } = buildAccessGrantedEmail(role, `${resolveAppUrl(origin)}/operator`);
      await new ResendEmailSender().send(to, subject, html);
      return true;
    } catch (error) {
      console.error('[operator/team] grant email failed:', error);
      return false;
    }
  });
}
