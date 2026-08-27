#!/usr/bin/env node
/**
 * Give every existing mission one run, so the archive matches the run model.
 *
 * A mission used to carry its own status, timestamps and video, which assumed
 * exactly one yard would ever execute it. Those now live on
 * missions/{id}/runs/{yardId}, one document per yard that attempted it.
 *
 * Every mission in the archive predates that and has exactly one implicit run:
 * whatever its own fields say, at whatever yardId it was submitted for. This
 * copies those fields into a run document.
 *
 * ADDITIVE AND REVERSIBLE. The mission's own fields are left completely alone,
 * so nothing that still reads them changes behaviour and rolling back means
 * deleting the run documents. That is deliberate: this reshapes live learner
 * work and there are no backups. Nothing here removes anything.
 *
 * IDEMPOTENT. A mission that already has a run for its yard is skipped, not
 * overwritten - re-running after the satellite has recorded real outcomes must
 * not stamp stale mission-level fields back over them.
 *
 * Usage:
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/backfill-mission-runs.mjs            # dry run, writes nothing
 *   node scripts/backfill-mission-runs.mjs --apply
 *
 *   --undo    delete every run document this would create (rollback)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing ${name}. Source the target project's .env first.`);
    process.exit(1);
  }
  return raw;
}

const projectId = requireEnv('FIREBASE_PROJECT_ID');
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

initializeApp(
  clientEmail && privateKey
    ? {
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
        }),
      }
    : { credential: applicationDefault(), projectId },
);

const db = getFirestore();

console.log(`project: ${projectId}`);
console.log(`MODE: ${UNDO ? 'UNDO' : APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

const missions = await db.collection('missions').get();

let created = 0;
let skipped = 0;
let noYard = 0;
let deleted = 0;

for (const missionDoc of missions.docs) {
  const m = missionDoc.data();
  const yardId = m.yardId;

  if (!yardId) {
    // Nothing to key a run on. Leaving it alone is right: inventing a yard
    // would claim a rover ran it, which nobody established.
    noYard += 1;
    continue;
  }

  const runRef = missionDoc.ref.collection('runs').doc(yardId);

  if (UNDO) {
    const existing = await runRef.get();
    if (existing.exists) {
      if (APPLY) await runRef.delete();
      deleted += 1;
    }
    continue;
  }

  const existing = await runRef.get();
  if (existing.exists) {
    skipped += 1;
    continue;
  }

  const run = {
    yardId,
    status: m.status ?? 'queued',
    ...(m.startedAt ? { startedAt: m.startedAt } : {}),
    ...(m.completedAt ? { completedAt: m.completedAt } : {}),
    ...(m.youtubeUrl ? { youtubeUrl: m.youtubeUrl } : {}),
    ...(m.needsReview ? { needsReview: true } : {}),
    ...(m.reviewReason ? { reviewReason: m.reviewReason } : {}),
    statusUpdatedAt: m.statusUpdatedAt ?? m.submittedAt ?? null,
  };

  if (APPLY) await runRef.set(run);
  created += 1;

  if (created <= 5) {
    console.log(`  ${missionDoc.id}  ->  runs/${yardId}  (${run.status}${run.youtubeUrl ? ', has video' : ''})`);
  }
}

console.log();
console.log(`missions scanned      : ${missions.size}`);
if (UNDO) {
  console.log(`run documents ${APPLY ? 'deleted' : 'to delete'} : ${deleted}`);
} else {
  console.log(`runs ${APPLY ? 'created' : 'to create'}          : ${created}`);
  console.log(`already had a run     : ${skipped}`);
  console.log(`no yardId, left alone : ${noYard}`);
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to write.`);
}

process.exit(0);
