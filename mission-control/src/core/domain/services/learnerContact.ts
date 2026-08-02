/**
 * Where a learner's plaintext contact address lives.
 *
 * NOT on the learner document itself. That document is readable by exact id,
 * and learner ids are published on world-readable mission documents, so an
 * address stored there is harvestable in bulk from public data by anyone who
 * reads the feed. Firestore rules cannot hide one field on read, so the
 * address lives in a subcollection browsers are denied outright
 * (`match /learners/{id}/{document=**}` is `read, write: if false`) and only
 * the Admin SDK can reach it.
 *
 * Shared so the writer (POST /api/learners/[id]/email) and the reader
 * (MissionNotificationService) cannot drift onto different paths and silently
 * stop finding each other - which would show up only as learners quietly
 * never receiving mail.
 */
export const LEARNER_PRIVATE_COLLECTION = 'private';
export const LEARNER_CONTACT_DOC = 'contact';
