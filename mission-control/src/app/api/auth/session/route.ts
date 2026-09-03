/**
 * Exchange a Firebase ID token for a server session cookie (AB#342).
 *
 * POST establishes the session, DELETE ends it.
 *
 * Rewritten rather than restored. The version deleted in 30aacc2 stored the raw
 * ID token as the cookie with maxAge 3600, which meant an operator was silently
 * signed out an hour into an event and there was no way to revoke anyone. A
 * real session cookie can be verified with checkRevoked, which is what
 * lib/auth/dal.ts relies on.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '@/infrastructure/persistence/firebase-admin';
import { SESSION_COOKIE } from '@/infrastructure/auth/dal';

/** Long enough to cover an event day, so nobody is signed out mid-session. */
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Firebase's guidance: only mint a session from a RECENT sign-in. Without this,
 * a stolen but still-valid ID token could be turned into a 12-hour session long
 * after the fact.
 */
const MAX_SIGN_IN_AGE_MS = 5 * 60 * 1000;

function cookieOptions(maxAgeSeconds: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = (body as { token?: unknown })?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  const auth = getFirebaseAdminAuth();

  try {
    const decoded = await auth.verifyIdToken(token, true);

    if (Date.now() - decoded.auth_time * 1000 > MAX_SIGN_IN_AGE_MS) {
      return NextResponse.json(
        { success: false, error: 'Please sign in again' },
        { status: 401 },
      );
    }

    // Refuse before minting anything. dal.ts would reject a session without a
    // role anyway, but handing out a cookie that can never work turns "you do
    // not have operator access" into a silent redirect loop.
    const role = decoded.role;
    if (role !== 'operator' && role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'This account does not have operator access' },
        { status: 403 },
      );
    }

    const sessionCookie = await auth.createSessionCookie(token, {
      expiresIn: SESSION_DURATION_MS,
    });

    const response = NextResponse.json({ success: true, role }, { status: 200 });
    response.cookies.set({ ...cookieOptions(SESSION_DURATION_MS / 1000), value: sessionCookie });
    return response;
  } catch (error) {
    // Expired, revoked, malformed, or issued for another project. The caller
    // gets one message: anything more specific helps someone guessing.
    console.warn('[auth] Session exchange refused:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Could not sign you in' }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;

  // Clear the cookie whatever happens: a session we cannot verify is exactly
  // the one a user most wants gone.
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.set({ ...cookieOptions(0), value: '' });

  if (existing) {
    try {
      const auth = getFirebaseAdminAuth();
      const decoded = await auth.verifySessionCookie(existing, false);
      // Revoke so the session is dead everywhere, not just in this browser.
      // dal.ts verifies with checkRevoked, so this takes effect immediately.
      await auth.revokeRefreshTokens(decoded.sub);
    } catch {
      // Already invalid. The cookie is cleared regardless.
    }
  }

  return response;
}
