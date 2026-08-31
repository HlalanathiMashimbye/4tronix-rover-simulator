/**
 * Firebase Admin SDK Initialization
 *
 * Singleton pattern to ensure Firebase Admin is initialized once.
 *
 * Credentials come from Application Default Credentials, and only from there.
 * On Cloud Run the runtime service account already holds roles/datastore.user
 * in the same project Firestore lives in; locally you sign in once with
 * `gcloud auth application-default login`. Either way no credential is stored
 * in the repo, in a .env, or in Secret Manager: nothing to rotate, nothing to
 * leak, nothing to copy onto a second laptop.
 *
 * There used to be a service-account branch reading FIREBASE_CLIENT_EMAIL and
 * FIREBASE_PRIVATE_KEY. Every deployment we run has Firestore in the same
 * project as the service (infra/impact.tfvars sets firebase_credential_source
 * = "adc"), so the branch authenticated nothing and existed only as a
 * documented reason to put a private key in a .env file. It is gone. The one
 * genuine cross-project case, copying between two Firestore projects, lives in
 * scripts/migrate-to-project.mjs, which takes its credentials explicitly.
 *
 * FIREBASE_PROJECT_ID is still required. ADC can infer the project from the
 * metadata server, but requiring it keeps "no config at all" a loud error
 * instead of silently authenticating against whatever project a developer's
 * gcloud happens to point at.
 */

import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

let app: App | undefined;
let firestoreInstance: Firestore | undefined;
let authInstance: Auth | undefined;

function normalizeEnvValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function resolveProjectId(): string {
  const projectId = normalizeEnvValue(
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.REACT_APP_FIREBASE_PROJECT_ID
  );

  if (!projectId) {
    throw new Error(
      [
        'Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID.',
        'The /api/missions route uses the Firebase Admin SDK.',
        'Client-side Firebase config such as NEXT_PUBLIC_FIREBASE_* or REACT_APP_FIREBASE_* is not enough on its own.',
        'Set FIREBASE_PROJECT_ID and sign in with `gcloud auth application-default login`.',
      ].join(' ')
    );
  }

  // Refused rather than ignored. Someone with these still set believes they
  // are authenticating as that service account; silently using ADC instead
  // would run as a different identity with different permissions, which is
  // the failure this is worth a hard stop to prevent.
  if (process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error(
      [
        'FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are set, but the service-account',
        'credential path has been removed. Authentication is Application Default',
        'Credentials only: run `gcloud auth application-default login`, delete both',
        'variables from your .env, and delete the key itself in the Google Cloud',
        'console, since a key that still exists is still a way in.',
      ].join(' ')
    );
  }

  return projectId;
}

/**
 * Initialize Firebase Admin SDK
 * Safe to call multiple times - only initializes once
 */
export function initializeFirebaseAdmin(): App {
  if (app) {
    return app;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    return app;
  }

  // Resolved first, deliberately: applicationDefault() throws its own opaque
  // error when no credential is present, and evaluating it inside the object
  // literal would let that beat the far more useful messages above to the
  // console.
  const projectId = resolveProjectId();

  app = initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  return app;
}

/**
 * Get Firestore instance
 * Initializes Firebase Admin if not already initialized
 */
export function getFirestoreInstance(): Firestore {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  initializeFirebaseAdmin();
  firestoreInstance = getFirestore();

  return firestoreInstance;
}

/**
 * Firebase Admin Auth, for verifying operator session cookies server-side.
 *
 * Restored for AB#341. It was removed when the operator console moved to the
 * yard satellite and mission-control became learner-only; the console is coming
 * back as a role-gated route, so the server needs to verify sessions again.
 *
 * Shares initializeFirebaseAdmin() with Firestore, so it inherits the same
 * credentials.
 */
export function getFirebaseAdminAuth(): Auth {
  if (authInstance) {
    return authInstance;
  }

  initializeFirebaseAdmin();
  authInstance = getAuth();

  return authInstance;
}
