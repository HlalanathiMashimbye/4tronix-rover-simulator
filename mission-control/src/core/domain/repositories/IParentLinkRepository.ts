/**
 * Links a parent's Google account to a child's anonymous learner profile.
 *
 * Two storage locations are kept in sync: a private subcollection document
 * on the learner (forward lookup) and a top-level document keyed by the
 * parent's Firebase UID (reverse lookup, for restore).
 */

export interface IParentLinkRepository {
  link(learnerId: string, parentUid: string, consentVersion: number): Promise<void>;
  unlink(learnerId: string, parentUid: string): Promise<void>;
  findByLearnerId(learnerId: string): Promise<{ parentUid: string; consentVersion: number } | null>;
  findByParentUid(parentUid: string): Promise<string[]>;
}
