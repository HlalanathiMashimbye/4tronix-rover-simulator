#!/usr/bin/env node
/**
 * Copy Firestore data from one project to another (dev -> impact prod).
 *
 * Firebase has no built-in cross-project migration on the Spark plan, so this
 * is the read-and-write script that replaces it.
 *
 * THE POINT OF THIS SCRIPT IS THE SHAPE IT WRITES, NOT THE COPYING.
 *
 * A verbatim copy would recreate a privacy bug in a brand new database. Learner
 * documents used to carry a plaintext `learnerEmail`, and because mission
 * documents are world-readable and carry `learnerId`, anyone could read the
 * feed, collect ids and fetch each learner document to harvest children's email
 * addresses. That was fixed in the app and migrated on the source project.
 *
 * Security rules DO NOT protect the target from this script: the Admin SDK
 * bypasses rules entirely. Nothing but this code stops the old shape being
 * written into prod. So:
 *
 *   - `learnerEmail` is stripped from every learner document and written to
 *     learners/{id}/private/contact, which browsers cannot read.
 *   - `learnerEmail` is stripped from every mission document, which should
 *     already be true post-migrate-learner-email-hash, but is enforced here so
 *     a stale source record cannot leak one into a clean database.
 *
 * Document ids are preserved, so mission links, learner ids and the
 * learnerEmailHash lookups all keep working.
 *
 * IDEMPOTENT-ISH: re-running overwrites target documents with source content.
 * It does not delete target documents that no longer exist in the source. The
 * guard below refuses to touch a non-empty target unless you pass --force,
 * because running this twice by accident against a live database is the
 * expensive mistake.
 *
 * Usage:
 *   cd mission-control
 *   set -a && source .env && set +a          # source project creds
 *   export TARGET_FIREBASE_PROJECT_ID=bt-impact-academy
 *   export TARGET_FIREBASE_CLIENT_EMAIL=...
 *   export TARGET_FIREBASE_PRIVATE_KEY=...
 *   node scripts/migrate-to-project.mjs              # dry run
 *   node scripts/migrate-to-project.mjs --apply
 *
 * Options:
 *   --apply         actually write
 *   --force         proceed even if the target already holds data
 *   --only <name>   migrate a single collection (missions | learners | rover-configs)
 *
 * THE ONE PLACE SERVICE-ACCOUNT KEYS SURVIVE, deliberately. Everything else
 * that touches Firestore authenticates with Application Default Credentials
 * and refuses to start if FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY is
 * set. This script is the exception because it talks to TWO projects at once,
 * and ADC only signs you in to one: the target can use ADC (leave the TARGET_
 * pair unset), but the source generally cannot, which is the whole reason you
 * are migrating away from it.
 *
 * So: this is not a pattern to copy. Use a key here, for one run, and delete
 * it in the Google Cloud console afterwards rather than leaving it in a .env,
 * since a key that still exists is still a way in.
 */

import { createHash } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

// Kept in sync by hand with core/domain/services/learnerContact.ts.
const PRIVATE_COLLECTION = 'private';
const CONTACT_DOC = 'contact';

const COLLECTIONS = ['missions', 'learners', 'rover-configs'];

// Must produce byte-identical output to hashLearnerId() in
// core/domain/services/learnerRef.ts. Pinned by a test there; a mismatch would
// not throw, it would quietly write refs the app never queries for.
const hashLearnerId = (id) => createHash('sha256').update(id.trim()).digest('hex');

if (ONLY && !COLLECTIONS.includes(ONLY)) {
  console.error(`--only must be one of: ${COLLECTIONS.join(', ')}`);
  process.exit(1);
}

