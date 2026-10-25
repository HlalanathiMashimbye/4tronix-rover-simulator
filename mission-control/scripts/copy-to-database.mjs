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
 * RUN IT AGAIN FOR MORE MISSIONS. Prod can go live before David has picked
 * any, so the yard and the operators go across on the first run and his
 * missions on a later one. The yard, users and invite documents are therefore
 * only ever added, never overwritten: after the first run prod owns them, and
 * a second run must not put staging's old yard record back over a change made
 * on prod. Missions are the other way round: one already in prod stops the
 * run unless --force says to overwrite it.
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
 *   --force            overwrite picked missions that already exist in the target
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

/**
 * { ref, data, keep } entries, gathered first so a dry run and an apply agree.
 * `keep` is true for documents prod owns once it has them (yard, users,
 * invites): an existing one is left alone rather than overwritten.
 */
const writes = [];

/** A document and everything under it, at the same path in the target. */
async function gather(docRef, { clean = (data) => data, keep = false } = {}) {
  const snap = await docRef.get();
  if (!snap.exists) return false;
  writes.push({ ref: target.doc(docRef.path), data: clean({ ...snap.data() }), keep });
  for (const sub of await docRef.listCollections()) {
    for (const child of (await sub.get()).docs) {
      await gather(child.ref, { clean, keep });
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
  if (!(await gather(ref, { clean: withoutEmail }))) {
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
    await gather(doc.ref, { keep: true });
  }
}

const counts = {};
for (const { ref } of writes) {
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

// What the target already has: prod's own yard and operators are kept, and a
// picked mission that is already there stops the run unless --force.
const toWrite = [];
const clashes = [];
let kept = 0;
for (const write of writes) {
  if (!(await write.ref.get()).exists) {
    toWrite.push(write);
  } else if (write.keep) {
    kept += 1;
  } else if (FORCE) {
    toWrite.push(write);
  } else {
    clashes.push(write.ref.path);
  }
}
if (clashes.length) {
  console.error(`\n${clashes.length} picked document(s) already exist in ${TO}, e.g. ${clashes.slice(0, 3).join(', ')}.`);
  console.error('Refusing to overwrite. Pass --force if that is what you mean. Nothing was written.');
  process.exit(1);
}

for (let at = 0; at < toWrite.length; at += 400) {
  const batch = target.batch();
  for (const { ref, data } of toWrite.slice(at, at + 400)) batch.set(ref, data);
  await batch.commit();
}
console.log(`\nWrote ${toWrite.length} document(s) to ${TO}.`);
if (kept) console.log(`Left ${kept} yard, user or invite document(s) ${TO} already had.`);
