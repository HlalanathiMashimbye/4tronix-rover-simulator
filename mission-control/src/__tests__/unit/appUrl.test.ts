/**
 * Unit tests for the runtime app-URL resolver.
 *
 * The case that matters: prod runs the image built during the STAGING deploy,
 * so anything read from a NEXT_PUBLIC_* value is frozen at staging's origin.
 * APP_URL has to win for prod emails to link to the prod domain.
 */

import { resolveAppUrl } from '@/infrastructure/config/appUrl';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('resolveAppUrl', () => {
  it('prefers the runtime APP_URL over the build-time NEXT_PUBLIC_APP_URL', () => {
    process.env.APP_URL = 'https://marsyard.sapient.rocks';
    process.env.NEXT_PUBLIC_APP_URL = 'https://marsyard.labs.ws';

    expect(resolveAppUrl()).toBe('https://marsyard.sapient.rocks');
  });

  it('falls back to NEXT_PUBLIC_APP_URL for images built before APP_URL existed', () => {
    delete process.env.APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://marsyard.labs.ws';

    expect(resolveAppUrl()).toBe('https://marsyard.labs.ws');
  });

  it('falls back to localhost when neither is set', () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(resolveAppUrl()).toBe('http://localhost:3000');
  });

  it('ignores a blank value rather than building links off an empty origin', () => {
    process.env.APP_URL = '   ';
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(resolveAppUrl()).toBe('http://localhost:3000');
  });

  it('strips a trailing slash so callers can append a path safely', () => {
    process.env.APP_URL = 'https://marsyard.sapient.rocks/';

    expect(resolveAppUrl()).toBe('https://marsyard.sapient.rocks');
  });
});