function envValue(name, { required = true } = {}) {
  const raw = process.env[name];
  if (!raw) {
    if (!required) return undefined;
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  const t = raw.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
}

const sourceProjectId = envValue('FIREBASE_PROJECT_ID');
const targetProjectId = envValue('TARGET_FIREBASE_PROJECT_ID');

if (sourceProjectId === targetProjectId) {
  console.error('Source and target are the same project. Refusing to run.');
  process.exit(1);
}

const sourceApp = initializeApp(
  {
    credential: cert({
      projectId: sourceProjectId,
      clientEmail: envValue('FIREBASE_CLIENT_EMAIL'),
      privateKey: envValue('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  },
  'source',
);

// A service account for the target is preferred, but falls back to
// Application Default Credentials so a human who already has access to the
// target project (gcloud auth application-default login) can run this without
// anyone minting and passing around a key file.
const targetClientEmail = envValue('TARGET_FIREBASE_CLIENT_EMAIL', { required: false });
const targetPrivateKey = envValue('TARGET_FIREBASE_PRIVATE_KEY', { required: false });
const usingADC = !targetClientEmail || !targetPrivateKey;

const targetApp = initializeApp(
  {
    credential: usingADC
      ? applicationDefault()
      : cert({
          projectId: targetProjectId,
          clientEmail: targetClientEmail,
          privateKey: targetPrivateKey.replace(/\\n/g, '\n'),
        }),
    projectId: targetProjectId,
  },
  'target',
);

const source = getFirestore(sourceApp);
const target = getFirestore(targetApp);

console.log(`source:  ${sourceProjectId}`);
console.log(`target:  ${targetProjectId}${usingADC ? '  (via application default credentials)' : '  (via service account)'}`);
console.log(APPLY ? 'MODE:    APPLY (will write to the target)' : 'MODE:    DRY RUN (no writes)');
if (ONLY) console.log(`only:    ${ONLY}`);
console.log('');

// --- Guard: never silently write into a database that already has data -----
for (const name of ONLY ? [ONLY] : COLLECTIONS) {
  const existing = await target.collection(name).limit(1).get();
  if (!existing.empty) {
    console.log(`target already has documents in '${name}'.`);
    if (!FORCE) {
      console.error(
        '\nRefusing to run. Re-running a migration over live data overwrites it.\n' +
        'Pass --force if you genuinely intend to overwrite.',
      );
      process.exit(1);
    }
    console.log('  --force given, continuing anyway.\n');
  }
}

let totalDocs = 0;
let totalWrites = 0;
let addressesRelocated = 0;
let missionAddressesStripped = 0;
let learnerRefsDerived = 0;

for (const name of ONLY ? [ONLY] : COLLECTIONS) {
  const snap = await source.collection(name).get();
  console.log(`${name}: ${snap.size} document(s)`);
  totalDocs += snap.size;

  for (const docSnap of snap.docs) {
    const data = { ...docSnap.data() };
    const targetRef = target.collection(name).doc(docSnap.id);

    if (name === 'learners') {
      // The address never goes on the parent document. See the header.
      const address = typeof data.learnerEmail === 'string' ? data.learnerEmail.trim() : '';
      delete data.learnerEmail;

      // Prefer an address already relocated on the source; fall back to a
      // legacy one still sitting on the parent.
      const sourceContact = await docSnap.ref
        .collection(PRIVATE_COLLECTION)
        .doc(CONTACT_DOC)
        .get();
      const contactAddress =
        (typeof sourceContact.data()?.learnerEmail === 'string'
          ? sourceContact.data().learnerEmail
          : '') || address;

      if (contactAddress) {
        addressesRelocated += 1;
        totalWrites += 1;
        if (APPLY) {
          await targetRef
            .collection(PRIVATE_COLLECTION)
            .doc(CONTACT_DOC)
            .set({ learnerEmail: contactAddress, migratedAt: new Date().toISOString() });
        }
      }
    }

    if (name === 'missions') {
      if ('learnerEmail' in data) {
        // Should already be gone; enforced so a stale record cannot seed a
        // plaintext address onto a world-readable document in a clean database.
        delete data.learnerEmail;
        missionAddressesStripped += 1;
      }

      // The raw learner id must never reach the target. Publishing it is what
      // made possession of an id meaningless; only the hash belongs on a
      // world-readable document. Older records fall back to sessionId, the
      // same generous rule the other learner scripts use.
      const rawLearnerId = data.learnerId || data.sessionId;
      if (rawLearnerId && !data.learnerRef) {
        data.learnerRef = hashLearnerId(rawLearnerId);
        learnerRefsDerived += 1;
      }
      delete data.learnerId;
    }

    if (name === 'learners' && !data.learnerRef) {
      // The document id IS the learner id, and the notification service finds
      // the record by this field rather than by id.
      data.learnerRef = hashLearnerId(docSnap.id);
      learnerRefsDerived += 1;
    }

    totalWrites += 1;
    if (APPLY) {
      await targetRef.set(data);
    }
  }
}

console.log('');
console.log(`documents read from source:        ${totalDocs}`);
console.log(`addresses written to private/:     ${addressesRelocated}`);
console.log(`plaintext addresses stripped off missions: ${missionAddressesStripped}`);
console.log(`learnerRef hashes derived:         ${learnerRefsDerived}`);
console.log(`writes ${APPLY ? 'performed' : 'that would be performed'}: ${totalWrites}`);

if (!APPLY) {
  console.log('\nRe-run with --apply to write to the target.');
} else {
  console.log(
    '\nDone. Before calling this finished:\n' +
    '  - open the feed against the target and confirm missions render\n' +
    '  - confirm NO learner document has a learnerEmail field\n' +
    '  - confirm NO mission document has a learnerId field\n' +
    '  - confirm history by learner id and by email hash both return results\n' +
    '    (these need the composite indexes deployed on the target)',
  );
}
