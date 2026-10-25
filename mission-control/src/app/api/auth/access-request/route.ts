/**
 * Someone signed in with Google and has no operator access: email the admins.
 *
 * The person proves who they are with the same Firebase ID token the sign-in
 * just produced, so the address in the email is the one Google verified, not
 * one typed into a form. Without that, this route would let anyone email the
 * admins in somebody else's name.
 *
 * Nothing is granted here. The email links to Manage access with the address
 * filled in, and the admin decides.
 *
 * ONE REQUEST PER HOUR PER ACCOUNT. Pressing the button again is answered as
 * success without sending, so a nervous double-tap does not become two emails.
 *
 * This file maps the outcome to HTTP; the decisions are OperatorAccessRequests.
 */

import { NextRequest, NextResponse } from 'next/server';

import { operatorAccessRequests } from '@/infrastructure/container.server';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = (body as { token?: unknown })?.token;
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  try {
    const result = await operatorAccessRequests(request.nextUrl.origin).request(token);
    switch (result.outcome) {
      case 'sent':
        return NextResponse.json({ success: true, notified: result.notified });
      case 'already-asked':
        return NextResponse.json({ success: true, alreadyAsked: true });
      case 'signed-out':
        return NextResponse.json({ success: false, error: 'Please sign in again' }, { status: 401 });
      case 'has-access':
        return NextResponse.json({ success: false, error: 'This account already has access. Sign in again.' }, { status: 409 });
      case 'unverified':
        return NextResponse.json(
          { success: false, error: 'This account has no verified email address to send with the request.' },
          { status: 400 },
        );
      case 'no-admin':
        return NextResponse.json(
          { success: false, error: 'There is no admin to ask yet. Contact the person who runs the yard.' },
          { status: 503 },
        );
      case 'undelivered':
        return NextResponse.json({ success: false, error: 'Could not email an admin. Try again in a few minutes.' }, { status: 502 });
    }
  } catch (error) {
    console.error('[access-request] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not send the request' }, { status: 500 });
  }
}
