#!/usr/bin/env node
/**
 * One-off migration: rename the Cape Town yard's id to `curiosity`.
 *
 * The rover answers to `curiosity.local` on the yard LAN, so that is what the
 * missions it ran should be tagged with. The old value, `uct-rover-1`, matched
 * nothing anyone could see on the network or in the room, which made tracing a
 * mission back to a physical machine an act of memory. One stray mission also
 * carries `cape-town`, from a hand-edit; it is folded in here.
 *
 * Safe to run now, and meaningfully harder later: no mission has a `runs`
 * subcollection yet, because the per-yard backfill has not been applied. Runs
 * are keyed BY yard id as the document id, so once they exist a rename stops
 * being a field update and becomes a copy-and-delete of every run document.
 * Run this before that backfill.
 *
 * Display does not depend on this. `formerIds` in mission-control's yard config
 * already resolves the old ids to the same place, so a learner reads
 * "Cape Town Science Centre" either way. This migration is about the data
 * agreeing with the network, not about fixing a visible bug.
 *
 * The satellite's DEFAULT_YARD_ID changes in the same commit. Until a satellite
 * restarts with the new value it writes the old id, which `formerIds` still
 * displays correctly, but its queue query is scoped by yard id and would not
 * match migrated missions. Restart the satellite after applying.
 *
 * Usage (dry run prints what would change and touches nothing):
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/rename-yard-to-curiosity.mjs
 *   node scripts/rename-yard-to-curiosity.mjs --apply
 *
 * Reversing it: run with --undo (dry run by default likewise), which puts
 * `uct-rover-1` back on everything this script moved.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');

const NEW_ID = 'curiosity';
const OLD_IDS = ['uct-rover-1', 'cape-town'];
// What --undo restores. The stray 'cape-town' mission is deliberately not
// restored to 'cape-town': it was a hand-edit, not a state worth preserving.
const ROLLBACK_ID = 'uct-rover-1';

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

const from = UNDO ? [NEW_ID] : OLD_IDS;
const to = UNDO ? ROLLBACK_ID : NEW_ID;

console.log(`project: ${projectId}`);
console.log(`direction: ${from.join(', ')} -> ${to}`);
console.log(APPLY ? 'MODE: APPLY (will write)\n' : 'MODE: DRY RUN (no writes)\n');

const missions = await db.collection('missions').get();

const toMove = [];
const alreadyThere = [];
const unknown = [];
let runDocsFound = 0;

for (const doc of missions.docs) {
  const yardId = doc.get('yardId');
  if (from.includes(yardId)) toMove.push({ doc, yardId });
  else if (yardId === to) alreadyThere.push(doc.id);
  else unknown.push({ id: doc.id, yardId: yardId ?? '(unset)' });

  // Guard rather than assume. If runs exist, a field update is not enough:
  // the run document id is the yard id, so they would be stranded under the
  // old key and the mission would look like it never ran anywhere.
  const runs = await doc.ref.collection('runs').listDocuments();
  if (runs.length) runDocsFound += runs.length;
}

console.log(`${missions.size} mission(s) scanned`);
console.log(`  ${toMove.length} to move`);
console.log(`  ${alreadyThere.length} already ${to}`);
if (unknown.length) {
  console.log(`  ${unknown.length} on some other yard, left alone:`);
  for (const u of unknown) console.log(`      ${u.id}  yardId=${u.yardId}`);
}

if (runDocsFound) {
  console.error(
    `\nSTOP: found ${runDocsFound} run document(s). Run documents are keyed by` +
    ' yard id, so this field-only migration would strand them under the old' +
    ' key. Extend this script to copy runs across before continuing.',
  );
  process.exit(1);
}

const counts = {};
for (const m of toMove) counts[m.yardId] = (counts[m.yardId] || 0) + 1;
for (const [yardId, n] of Object.entries(counts)) console.log(`      ${n} from ${yardId}`);

if (!toMove.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to move ${toMove.length} mission(s).`);
  process.exit(0);
}

// Batched, 400 at a time, under Firestore's 500-write limit.
let written = 0;
for (let i = 0; i < toMove.length; i += 400) {
  const batch = db.batch();
  for (const { doc } of toMove.slice(i, i + 400)) {
    batch.update(doc.ref, { yardId: to });
  }
  await batch.commit();
  written += Math.min(400, toMove.length - i);
  console.log(`  committed ${written}/${toMove.length}`);
}

console.log(`\nMoved ${written} mission(s) to ${to}.`);
console.log('Restart the satellite so its queue query uses the new id.');
