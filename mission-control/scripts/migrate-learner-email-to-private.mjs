#!/usr/bin/env node
/**
 * Move plaintext learner addresses off the publicly readable learner document
 * and into learners/{id}/private/contact.
 *
 * WHY: mission documents are world-readable and carry `learnerId`, and learner
 * documents are readable by exact id. So anyone could read the feed, collect
 * learner ids from it and fetch each learner document to read `learnerEmail`
 * in plaintext - bulk harvesting of school children's addresses from public
 * data. Rules cannot hide a single field on read, so the address moves to a
 * subcollection browsers are denied outright.
 *
 * The application already writes new addresses to the new location. This is
 * only for records written before that change.
 *
 * THIS COPIES BEFORE IT CLEARS. Deleting `learnerEmail` on its own would be
 * destructive: MissionNotificationService falls back to that field for learners
 * who have not re-saved an address, so clearing it without moving it first
 * permanently stops notifications for every existing learner.
 *
 * Complements redact-orphaned-learner-emails.mjs, which deletes addresses on
 * learner documents NO mission references. That script deliberately keeps
 * reachable addresses - which are exactly the ones this script migrates. Run
 * that one first if you want the unreachable records dropped rather than moved.
 *
 * Idempotent and resumable: a learner whose private record already holds an
 * address is only cleared, never re-copied, so re-running is safe and a run
 * stopped halfway can simply be re-run.
 *
 * Usage (dry run prints what would change and writes nothing):
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/migrate-learner-email-to-private.mjs
 *   node scripts/migrate-learner-email-to-private.mjs --apply
 *
 * On the Spark plan the daily write quota is easy to exhaust, and each learner
 * costs TWO writes (the private record, then clearing the public field). Use
 * --limit to work through it in chunks across days:
 *   node scripts/migrate-learner-email-to-private.mjs --apply --limit 200
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');

const limitArg = process.argv.indexOf('--limit');
const LIMIT =
  limitArg !== -1 && process.argv[limitArg + 1]
    ? Number.parseInt(process.argv[limitArg + 1], 10)
    : Infinity;

if (Number.isNaN(LIMIT) || LIMIT <= 0) {
  console.error('--limit must be a positive integer');
  process.exit(1);
}

// Kept in sync by hand with core/domain/services/learnerContact.ts - this file
// is .mjs and cannot import the TypeScript constants. If those paths ever
// change, change them here too or the app will write somewhere this script
// does not look.
const PRIVATE_COLLECTION = 'private';
const CONTACT_DOC = 'contact';

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing ${name}. Source mission-control/.env first.`);
    process.exit(1);
  }
  const trimmed = raw.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
}

const projectId = requireEnv('FIREBASE_PROJECT_ID');

initializeApp({
  credential: applicationDefault(),
  projectId,
});

const db = getFirestore();

const mask = (e) => {
  const [user, domain] = e.split('@');
  if (!domain) return '***';
  const head = user.length > 2 ? user[0] + '*'.repeat(user.length - 2) + user.at(-1) : '**';
  return `${head}@${domain}`;
};

console.log(`project: ${projectId}`);
console.log(APPLY ? 'MODE: APPLY (will write)' : 'MODE: DRY RUN (no writes)');
if (LIMIT !== Infinity) console.log(`limit:   ${LIMIT} learner(s) this run`);
console.log('');

const learners = await db.collection('learners').get();

let migrated = 0;   // address copied across, then public field cleared
let clearedOnly = 0; // private record already correct, public field left over
let skipped = 0;    // nothing to do
let reachedLimit = false;

for (const learnerDoc of learners.docs) {
  const email = learnerDoc.data()?.learnerEmail;
  if (typeof email !== 'string' || !email.trim()) {
    skipped += 1;
    continue;
  }

  if (migrated + clearedOnly >= LIMIT) {
    reachedLimit = true;
    break;
  }

  const contactRef = learnerDoc.ref.collection(PRIVATE_COLLECTION).doc(CONTACT_DOC);
  const existing = await contactRef.get();
  const alreadyStored =
    existing.exists && typeof existing.data()?.learnerEmail === 'string';

  if (alreadyStored) {
    // The learner has re-saved since the app change; the private record is
    // authoritative. Just drop the stale public copy.
    console.log(`  learners/${learnerDoc.id}: clear public copy (private record already set)`);
    clearedOnly += 1;
    if (APPLY) {
      await learnerDoc.ref.update({ learnerEmail: FieldValue.delete() });
    }
    continue;
  }

  console.log(`  learners/${learnerDoc.id}: move ${mask(email)} -> private/contact`);
  migrated += 1;

  if (APPLY) {
    // Copy first. If the process dies between these two writes the address
    // still exists in both places, which re-running resolves - whereas
    // clearing first could lose it outright.
    await contactRef.set(
      { learnerEmail: email, migratedAt: new Date().toISOString() },
      { merge: true },
    );
    await learnerDoc.ref.update({ learnerEmail: FieldValue.delete() });
  }
}

const touched = migrated + clearedOnly;

console.log(`\nlearner docs scanned:            ${learners.size}`);
console.log(`addresses moved to private:      ${migrated}`);
console.log(`stale public copies cleared:     ${clearedOnly}`);
console.log(`documents with no address:       ${skipped}`);
console.log(`\nfirestore reads this run:        ${learners.size + touched}`);
console.log(`writes ${APPLY ? 'performed' : 'that would be performed'}:  ${migrated * 2 + clearedOnly}`);

if (reachedLimit) {
  console.log(`\nStopped at --limit ${LIMIT}. Re-run to continue where this left off.`);
}

if (!APPLY && touched > 0) {
  console.log('\nRe-run with --apply to write these changes.');
}

if (APPLY && migrated > 0) {
  console.log('\nDone. Verify a learner still receives mail before considering this closed.');
}
