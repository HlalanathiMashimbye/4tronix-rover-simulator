/**
 * Jest Setup File
 * Runs before all tests
 */

import '@testing-library/jest-dom';

// Mock environment variables for tests.
//
// The project id only. There is no service-account credential path any more,
// and firebase-admin.ts now REFUSES to start when FIREBASE_CLIENT_EMAIL or
// FIREBASE_PRIVATE_KEY is set, so seeding a fake pair here would fail every
// suite that reaches it.
process.env.FIREBASE_PROJECT_ID = 'test-project';
