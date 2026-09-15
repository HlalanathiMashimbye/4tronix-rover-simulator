/**
 * Where a learner's mail goes, and who it greets.
 *
 * A port, so MissionNotificationService can be an application service rather
 * than a Firestore client. It used to import firebase-admin and walk
 * learners/{id}/private/contact itself, which put the Admin SDK - the one that
 * ignores every Firestore rule - inside core. architecture.test.ts now fails
 * the build if any SDK is imported there.
 */

export interface LearnerContact {
  email?: string;
  displayName?: string;
}

export interface ILearnerContactReader {
  /**
   * The contact for the learner a mission belongs to, found by the learnerRef
   * the mission carries. Empty when there is no such learner.
   *
   * Throws when the lookup itself fails, rather than returning empty, so a
   * caller can tell "nobody to email" apart from "could not find out".
   */
  findByLearnerRef(learnerRef: string): Promise<LearnerContact>;
}
