/**
 * Exchange a Firebase ID token for a server session cookie (AB#342).
 *
 * POST establishes the session, DELETE ends it. Who may have one is decided in
 * OperatorSessionService; this file validates the request and sets cookies.
 *
 * Rewritten rather than restored. The version deleted in 30aacc2 stored the raw
 * ID token as the cookie with maxAge 3600, which meant an operator was silently
 * signed out an hour into an event and there was no way to revoke anyone. A
 * real session cookie can be verified with checkRevoked, which is what
 * lib/auth/dal.ts relies on.
 */

import { NextRequest, NextResponse } from 'next/server';

import { OPERATOR_YARD_COOKIE, SESSION_COOKIE } from '@/infrastructure/auth/dal';
import { adminYardRepository, operatorSessionService } from '@/infrastructure/container.server';
import { isSelectableYard } from '@/core/domain/entities/Yard';
import { SESSION_DURATION_MS } from '@/core/application/services/OperatorSessionService';

function cookieOptions(maxAgeSeconds: number, name: string = SESSION_COOKIE) {
  return {
    name,
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

  // The yard is chosen here and nowhere else. Validated against the live list
  // rather than trusted: a retired yard must not be selectable just because a
  // stale browser still offered it.
  const yardId = (body as { yardId?: unknown })?.yardId;
  if (typeof yardId !== 'string' || yardId.length === 0) {
    return NextResponse.json({ success: false, error: 'Choose a yard to sign in at' }, { status: 400 });
  }

  if (!isSelectableYard(await adminYardRepository().findAll(), yardId)) {
    return NextResponse.json(
      { success: false, error: 'That yard is not one you can sign in at.' },
      { status: 400 },
    );
  }

  const result = await operatorSessionService().signIn(token);

  if (result.outcome === 'stale') {
    return NextResponse.json({ success: false, error: 'Please sign in again' }, { status: 401 });
  }

  if (result.outcome === 'access-granted') {
    // The token in hand predates the role, so the browser fetches a fresh one
    // and comes back: a second or so rather than "sign out and in again".
    return NextResponse.json(
      { success: false, refresh: true, error: 'Access granted. Finishing sign-in.' },
      { status: 409 },
    );
  }

  if (result.outcome === 'no-access') {
    // Named, because the admin needs to know exactly which address to add:
    // a Google sign-in may not be the address the person thinks it is.
    const who = result.email ? ` (${result.email})` : '';
    return NextResponse.json(
      {
        success: false,
        // The sign-in screen offers "Ask an admin" on this code.
        code: 'no-access',
        email: result.email,
        error:
          `This account${who} does not have operator access yet. Ask an admin to ` +
          'add it under Manage access, then sign in again.',
      },
      { status: 403 },
    );
  }

  if (result.outcome === 'refused') {
    // The caller gets one message: anything more specific helps someone guessing.
    console.warn('[auth] Session exchange refused:', result.reason);
    return NextResponse.json({ success: false, error: 'Could not sign you in' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, role: result.role, yardId }, { status: 200 });
  response.cookies.set({ ...cookieOptions(SESSION_DURATION_MS / 1000), value: result.sessionCookie });
  // Same lifetime, same response. httpOnly for the same reason the session
  // is: nothing in the page needs to read it, and a yard the browser can
  // rewrite is the localStorage preference this replaced.
  response.cookies.set({
    ...cookieOptions(SESSION_DURATION_MS / 1000, OPERATOR_YARD_COOKIE),
    value: yardId,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;

  // Clear the cookie whatever happens: a session we cannot verify is exactly
  // the one a user most wants gone.
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.set({ ...cookieOptions(0), value: '' });
  // Cleared with the session, so signing out is what changes yards.
  response.cookies.set({ ...cookieOptions(0, OPERATOR_YARD_COOKIE), value: '' });

  // Revoked too, so the session is dead everywhere, not just in this browser.
  await operatorSessionService().signOut(existing);

  return response;
}
