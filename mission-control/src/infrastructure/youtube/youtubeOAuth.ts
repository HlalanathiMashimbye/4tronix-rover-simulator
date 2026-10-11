import 'server-only';

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { resolveAppUrl } from '@/infrastructure/config/appUrl';
import { readSetting, writeSetting } from '@/infrastructure/config/runtimeSettingsStore';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_OAUTH_STATE_COOKIE = 'youtube-oauth-state';
export const YOUTUBE_OAUTH_CALLBACK_PATH = '/api/operator/youtube-oauth/callback';
const STATE_MAX_AGE_SECONDS = 600;

export class YouTubeOAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeOAuthConfigurationError';
  }
}

export function youtubeOAuthCallbackUrl(): string {
  const configured = resolveAppUrl();
  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new YouTubeOAuthConfigurationError('Set APP_URL to the public Mission Control origin.');
  }

  const localHttp = base.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    (!localHttp && base.protocol !== 'https:') ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new YouTubeOAuthConfigurationError(
      'APP_URL must be an HTTPS origin (HTTP is allowed only for localhost).',
    );
  }

  return new URL(YOUTUBE_OAUTH_CALLBACK_PATH, base).toString();
}

export async function youtubeAuthorizationUrl(state: string): Promise<string> {
  const [clientId, clientSecret] = await Promise.all([
    readSetting('youtubeClientId'),
    readSetting('youtubeClientSecret'),
  ]);
  if (!clientId || !clientSecret) {
    throw new YouTubeOAuthConfigurationError(
      'Set the YouTube OAuth client ID and client secret in operator settings first.',
    );
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: youtubeOAuthCallbackUrl(),
    response_type: 'code',
    scope: YOUTUBE_UPLOAD_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  }).toString();
  return url.toString();
}

export function newYouTubeOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function validYouTubeOAuthState(state: string | null, cookieValue: string | undefined): boolean {
  if (!state || !cookieValue) return false;
  const [cookieState, mode, ...extra] = cookieValue.split('.');
  if (extra.length || (mode !== 'keep' && mode !== 'replace')) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(cookieState)) return false;

  const supplied = Buffer.from(state);
  const expected = Buffer.from(cookieState);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function youtubeOAuthCookieValue(state: string, replaceExisting: boolean): string {
  return `${state}.${replaceExisting ? 'replace' : 'keep'}`;
}

export function replaceExistingRefreshToken(cookieValue: string | undefined): boolean {
  return cookieValue?.split('.')[1] === 'replace';
}

export const youtubeOAuthStateMaxAge = STATE_MAX_AGE_SECONDS;

export async function exchangeYouTubeAuthorizationCode(
  code: string,
  replaceExisting: boolean,
): Promise<'stored' | 'already-configured' | 'environment-token'> {
  const [clientId, clientSecret, existingToken] = await Promise.all([
    readSetting('youtubeClientId'),
    readSetting('youtubeClientSecret'),
    readSetting('youtubeRefreshToken'),
  ]);
  if (!clientId || !clientSecret) {
    throw new YouTubeOAuthConfigurationError('YouTube OAuth client settings are missing.');
  }

  if (existingToken && !replaceExisting) return 'already-configured';
  if (existingToken && process.env.YOUTUBE_REFRESH_TOKEN?.trim()) return 'environment-token';

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: youtubeOAuthCallbackUrl(),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google authorization-code exchange failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as { refresh_token?: unknown };
  if (typeof payload.refresh_token !== 'string' || payload.refresh_token.length === 0) {
    throw new Error('Google did not issue a refresh token. Retry authorization with consent granted.');
  }

  await writeSetting('youtubeRefreshToken', payload.refresh_token);
  return 'stored';
}
