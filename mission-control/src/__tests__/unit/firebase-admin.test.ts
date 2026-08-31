/**
 * Credentials are Application Default Credentials, and only that.
 *
 * The service-account branch these tests used to cover is gone: every
 * deployment has Firestore in the same project as the service, so the branch
 * authenticated nothing and existed only as a documented reason to keep a
 * private key in a .env. What is worth testing now is that the project id
 * still resolves the way it did, and that a leftover key is refused loudly
 * rather than quietly ignored.
 */

describe('initializeFirebaseAdmin', () => {
  const originalEnv = process.env;

  async function importFirebaseAdmin() {
    return import('@/infrastructure/persistence/firebase-admin');
  }

  function mockFirebase(applicationDefault = jest.fn(() => 'adc-credential')) {
    const initializeApp = jest.fn(() => ({ name: 'test-app' }));

    jest.doMock('firebase-admin/app', () => ({
      applicationDefault,
      getApps: jest.fn(() => []),
      initializeApp,
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    return { applicationDefault, initializeApp };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    delete process.env.REACT_APP_FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('authenticates with Application Default Credentials', async () => {
    process.env.FIREBASE_PROJECT_ID = 'bt-impact-academy';
    const { applicationDefault, initializeApp } = mockFirebase();

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();
    initializeFirebaseAdmin();

    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(initializeApp).toHaveBeenCalledWith({
      credential: 'adc-credential',
      projectId: 'bt-impact-academy',
    });
  });

  it('falls back to REACT_APP_FIREBASE_PROJECT_ID when FIREBASE_PROJECT_ID is unset', async () => {
    process.env.REACT_APP_FIREBASE_PROJECT_ID = 'legacy-project-id';
    const { initializeApp } = mockFirebase();

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();
    initializeFirebaseAdmin();

    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'legacy-project-id' }),
    );
  });

  it('trims whitespace and surrounding quotes from the project id', async () => {
    process.env.FIREBASE_PROJECT_ID = ' "quoted-project" ';
    const { initializeApp } = mockFirebase();

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();
    initializeFirebaseAdmin();

    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'quoted-project' }),
    );
  });

  it('throws a clear error when no Firebase project is configured', async () => {
    mockFirebase();

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    expect(() => initializeFirebaseAdmin()).toThrow(
      'Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID.'
    );
    expect(() => initializeFirebaseAdmin()).toThrow(
      'Client-side Firebase config such as NEXT_PUBLIC_FIREBASE_* or REACT_APP_FIREBASE_* is not enough on its own.'
    );
  });

  // Refused, not ignored. Somebody with these set believes they are running as
  // that service account; silently using ADC would run as a different identity
  // with different permissions.
  it.each(['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'])(
    'refuses to start when a leftover %s is set',
    async (leftover) => {
      process.env.FIREBASE_PROJECT_ID = 'bt-impact-academy';
      process.env[leftover] = 'some-value';
      const { applicationDefault } = mockFirebase();

      const { initializeFirebaseAdmin } = await importFirebaseAdmin();

      expect(() => initializeFirebaseAdmin()).toThrow(
        'the service-account credential path has been removed'
      );
      expect(applicationDefault).not.toHaveBeenCalled();
    },
  );
});
