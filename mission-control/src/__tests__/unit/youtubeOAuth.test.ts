import {
  exchangeYouTubeAuthorizationCode,
  newYouTubeOAuthState,
  validYouTubeOAuthState,
  youtubeAuthorizationUrl,
  youtubeOAuthCallbackUrl,
  youtubeOAuthCookieValue,
} from '@/infrastructure/youtube/youtubeOAuth';
import { readSetting, writeSetting } from '@/infrastructure/config/runtimeSettingsStore';

jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: jest.fn(),
  writeSetting: jest.fn(),
}));

const read = readSetting as jest.MockedFunction<typeof readSetting>;
const write = writeSetting as jest.MockedFunction<typeof writeSetting>;

describe('YouTube upload OAuth', () => {
  const originalAppUrl = process.env.APP_URL;
  const originalNextAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalRefreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    process.env.APP_URL = 'https://marsyard.sapient.rocks';
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.YOUTUBE_REFRESH_TOKEN;
    read.mockImplementation(async (name) => ({
      youtubeClientId: 'oauth-client-id',
      youtubeClientSecret: 'oauth-client-secret',
      youtubeRefreshToken: null,
    })[name] ?? null);
  });

  afterAll(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalNextAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalNextAppUrl;
    if (originalRefreshToken === undefined) delete process.env.YOUTUBE_REFRESH_TOKEN;
    else process.env.YOUTUBE_REFRESH_TOKEN = originalRefreshToken;
  });

  it('derives the registered callback URI from a validated app origin', () => {
    expect(youtubeOAuthCallbackUrl()).toBe(
      'https://marsyard.sapient.rocks/api/operator/youtube-oauth/callback',
    );
    process.env.APP_URL = 'http://attacker.example';
    expect(() => youtubeOAuthCallbackUrl()).toThrow(/HTTPS origin/);
  });

  it('requests only the upload scope with offline access and a protected state value', async () => {
    const state = newYouTubeOAuthState();
    const authorization = new URL(await youtubeAuthorizationUrl(state));
    expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.upload');
    expect(authorization.searchParams.get('access_type')).toBe('offline');
    expect(authorization.searchParams.get('redirect_uri')).toBe(youtubeOAuthCallbackUrl());
    expect(authorization.searchParams.get('state')).toBe(state);
  });

  it('rejects missing, altered, malformed and cookie-less OAuth state', () => {
    const state = newYouTubeOAuthState();
    const cookie = youtubeOAuthCookieValue(state, false);
    expect(validYouTubeOAuthState(state, cookie)).toBe(true);
    expect(validYouTubeOAuthState(null, cookie)).toBe(false);
    expect(validYouTubeOAuthState(`${state}x`, cookie)).toBe(false);
    expect(validYouTubeOAuthState(state, undefined)).toBe(false);
    expect(validYouTubeOAuthState(state, `${state}.other`)).toBe(false);
  });

  it('does not replace a working refresh token unless reauthorization is explicit', async () => {
    read.mockImplementation(async (name) => name === 'youtubeClientId'
      ? 'oauth-client-id'
      : name === 'youtubeClientSecret'
        ? 'oauth-client-secret'
        : 'existing-working-token');

    await expect(exchangeYouTubeAuthorizationCode('one-time-code', false)).resolves.toBe('already-configured');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('stores the refresh token from an explicit reauthorization without returning it', async () => {
    read.mockImplementation(async (name) => name === 'youtubeClientId'
      ? 'oauth-client-id'
      : name === 'youtubeClientSecret'
        ? 'oauth-client-secret'
        : 'existing-working-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: 'new-private-refresh-token' }),
    });

    await expect(exchangeYouTubeAuthorizationCode('one-time-code', true)).resolves.toBe('stored');
    expect(write).toHaveBeenCalledWith('youtubeRefreshToken', 'new-private-refresh-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects missing configuration and token-exchange errors without exposing credentials', async () => {
    read.mockResolvedValue(null);
    await expect(youtubeAuthorizationUrl(newYouTubeOAuthState())).rejects.toThrow(/client ID and client secret/);

    read.mockImplementation(async (name) => name === 'youtubeClientId'
      ? 'oauth-client-id'
      : name === 'youtubeClientSecret'
        ? 'oauth-client-secret'
        : null);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(exchangeYouTubeAuthorizationCode('bad-code', false)).rejects.toThrow('HTTP 400');
    expect(write).not.toHaveBeenCalled();
  });

  it('does not persist an exchange response without a refresh token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-token' }),
    });

    await expect(exchangeYouTubeAuthorizationCode('one-time-code', false)).rejects.toThrow(/did not issue a refresh token/);
    expect(write).not.toHaveBeenCalled();
  });
});
