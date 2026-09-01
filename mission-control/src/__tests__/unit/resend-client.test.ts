/**
 * ResendEmailSender - sandbox recipient redirect.
 *
 * The redirect made an end-to-end send demonstrable while the sending domain
 * was unverified and Resend accepted only the address owning the API key. The
 * domain is verified now, so it is an environment variable for local testing
 * and deliberately not a settings field: arming it against a live yard sends
 * every child's mail to one inbox. These tests pin both the redirect and that
 * it disappears cleanly when unset.
 */

const sendMock = jest.fn();

// The store, not Google. Without this the sender's config lookup falls
// through to a real Secret Manager call the moment a test unsets an env var,
// which hangs the suite rather than failing it. Reading the environment is
// exactly what the store does in local development, so this mirrors it.
jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: async (name: string) => {
    const envVars: Record<string, string> = {
      resendApiKey: 'RESEND_API_KEY',
      resendFromEmail: 'RESEND_FROM_EMAIL',
    };
    return process.env[envVars[name]]?.trim() || null;
  },
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

const ORIGINAL_ENV = process.env;

async function loadSender() {
  // The module memoises its Resend client, so each case needs a fresh copy.
  jest.resetModules();
  const imported = await import('@/infrastructure/email/resend-client');
  return imported.ResendEmailSender;
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'onboarding@resend.dev',
  };
  delete process.env.RESEND_SANDBOX_RECIPIENT;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('ResendEmailSender', () => {
  it('redirects to the sandbox inbox and keeps the intended recipient visible', async () => {
    process.env.RESEND_SANDBOX_RECIPIENT = 'konke@example.com';
    const ResendEmailSender = await loadSender();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await new ResendEmailSender().send(
      'learner@school.edu',
      '🛰️ Mission Queued - Red Rock Run',
      '<p>hi</p>'
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('konke@example.com');
    expect(payload.subject).toBe('[to: learner@school.edu] 🛰️ Mission Queued - Red Rock Run');
    expect(payload.html).toBe('<p>hi</p>');

    // The redirect must be loud: the service layer logs the intended recipient,
    // so without this the logs would claim a learner was mailed when they weren't.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('learner@school.edu -> konke@example.com')
    );
    warnSpy.mockRestore();
  });

  it('sends to the real recipient untouched when no sandbox recipient is set', async () => {
    const ResendEmailSender = await loadSender();

    await new ResendEmailSender().send('learner@school.edu', 'Mission Queued', '<p>hi</p>');

    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('learner@school.edu');
    expect(payload.subject).toBe('Mission Queued');
  });

  it('throws when Resend rejects the send', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'You can only send testing emails to your own email address' },
    });
    const ResendEmailSender = await loadSender();

    await expect(
      new ResendEmailSender().send('learner@school.edu', 'Mission Queued', '<p>hi</p>')
    ).rejects.toThrow('You can only send testing emails to your own email address');
  });

  it('names every missing variable when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    const ResendEmailSender = await loadSender();

    await expect(
      new ResendEmailSender().send('learner@school.edu', 'Mission Queued', '<p>hi</p>')
    ).rejects.toThrow('RESEND_API_KEY, RESEND_FROM_EMAIL');
  });
});
