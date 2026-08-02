/**
 * Firebase Admin SDK Initialization
 *
 * Singleton pattern to ensure Firebase Admin is initialized once.
 *
 * Two credential sources, chosen by what the environment provides:
 *
 * - **Service account** (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).
 *   Used for local development and anywhere outside the Firestore project.
 *
 * - **Application Default Credentials** (neither of the above set).
 *   On Cloud Run the runtime service account already holds
 *   roles/datastore.user in the same project Firestore lives in, so no
 *   credentials need to exist at all: no key to store in Secret Manager,
 *   none to rotate, none to leak.
 *
 * FIREBASE_PROJECT_ID is required either way. ADC can technically infer the
 * project from the metadata server, but requiring it keeps "no config at all"
 * a loud error instead of silently authenticating against whatever project a
 * developer's gcloud happens to point at.
 */

import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let app: App | undefined;
let firestoreInstance: Firestore | undefined;

type FirebaseAdminConfig =
  | {
      credentialSource: 'service-account';
      projectId: string;
      clientEmail: string;
      privateKey: string;
    }
  | {
      credentialSource: 'application-default';
      projectId: string;
    };

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

function getFirebaseAdminConfig(): FirebaseAdminConfig {
  const projectId = normalizeEnvValue(
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.REACT_APP_FIREBASE_PROJECT_ID
  );
  const clientEmail = normalizeEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizeEnvValue(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId) {
    throw new Error(
      [
        'Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID.',
        'The /api/missions route uses the Firebase Admin SDK.',
        'Client-side Firebase config such as NEXT_PUBLIC_FIREBASE_* or REACT_APP_FIREBASE_* is not enough on its own.',
        'Set FIREBASE_PROJECT_ID, and either both of FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY,',
        'or neither of them to use Application Default Credentials (the runtime service account on Cloud Run).',
      ].join(' ')
    );
  }

  if (clientEmail && privateKey) {
    return { credentialSource: 'service-account', projectId, clientEmail, privateKey };
  }

  // Exactly one half of the pair is set. That is nearly always a broken .env
  // rather than a deliberate choice, and silently falling back to ADC here
  // would authenticate as a DIFFERENT identity than the one intended. Fail loudly.
  if (clientEmail || privateKey) {
    const missing = clientEmail ? 'FIREBASE_PRIVATE_KEY' : 'FIREBASE_CLIENT_EMAIL';
    const present = clientEmail ? 'FIREBASE_CLIENT_EMAIL' : 'FIREBASE_PRIVATE_KEY';
    throw new Error(
      [
        `Incomplete Firebase Admin service account config: ${present} is set but ${missing} is not.`,
        'Set both to authenticate with a service account, or unset both to use',
        'Application Default Credentials.',
      ].join(' ')
    );
  }

  return { credentialSource: 'application-default', projectId };
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

  const config = getFirebaseAdminConfig();

  app = initializeApp(
    config.credentialSource === 'service-account'
      ? {
          credential: cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            // \n survives .env files as the two characters backslash-n.
            privateKey: config.privateKey.replace(/\\n/g, '\n'),
          }),
        }
      : {
          credential: applicationDefault(),
          projectId: config.projectId,
        }
  );

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
