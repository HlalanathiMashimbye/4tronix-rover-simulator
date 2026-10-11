import { NextRequest } from 'next/server';

import { requireAdmin } from '@/infrastructure/auth/dal';
import { newYouTubeOAuthState, youtubeOAuthCookieValue, YOUTUBE_OAUTH_STATE_COOKIE } from '@/infrastructure/youtube/youtubeOAuth';
import { GET } from '@/app/api/operator/youtube-oauth/callback/route';

jest.mock('@/infrastructure/auth/dal', () => ({
  requireAdmin: jest.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));

const requireAdminMock = requireAdmin as jest.MockedFunction<typeof requireAdmin>;

describe('YouTube OAuth callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    requireAdminMock.mockResolvedValue({
      uid: 'operator',
      role: 'admin',
      yardId: 'curiosity',
    });
  });

  it('does not exchange a denied-consent callback and returns a clear status', async () => {
    const state = newYouTubeOAuthState();
    const request = new NextRequest(
      `https://marsyard.sapient.rocks/api/operator/youtube-oauth/callback?error=access_denied&state=${state}`,
      { headers: { cookie: `${YOUTUBE_OAUTH_STATE_COOKIE}=${youtubeOAuthCookieValue(state, false)}` } },
    );

    const response = await GET(request);
    expect(response.headers.get('location')).toBe('/operator/settings?youtubeOAuth=denied');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a callback without the state cookie', async () => {
    const request = new NextRequest(
      'https://marsyard.sapient.rocks/api/operator/youtube-oauth/callback?code=one-time-code&state=bad',
    );
    const response = await GET(request);

    expect(response.headers.get('location')).toBe('/operator/settings?youtubeOAuth=invalid-state');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
