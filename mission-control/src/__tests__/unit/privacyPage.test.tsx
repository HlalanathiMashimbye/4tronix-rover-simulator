/**
 * The privacy page says what this deployment actually does.
 *
 * Two things on it change without a code change: who to contact, which is an
 * admin setting, and whether usage analytics run, which follows the PostHog
 * key the image was built with. A page that named a contact nobody set, or
 * said the site was not measured while PostHog recorded it, would be wrong in
 * exactly the way a privacy page must not be.
 */

import { renderToStaticMarkup } from 'react-dom/server';

const connectionMock = jest.fn(async () => {});
jest.mock('next/server', () => ({ connection: () => connectionMock() }));

const readSetting = jest.fn<Promise<string | null>, [string]>();
jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: (name: string) => readSetting(name),
}));

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  readSetting.mockReset();
  connectionMock.mockClear();
  jest.resetModules();
});

async function renderPage({ contact = null as string | null, posthogKey = '' } = {}) {
  readSetting.mockImplementation(async (name) => (name === 'privacyContactEmail' ? contact : null));
  if (posthogKey) process.env.NEXT_PUBLIC_POSTHOG_KEY = posthogKey;
  else delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

  // The page reads the key when it loads, as Next inlines it at build time,
  // so each render loads it afresh.
  jest.resetModules();
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  return renderToStaticMarkup(await PrivacyPage());
}

describe('the privacy page', () => {
  it('names the contact an admin set, as a link to write to', async () => {
    const html = await renderPage({ contact: 'privacy@sapient.example' });

    expect(html).toContain('href="mailto:privacy@sapient.example"');
  });

  it('names no address when none is set, rather than an empty link', async () => {
    const html = await renderPage({ contact: null });

    expect(html).not.toContain('mailto:');
  });

  it('describes usage analytics only when PostHog is running', async () => {
    expect(await renderPage({ posthogKey: 'phc_test' })).toContain('PostHog');
    expect(await renderPage({ posthogKey: '' })).not.toContain('PostHog');
  });

  it('reads the contact per request, not once at build time', async () => {
    await renderPage({ contact: 'privacy@sapient.example' });

    expect(connectionMock).toHaveBeenCalled();
    expect(readSetting).toHaveBeenCalledWith('privacyContactEmail');
  });
});
