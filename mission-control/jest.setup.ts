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

// Node 20's Jest VM does not always expose fetch, but firebase/auth now checks
// it during module initialisation. Provide a test default that fails loudly if
// a suite forgets to mock the request it expects.
if (typeof globalThis.Headers !== 'function') {
  globalThis.Headers = class Headers {} as unknown as typeof Headers;
}

if (typeof globalThis.Request !== 'function') {
  globalThis.Request = class Request {} as unknown as typeof Request;
}

if (typeof globalThis.Response !== 'function') {
  globalThis.Response = class Response {} as unknown as typeof Response;
}

if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = jest.fn(async () => {
    throw new Error('Unexpected fetch call in test; mock global.fetch in this suite.');
  }) as unknown as typeof fetch;
}
