import { NextRequest } from 'next/server';

import { requireAdmin } from '@/infrastructure/auth/dal';
import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';
import { POST } from '@/app/api/operator/youtube-oauth/start/route';

jest.mock('@/infrastructure/auth/dal', () => ({
  requireAdmin: jest.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));
jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: jest.fn(),
  writeSetting: jest.fn(),
}));

const requireAdminMock = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const readMock = readSetting as jest.MockedFunction<typeof readSetting>;

describe('YouTube OAuth initiation route', () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_URL = 'https://marsyard.sapient.rocks';
    requireAdminMock.mockResolvedValue({ uid: 'admin', role: 'admin', yardId: 'curiosity' });
    readMock.mockImplementation(async (name) => name === 'youtubeClientId' ? 'client-id' : 'client-secret');
  });

  afterAll(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it('rejects cross-origin authorization starts', async () => {
    const request = new NextRequest('https://marsyard.sapient.rocks/api/operator/youtube-oauth/start', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('redirects an admin to Google with a state cookie and minimum offline scope', async () => {
    const request = new NextRequest('https://marsyard.sapient.rocks/api/operator/youtube-oauth/start', {
      method: 'POST',
      headers: {
        origin: 'https://marsyard.sapient.rocks',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });

    const response = await POST(request);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.upload');
    expect(location.searchParams.get('access_type')).toBe('offline');
    expect(response.headers.get('set-cookie')).toContain('youtube-oauth-state=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
