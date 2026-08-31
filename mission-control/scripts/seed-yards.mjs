/**
 * Seed the yards collection from the hardcoded registry.
 *
 * KNOWN_YARDS in src/infrastructure/config/yards.ts was the list. It becomes
 * Firestore data so an admin can add the next venue without a deploy, and this
 * carries what is already there across.
 *
 * IDEMPOTENT: merges, so re-running does not clobber a name an admin has since
 * corrected, and does not resurrect a yard they have retired.
 *
 * Usage:
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/seed-yards.mjs            # dry run
 *   node scripts/seed-yards.mjs --apply
 *
 * Needs FIREBASE_PROJECT_ID and Application Default Credentials
 * (`gcloud auth application-default login`).
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing ${name}. Source mission-control/.env first.`);
    process.exit(1);
  }
  return raw.trim().replace(/^["']|["']$/g, '');
}

const projectId = requireEnv('FIREBASE_PROJECT_ID');

initializeApp({
  credential: applicationDefault(),
  projectId,
});

// Mirrored rather than imported: this is a .mjs script and the registry is TS.
// It is a one-time carry-across, so a copy that stops being read the moment
// this has run is honest about its lifetime.
const YARDS = [
  {
    id: 'curiosity',
    formerIds: ['uct-rover-1', 'cape-town'],
    name: 'Cape Town Science Centre',
    area: 'Observatory',
    city: 'Cape Town',
    active: true,
  },
];

const db = getFirestore();

console.log(`project: ${projectId}`);
console.log(APPLY ? 'MODE: APPLY (will write)\n' : 'MODE: DRY RUN (no writes)\n');

for (const yard of YARDS) {
  const ref = db.collection('yards').doc(yard.id);
  const existing = await ref.get();

  if (existing.exists) {
    console.log(`  ${yard.id}: already present, leaving it alone`);
    continue;
  }

  const { id, ...fields } = yard;
  console.log(`  ${id}: ${fields.name}, ${fields.area} (${fields.city})`);

  if (APPLY) {
    await ref.set({ ...fields, createdAt: new Date().toISOString(), addedBy: 'seed-yards.mjs' });
  }
}

console.log(APPLY ? '\nDone.' : '\nDry run. Re-run with --apply to write.');
process.exit(0);
