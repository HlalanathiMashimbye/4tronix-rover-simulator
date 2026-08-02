#!/usr/bin/env node
/**
 * Grant or revoke operator / admin access.
 *
 * WHY THIS WRITES IN TWO PLACES. This codebase currently checks the role two
 * different ways, and they read from different stores:
 *
 *   yard/satellite/operator_console.py  ->  claims.get('role')
 *       a Firebase Auth CUSTOM CLAIM, carried on the ID token
 *
 *   firestore.rules  ->  users/{uid}.role == "operator"
 *       a Firestore DOCUMENT, read with get() inside the rule
 *
 * Set only the claim and the yard console lets you in while Firestore rules
 * deny you. Set only the document and the reverse happens. So this script
 * writes both, keeping them consistent, and clears both on revoke.
 *
 * KNOWN GAP, not fixed here: firestore.rules' isOperator() compares against
 * "operator" ONLY, while the yard accepts 'operator' or 'admin'. An admin can
 * therefore use the operator console but is denied by Firestore rules (on
 * rover-configs, for instance). Granting 'admin' below will warn about this.
 * Fixing it means changing the rule to accept both roles - a deliberate
 * decision, not something a grant script should do behind your back.
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
console.log(`current claim: ${existingClaims.role ?? '(none)'}`);

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
  console.log('  - custom claim  role=' + role + '   (read by the yard operator console)');
  console.log('  - users/' + user.uid + '.role=' + role + '   (read by firestore.rules)');

  if (role === 'admin') {
    console.log(
      '\nWARNING: firestore.rules isOperator() compares against "operator" only, so\n' +
      "         this account will pass the yard console but be DENIED by Firestore\n" +
      '         rules. Grant "operator" as well, or widen the rule.'
    );
  }

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
