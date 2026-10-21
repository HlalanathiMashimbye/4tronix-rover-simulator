#!/usr/bin/env node
/**
 * Copy what prod starts with from staging's database into prod's.
 *
 * Prod went live on a database of its own, `prod`, in the same project as
 * staging's `(default)`. David's call (12 Oct 2026): prod starts clean, with
 * nothing carried over except missions he picks. So this copies exactly:
 *
 *   - the missions named with --missions, with everything under each one
 *     (runs, audit), and the missionNames document that reserves its name, so
 *     a new prod mission can never be given the same name;
 *   - every yard, because the yard record is configuration the yard reads,
 *     and prod has no other way to get it;
 *   - every users document and pending operatorInvites, the operator side of
 *     sign-in. Roles themselves are custom claims on Firebase Auth users,
 *     which belong to the project, so they need no copying.
 *
 * NOT LEARNERS. A copied mission keeps its learnerRef, so it still shows in
 * that learner's history, but no learner document and no email address is
 * copied: prod starts without children's addresses it was never given.
 * `learnerEmail` is stripped from every mission on the way, as
 * migrate-to-project.mjs does, in case a stale record still carries one.
 *
 * Same project, two databases, so Application Default Credentials cover both:
 *
 *   cd mission-control
 *   gcloud auth application-default login
 *   export FIREBASE_PROJECT_ID=bt-impact-academy
 *   node scripts/copy-to-database.mjs --missions id1,id2      # dry run
 *   node scripts/copy-to-database.mjs --missions id1,id2 --apply
 *
 * Options:
 *   --missions <ids>   comma-separated mission ids (the id, not the name)
 *   --from <db>        source database, default (default)
 *   --to <db>          target database, default prod
 *   --apply            write; without it nothing is written
 *   --force            overwrite documents that already exist in the target
 *
 * The target must already exist: Terraform creates it (docs/go-live.md).
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const FROM = option('--from', '(default)');
const TO = option('--to', 'prod');
const MISSIONS = (option('--missions', '') || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!projectId) {
  console.error('Set FIREBASE_PROJECT_ID (bt-impact-academy).');
  process.exit(1);
}
if (FROM === TO) {
  console.error(`--from and --to are both ${FROM}. Refusing to copy a database onto itself.`);
  process.exit(1);
}

const app = initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId },
);
const source = getFirestore(app, FROM);
const target = getFirestore(app, TO);

console.log(`project: ${projectId}`);
console.log(`from:    ${FROM}`);
console.log(`to:      ${TO}`);
console.log(APPLY ? 'MODE:    APPLY (writes to the target)' : 'MODE:    DRY RUN (writes nothing)');
console.log('');

/** [targetRef, data] pairs, gathered first so a dry run and an apply agree. */
const writes = [];

/** A document and everything under it, at the same path in the target. */
async function gather(docRef, clean = (data) => data) {
  const snap = await docRef.get();
  if (!snap.exists) return false;
  writes.push([target.doc(docRef.path), clean({ ...snap.data() })]);
  for (const sub of await docRef.listCollections()) {
    for (const child of (await sub.get()).docs) {
      await gather(child.ref, clean);
    }
  }
  return true;
}

const withoutEmail = (data) => {
  delete data.learnerEmail;
  return data;
};

const missing = [];
for (const id of MISSIONS) {
  const ref = source.collection('missions').doc(id);
  if (!(await gather(ref, withoutEmail))) {
    missing.push(id);
    continue;
  }
  const name = (await ref.get()).data()?.name;
  if (typeof name === 'string' && name) {
    await gather(source.collection('missionNames').doc(name));
  }
}
if (missing.length) {
  console.error(`No such mission in ${FROM}: ${missing.join(', ')}. Nothing was written.`);
  process.exit(1);
}

for (const collection of ['yards', 'users', 'operatorInvites']) {
  for (const doc of (await source.collection(collection).get()).docs) {
    await gather(doc.ref);
  }
}

const counts = {};
for (const [ref] of writes) {
  const top = ref.path.split('/')[0];
  counts[top] = (counts[top] ?? 0) + 1;
}
for (const [collection, count] of Object.entries(counts)) {
  console.log(`${collection}: ${count} document(s), subcollections included`);
}
console.log(`${writes.length} document(s) in all.`);

if (!APPLY) {
  console.log('\nDry run. Run again with --apply to write them.');
  process.exit(0);
}

// Re-running over live data overwrites whatever prod has done since, so a
// document already in the target stops the run unless that is meant.
if (!FORCE) {
  const existing = [];
  for (const [ref] of writes) {
    if ((await ref.get()).exists) existing.push(ref.path);
  }
  if (existing.length) {
    console.error(`\n${existing.length} of these already exist in ${TO}, e.g. ${existing.slice(0, 3).join(', ')}.`);
    console.error('Refusing to overwrite. Pass --force if that is what you mean.');
    process.exit(1);
  }
}

for (let at = 0; at < writes.length; at += 400) {
  const batch = target.batch();
  for (const [ref, data] of writes.slice(at, at + 400)) batch.set(ref, data);
  await batch.commit();
}
console.log(`\nWrote ${writes.length} document(s) to ${TO}.`);
