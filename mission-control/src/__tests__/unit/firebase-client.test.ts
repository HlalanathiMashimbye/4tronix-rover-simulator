/**
 * @jest-environment jsdom
 */

/**
 * The browser opens the Firestore database the page names.
 *
 * This bundle was built for staging and is promoted to prod unchanged, so the
 * database cannot come from a NEXT_PUBLIC_ value: on prod it would be staging's.
 * The server renders it into the page (FirestoreDatabaseMeta) and the client
 * reads it back from there.
 */

const initializeFirestore = jest.fn(() => ({ kind: 'firestore' }));
const getFirestore = jest.fn(() => ({ kind: 'existing' }));

jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'client-app' })),
  getApps: jest.fn(() => []),
}));
jest.mock('firebase/firestore', () => ({
  initializeFirestore: (...args: unknown[]) => initializeFirestore(...(args as [])),
  getFirestore: (...args: unknown[]) => getFirestore(...(args as [])),
}));
jest.mock('firebase/auth', () => ({ getAuth: jest.fn() }));

function servePage(meta: string) {
  document.head.innerHTML = meta;
}

beforeEach(() => {
  jest.resetModules();
  initializeFirestore.mockClear();
  getFirestore.mockClear();
});

async function openClient() {
  const { getFirestoreClient } = await import('@/infrastructure/persistence/firebase-client');
  return getFirestoreClient();
}

it('opens the database the page names', async () => {
  servePage('<meta name="firestore-database" content="prod">');

  await openClient();

  expect(initializeFirestore).toHaveBeenCalledWith(
    { name: 'client-app' },
    expect.objectContaining({ experimentalForceLongPolling: true }),
    'prod',
  );
});

it('opens (default) on a page that names none', async () => {
  servePage('');

  await openClient();

  expect(initializeFirestore).toHaveBeenCalledWith(expect.anything(), expect.anything(), '(default)');
});

it('keeps the database when Firestore was already started for this app', async () => {
  servePage('<meta name="firestore-database" content="prod">');
  initializeFirestore.mockImplementationOnce(() => {
    throw new Error('already initialised');
  });

  await openClient();

  expect(getFirestore).toHaveBeenCalledWith({ name: 'client-app' }, 'prod');
});
