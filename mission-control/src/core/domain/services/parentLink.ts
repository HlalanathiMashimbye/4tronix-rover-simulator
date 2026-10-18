/**
 * Parent-link path constants and value type.
 *
 * A parent can link their Google account to a child's anonymous learner
 * profile, giving them a second way (besides the recovery code) to restore
 * the profile on a new device. The child never signs in to anything.
 *
 * The link is stored in two places that must stay in sync:
 *
 *   learners/{id}/private/parentLink   — the forward lookup (child → parent)
 *   parentLinks/{parentUid}            — the reverse lookup (parent → children)
 *
 * The forward side lives in the same browser-denied subcollection as the
 * learner's contact email (see learnerContact.ts), so it inherits the same
 * Firestore rule: `match /learners/{id}/{document=**} { read, write: if false }`.
 * Only the Admin SDK can reach it.
 *
 * consentVersion is recorded at link time so that a wording change (after a
 * POPIA review, for instance) can require re-consent rather than silently
 * continuing under stale terms.
 */

import { LEARNER_PRIVATE_COLLECTION } from '@/core/domain/services/learnerContact';

export { LEARNER_PRIVATE_COLLECTION };

export const PARENT_LINK_DOC = 'parentLink';
export const PARENT_LINKS_COLLECTION = 'parentLinks';
export const CURRENT_CONSENT_VERSION = 1;

export interface ParentLinkData {
  parentUid: string;
  consentedAt: string;
  consentVersion: number;
}
