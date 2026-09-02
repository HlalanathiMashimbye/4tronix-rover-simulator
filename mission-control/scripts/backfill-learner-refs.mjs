#!/usr/bin/env node
/**
 * Backfill `learnerRef` onto existing mission and learner documents.
 *
 * Missions used to carry the raw `learnerId`, and the feed printed it on every
 * card. Publishing it meant possession of an id proved nothing, so nothing that
 * accepts a learner id could authenticate its caller. Missions now carry
 * sha256(learnerId) instead, and learner records carry the same hash so the
 * notification service can still find the learner a mission belongs to.
 *
 * WITHOUT THIS, EXISTING DATA GOES DARK. History is queried by learnerRef, so
 * every mission written before the change stops appearing for its own learner,
 * and notifications stop resolving. Run it against any project that already
 * holds missions, immediately after deploying the code.
 *
 * On missions it writes learnerRef and REMOVES learnerId, which is the whole
 * point - leaving the id behind would keep it public. On learners it only adds
 * learnerRef; the document id is the learner id and must stay as it is.
 *
 * Idempotent: a document that already has the right learnerRef is skipped, so
 * re-running is safe and an interrupted run can simply be re-run.
 *
 * Usage (dry run prints what would change and touches nothing):
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/backfill-learner-refs.mjs
 *   node scripts/backfill-learner-refs.mjs --apply
 */

import { createHash } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');

// Must produce byte-identical output to hashLearnerId() in
// core/domain/services/learnerRef.ts, which uses Web Crypto SHA-256 over the
// trimmed id and hex-encodes it. A mismatch here would not throw - it would
// quietly write refs nothing ever matches.
const hashLearnerId = (id) => createHash('sha256').update(id.trim()).digest('hex');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing ${name}. Source the target project's .env first.`);
    process.exit(1);
  }
  const t = raw.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
}

const projectId = requireEnv('FIREBASE_PROJECT_ID');

initializeApp({
  credential: applicationDefault(),
  projectId,
});

const db = getFirestore();

console.log(`project: ${projectId}`);
console.log(APPLY ? 'MODE: APPLY (will write)' : 'MODE: DRY RUN (no writes)');
console.log('');

// --- Learners: add learnerRef (document id IS the learner id) --------------
const learners = await db.collection('learners').get();
let learnersUpdated = 0;
let learnersSkipped = 0;

for (const doc of learners.docs) {
  const expected = hashLearnerId(doc.id);
  if (doc.data()?.learnerRef === expected) {
    learnersSkipped += 1;
    continue;
  }
  learnersUpdated += 1;
  if (APPLY) await doc.ref.update({ learnerRef: expected });
}

console.log(`learners: ${learnersUpdated} to update, ${learnersSkipped} already correct`);

// --- Missions: add learnerRef, drop the raw id ----------------------------
const missions = await db.collection('missions').get();
let missionsUpdated = 0;
let missionsSkipped = 0;
let missionsUnresolvable = 0;

for (const doc of missions.docs) {
  const data = doc.data() ?? {};
  // Older missions fall back to sessionId, the same generous rule the other
  // learner scripts use - better to derive a ref from the wrong-but-consistent
  // id than to strand the mission with none at all.
  const rawId = data.learnerId || data.sessionId;

  if (data.learnerRef && !data.learnerId) {
    missionsSkipped += 1;
    continue;
  }

  if (!rawId) {
    missionsUnresolvable += 1;
    console.log(`  missions/${doc.id}: NO learnerId or sessionId - cannot derive a ref, leaving alone`);
    continue;
  }

  missionsUpdated += 1;
  if (APPLY) {
    await doc.ref.update({
      learnerRef: hashLearnerId(rawId),
      learnerId: FieldValue.delete(),
    });
  }
}

console.log(`missions: ${missionsUpdated} to update, ${missionsSkipped} already correct`);
if (missionsUnresolvable) {
  console.log(`missions with no id to hash: ${missionsUnresolvable} (left untouched)`);
}

console.log(`\nfirestore reads:  ${learners.size + missions.size}`);
console.log(`writes ${APPLY ? 'performed' : 'that would be performed'}: ${learnersUpdated + missionsUpdated}`);

if (!APPLY) {
  console.log('\nRe-run with --apply to write these changes.');
} else {
  console.log('\nDone. Open the history page and confirm past missions still appear.');
}
