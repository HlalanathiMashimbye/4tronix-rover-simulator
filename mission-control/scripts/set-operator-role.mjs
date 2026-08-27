#!/usr/bin/env node
/**
 * Grant or revoke operator / admin access.
 *
 * WHAT THIS WRITES, AND WHERE IT IS READ.
 *
 * Roles and yards live on the Firebase Auth CUSTOM CLAIM, carried on the ID
 * token. One store, read by everything that enforces:
 *
 *   firestore.rules                     ->  request.auth.token.role
 *   mission-control lib/auth/dal.ts     ->  the verified session cookie
 *   yard/satellite/operator_console.py  ->  claims.get('role')
 *
 * It used to be two stores. These rules read a users/{uid} DOCUMENT while the
 * console read the claim, so this script had to write both and they still
 * disagreed: the console accepted operator OR admin, the rule accepted
 * "operator" only, so an admin passed one and was denied by the other. That
 * was documented here as a KNOWN GAP for months. Claim-based rules closed it.
 *
 * users/{uid} is still written, but only as a human-readable ledger of who
 * holds what. Nothing enforces from it. It is readable by admins alone,
 * because the list of everyone with operator access is not something a
 * signed-in learner needs.
 *
 * `role` decides what an account may do. It does NOT decide where: operators
 * choose their yard when they sign in rather than being assigned one, which
 * the sponsor was explicit about on 2026-08-27. A yardIds claim briefly
 * existed here and has been removed.
 *
 * THIS IS NO LONGER THE NORMAL WAY TO GRANT ACCESS.
 *
 * An admin does it in the app now, at /operator/team. That page calls the same
 * Admin SDK operations this script does, so the two cannot drift, and it
 * records WHICH ADMIN granted the access rather than $USER from whatever shell
 * happened to run this.
 *
 * What this script is still for is the one job the page cannot do: creating the
 * FIRST admin. /operator/team requires an admin to already exist, so a fresh
 * project has to be bootstrapped from here. It is also the break-glass path if
 * every admin account is ever lost, which is exactly why that page refuses to
 * revoke the last one.
 *
 * Still ahead: an apply-to-be-an-operator flow that emails an admin for
 * one-click approval, so a facilitator can ask rather than being added.
 *
 * The user must already exist in Firebase Auth: sign in once through the app
 * or the operator console first. Roles are granted TO an account, they do not
 * create one.
 *
 * Usage (dry run prints what would change and writes nothing):
 *   cd mission-control
 *   set -a && source .env && set +a
 *   node scripts/set-operator-role.mjs --email someone@example.com --role operator
 *   node scripts/set-operator-role.mjs --email someone@example.com --role operator --apply
 *   node scripts/set-operator-role.mjs --email someone@example.com --revoke --apply
 *
 * To act on a different project, source that project's env first. The script
 * prints the project it is about to touch - read it before passing --apply.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REVOKE = args.includes('--revoke');

function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const email = argValue('--email');
const uidArg = argValue('--uid');
const role = argValue('--role') ?? 'operator';


const VALID_ROLES = ['operator', 'admin'];

if (!email && !uidArg) {
  console.error('Specify --email <address> or --uid <uid>.');
  process.exit(1);
}

if (!REVOKE && !VALID_ROLES.includes(role)) {
  console.error(`--role must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

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
  credential: cert({
    projectId,
    clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
    privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }),
});

const auth = getAuth();
const db = getFirestore();

console.log(`project: ${projectId}`);
console.log(APPLY ? 'MODE: APPLY (will write)' : 'MODE: DRY RUN (no writes)');
console.log('');

let user;
try {
  user = uidArg ? await auth.getUser(uidArg) : await auth.getUserByEmail(email);
} catch (error) {
  if (error.code === 'auth/user-not-found') {
    console.error(
      `No Firebase Auth user for ${uidArg ?? email}.\n` +
      'They must sign in once before a role can be granted - this script does ' +
      'not create accounts.'
    );
    process.exit(1);
  }
  throw error;
}

const existingClaims = user.customClaims ?? {};

console.log(`user:          ${user.email ?? '(no email)'}`);
console.log(`uid:           ${user.uid}`);
console.log(`current claim: role=${existingClaims.role ?? '(none)'}`);

const userDocRef = db.collection('users').doc(user.uid);
const userDocSnap = await userDocRef.get();
console.log(`current doc:   ${userDocSnap.exists ? (userDocSnap.data()?.role ?? '(no role field)') : '(no document)'}`);
console.log('');

if (REVOKE) {
  console.log('action: REVOKE - clearing the custom claim and the users document');

  if (APPLY) {
    // Preserve any unrelated claims rather than wiping the whole object.
    const { role: _removed, ...rest } = existingClaims;
    await auth.setCustomUserClaims(user.uid, rest);
    await userDocRef.set(
      { role: null, revokedAt: new Date().toISOString() },
      { merge: true },
    );
    // Existing sessions keep working until their ID token expires. Revoking
    // refresh tokens forces a re-authentication now, which is what you
    // actually want when removing access.
    await auth.revokeRefreshTokens(user.uid);
    console.log('\nRevoked. Refresh tokens invalidated, so existing sessions must sign in again.');
  }
} else {
  console.log(`action: GRANT '${role}'`);
  console.log('  - custom claim  role=' + role + '   (read by firestore.rules and the operator console)');
  console.log('  - users/' + user.uid + '   (human-readable ledger only, nothing enforces from it)');

  if (APPLY) {
    await auth.setCustomUserClaims(user.uid, { ...existingClaims, role });
    await userDocRef.set(
      {
        role,
        email: user.email ?? null,
        grantedAt: new Date().toISOString(),
        grantedBy: process.env.USER ?? 'unknown',
      },
      { merge: true },
    );
    console.log(
      '\nGranted. NOTE: custom claims land on the ID token, so this does not take\n' +
      'effect until their token refreshes - up to an hour, or immediately if they\n' +
      'sign out and back in.'
    );
  }
}

if (!APPLY) {
  console.log('\nRe-run with --apply to write these changes.');
}
