import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, UnauthorizedError, ForbiddenError } from '@/infrastructure/auth/dal';
import {
  exchangeYouTubeAuthorizationCode,
  replaceExistingRefreshToken,
  validYouTubeOAuthState,
  YOUTUBE_OAUTH_STATE_COOKIE,
} from '@/infrastructure/youtube/youtubeOAuth';

function settingsRedirect(result: string) {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      location: `/operator/settings?youtubeOAuth=${encodeURIComponent(result)}`,
      'cache-control': 'no-store',
    },
  });
  response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/operator/youtube-oauth',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: 'Only an admin can authorize YouTube uploads.' }, { status: 403 });
    return NextResponse.json({ error: 'Could not verify your access.' }, { status: 500 });
  }

  const cookie = request.cookies.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value;
  if (!validYouTubeOAuthState(request.nextUrl.searchParams.get('state'), cookie)) {
    return settingsRedirect('invalid-state');
  }

  if (request.nextUrl.searchParams.has('error')) {
    return settingsRedirect('denied');
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code || code.length > 4096) return settingsRedirect('invalid-callback');

  try {
    const result = await exchangeYouTubeAuthorizationCode(code, replaceExistingRefreshToken(cookie));
    if (result === 'environment-token') return settingsRedirect('environment-token');
    if (result === 'already-configured') return settingsRedirect('already-configured');
    return settingsRedirect('authorized');
  } catch {
    console.error('[youtube-oauth] Authorization callback failed.');
    return settingsRedirect('exchange-failed');
  }
}
