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
 * ONE REQUEST PER HOUR PER ACCOUNT. Recorded in operatorAccessRequests/{uid}
 * (see operatorAccessRequests). Pressing the button again is answered as
 * success without sending, so a nervous double-tap does not become two emails.
 *
 * The record also keeps which email went to which admin. Granting the access
 * replies to those emails, so the admins who did not handle it see that it is
 * done (operator/team/route.ts).
 */

import { NextRequest, NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '@/infrastructure/persistence/firebase-admin';
import { listOperatorAccounts } from '@/infrastructure/auth/operatorAccounts';
import { findAccessRequest, recordAccessRequest } from '@/infrastructure/auth/operatorAccessRequests';
import { ResendEmailSender } from '@/infrastructure/email/resend-client';
import { buildAccessRequestEmail } from '@/infrastructure/email/accessRequestTemplate';
import { resolveAppUrl } from '@/infrastructure/config/appUrl';
import { isOperatorRole } from '@/core/domain/entities/OperatorAccount';

const ONE_HOUR_MS = 60 * 60 * 1000;

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

  let decoded;
  try {
    decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  } catch {
    return NextResponse.json({ success: false, error: 'Please sign in again' }, { status: 401 });
  }

  if (isOperatorRole(decoded.role)) {
    return NextResponse.json({ success: false, error: 'This account already has access. Sign in again.' }, { status: 409 });
  }

  const email = typeof decoded.email === 'string' ? decoded.email : null;
  if (!email || decoded.email_verified !== true) {
    // An unverified address could be anyone's, so it is not put in front of an admin.
    return NextResponse.json(
      { success: false, error: 'This account has no verified email address to send with the request.' },
      { status: 400 },
    );
  }

  try {
    const previous = await findAccessRequest(decoded.uid);
    const lastAt = Date.parse(previous?.requestedAt ?? '');
    if (!Number.isNaN(lastAt) && Date.now() - lastAt < ONE_HOUR_MS) {
      return NextResponse.json({ success: true, alreadyAsked: true });
    }

    const admins = (await listOperatorAccounts()).filter((a) => a.role === 'admin' && a.email);
    if (admins.length === 0) {
      return NextResponse.json(
        { success: false, error: 'There is no admin to ask yet. Contact the person who runs the yard.' },
        { status: 503 },
      );
    }

    const grantUrl = `${resolveAppUrl(request.nextUrl.origin)}/operator/team?grant=${encodeURIComponent(email)}`;
    const { subject, html } = buildAccessRequestEmail(email, grantUrl);
    const sender = new ResendEmailSender();
    const results = await Promise.allSettled(
      admins.map(async (a) => ({ to: a.email!, emailId: await sender.send(a.email!, subject, html) })),
    );
    const sent = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

    if (sent.length === 0) {
      console.error('[access-request] no admin email sent:', results);
      return NextResponse.json({ success: false, error: 'Could not email an admin. Try again in a few minutes.' }, { status: 502 });
    }

    await recordAccessRequest(decoded.uid, { email, subject, sent }, previous);
    return NextResponse.json({ success: true, notified: sent.length });
  } catch (error) {
    console.error('[access-request] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not send the request' }, { status: 500 });
  }
}
