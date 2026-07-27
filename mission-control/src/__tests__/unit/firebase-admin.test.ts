describe('initializeFirebaseAdmin', () => {
  const originalEnv = process.env;

  async function importFirebaseAdmin() {
    return import('@/infrastructure/persistence/firebase-admin');
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

  it('falls back to REACT_APP_FIREBASE_PROJECT_ID when FIREBASE_PROJECT_ID is unset', async () => {
    const cert = jest.fn((config) => config);
    const initializeApp = jest.fn(() => ({ name: 'test-app' }));

    process.env.REACT_APP_FIREBASE_PROJECT_ID = 'legacy-project-id';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = 'private-key';

    jest.doMock('firebase-admin/app', () => ({
      cert,
      getApps: jest.fn(() => []),
      initializeApp,
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    initializeFirebaseAdmin();

    expect(cert).toHaveBeenCalledWith({
      projectId: 'legacy-project-id',
      clientEmail: 'test@test.iam.gserviceaccount.com',
      privateKey: 'private-key',
    });
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace and surrounding quotes from Firebase Admin env values', async () => {
    const cert = jest.fn((config) => config);
    const initializeApp = jest.fn(() => ({ name: 'test-app' }));

    process.env.FIREBASE_PROJECT_ID = ' "quoted-project" ';
    process.env.FIREBASE_CLIENT_EMAIL = ' "test@test.iam.gserviceaccount.com" ';
    process.env.FIREBASE_PRIVATE_KEY = ' "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" ';

    jest.doMock('firebase-admin/app', () => ({
      cert,
      getApps: jest.fn(() => []),
      initializeApp,
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    initializeFirebaseAdmin();

    expect(cert).toHaveBeenCalledWith({
      projectId: 'quoted-project',
      clientEmail: 'test@test.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
  });

  it('throws a clear error when no Firebase project is configured', async () => {
    jest.doMock('firebase-admin/app', () => ({
      cert: jest.fn(),
      applicationDefault: jest.fn(),
      getApps: jest.fn(() => []),
      initializeApp: jest.fn(),
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    expect(() => initializeFirebaseAdmin()).toThrow(
      'Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID.'
    );
    expect(() => initializeFirebaseAdmin()).toThrow(
      'Client-side Firebase config such as NEXT_PUBLIC_FIREBASE_* or REACT_APP_FIREBASE_* is not enough on its own.'
    );
  });

  // --- Application Default Credentials -------------------------------------
  // On Cloud Run the runtime service account already has roles/datastore.user
  // in the same project as Firestore, so no service account key needs to exist.

  it('uses Application Default Credentials when no service account is configured', async () => {
    const cert = jest.fn();
    const applicationDefault = jest.fn(() => 'adc-credential');
    const initializeApp = jest.fn(() => ({ name: 'test-app' }));

    process.env.FIREBASE_PROJECT_ID = 'bt-impact-academy';

    jest.doMock('firebase-admin/app', () => ({
      cert,
      applicationDefault,
      getApps: jest.fn(() => []),
      initializeApp,
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    initializeFirebaseAdmin();

    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(cert).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith({
      credential: 'adc-credential',
      projectId: 'bt-impact-academy',
    });
  });

  it('prefers an explicit service account over Application Default Credentials', async () => {
    const cert = jest.fn((config) => config);
    const applicationDefault = jest.fn();
    const initializeApp = jest.fn(() => ({ name: 'test-app' }));

    process.env.FIREBASE_PROJECT_ID = 'bt-impact-academy';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = 'private-key';

    jest.doMock('firebase-admin/app', () => ({
      cert,
      applicationDefault,
      getApps: jest.fn(() => []),
      initializeApp,
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    initializeFirebaseAdmin();

    expect(cert).toHaveBeenCalledTimes(1);
    expect(applicationDefault).not.toHaveBeenCalled();
  });

  // A half-set pair is nearly always a broken .env. Falling back to ADC there
  // would silently authenticate as a different identity than intended.
  it.each([
    ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
    ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL'],
  ])('throws when %s is set but %s is not', async (present, missing) => {
    process.env.FIREBASE_PROJECT_ID = 'bt-impact-academy';
    process.env[present] = 'some-value';

    jest.doMock('firebase-admin/app', () => ({
      cert: jest.fn(),
      applicationDefault: jest.fn(),
      getApps: jest.fn(() => []),
      initializeApp: jest.fn(),
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(),
    }));

    const { initializeFirebaseAdmin } = await importFirebaseAdmin();

    expect(() => initializeFirebaseAdmin()).toThrow(
      `Incomplete Firebase Admin service account config: ${present} is set but ${missing} is not.`
    );
  });
});
