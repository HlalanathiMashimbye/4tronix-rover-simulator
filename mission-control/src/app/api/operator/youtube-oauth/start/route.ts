import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, UnauthorizedError, ForbiddenError } from '@/infrastructure/auth/dal';
import {
  newYouTubeOAuthState,
  youtubeAuthorizationUrl,
  youtubeOAuthCallbackUrl,
  youtubeOAuthCookieValue,
  youtubeOAuthStateMaxAge,
  YOUTUBE_OAUTH_STATE_COOKIE,
  YouTubeOAuthConfigurationError,
} from '@/infrastructure/youtube/youtubeOAuth';

function authError(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ error: 'Only an admin can authorize YouTube uploads.' }, { status: 403 });
  return null;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return authError(error) ?? NextResponse.json({ error: 'Could not verify your access.' }, { status: 500 });
  }

  try {
    if (request.headers.get('origin') !== new URL(youtubeOAuthCallbackUrl()).origin) {
      return NextResponse.json({ error: 'Authorization must be started from this application.' }, { status: 403 });
    }
  } catch (error) {
    if (error instanceof YouTubeOAuthConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Could not validate the application URL.' }, { status: 500 });
  }

  let replace = false;
  try {
    const form = await request.formData();
    replace = form.get('reauthorize') === '1';
  } catch {
    return NextResponse.json({ error: 'Invalid authorization request.' }, { status: 400 });
  }
  const state = newYouTubeOAuthState();
  try {
    const response = NextResponse.redirect(await youtubeAuthorizationUrl(state));
    response.headers.set('cache-control', 'no-store');
    response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, youtubeOAuthCookieValue(state, replace), {
      httpOnly: true,
      secure: new URL(youtubeOAuthCallbackUrl()).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/operator/youtube-oauth',
      maxAge: youtubeOAuthStateMaxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof YouTubeOAuthConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('[youtube-oauth] Could not start authorization.');
    return NextResponse.json({ error: 'Could not start YouTube authorization.' }, { status: 500 });
  }
}
