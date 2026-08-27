/**
 * Grant and revoke operator access from the app, so nobody needs a laptop.
 *
 * This replaces the normal use of scripts/set-operator-role.mjs. Onboarding a
 * facilitator required a service-account key, a checkout of the repo and a
 * shell, which meant it could only be done by the two people holding all of
 * those. David and Werner both called that out as a handover problem: a
 * platform someone else has to run cannot have "ask Hlali" as a step.
 *
 * The script stays for one job it alone can do: creating the FIRST admin.
 * Nothing in this file is reachable without an admin already existing, so
 * bootstrapping cannot happen here by definition.
 *
 * WHAT IS WRITTEN
 *
 *   Auth custom claim   role=operator|admin   the store everything enforces from
 *   users/{uid}         ledger only           who granted it, when, to whom
 *
 * The ledger records the granting ADMIN, which the script could not do: it
 * recorded $USER from whatever shell happened to run it.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getFirebaseAdminAuth, getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { listOperatorAccounts } from '@/infrastructure/auth/operatorAccounts';
import { requireAdmin, ForbiddenError, UnauthorizedError } from '@/lib/auth/dal';
import {
  changeBlocker,
  isNoOpChange,
  isOperatorRole,
  type OperatorRole,
} from '@/core/domain/entities/OperatorAccount';

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { success: false, error: 'Only an admin can change operator access' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ success: true, accounts: await listOperatorAccounts() });
  } catch (error) {
    const known = errorResponse(error);
    if (known) return known;

    console.error('[operator/team] list failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load the team' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return errorResponse(error) ?? NextResponse.json(
      { success: false, error: 'Could not verify your access' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, role } = (body ?? {}) as { email?: unknown; role?: unknown };

  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ success: false, error: 'An email address is required' }, { status: 400 });
  }

  // `null` role means revoke. Anything else must be a real role: without this,
  // a typo would set role="oprator" and silently grant nothing at all while
  // reporting success.
  if (role !== null && !isOperatorRole(role)) {
    return NextResponse.json(
      { success: false, error: 'Role must be "operator", "admin", or null to revoke' },
      { status: 400 },
    );
  }
  const nextRole: OperatorRole | null = role;

  const auth = getFirebaseAdminAuth();
  const db = getFirestoreInstance();

  let user;
  try {
    user = await auth.getUserByEmail(email.trim());
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      // Roles are granted TO an account; they do not create one. Saying so is
      // the difference between a two-minute fix and a confused afternoon.
      return NextResponse.json(
        {
          success: false,
          error:
            `No account exists for ${email.trim()}. They need to be created in ` +
            'Firebase Authentication first, then granted access here.',
        },
        { status: 404 },
      );
    }
    console.error('[operator/team] lookup failed:', error);
    return NextResponse.json({ success: false, error: 'Could not look up that account' }, { status: 500 });
  }

  const accounts = await listOperatorAccounts();
  const change = { actorUid: session.uid, targetUid: user.uid, nextRole, accounts };

  const blocked = changeBlocker(change);
  if (blocked) {
    return NextResponse.json({ success: false, error: blocked }, { status: 409 });
  }

  if (isNoOpChange(change)) {
    // Returning early rather than writing: setCustomUserClaims plus a token
    // revoke would sign the person out to give them what they already had.
    return NextResponse.json({
      success: true,
      unchanged: true,
      message: `${user.email ?? user.uid} already has this access.`,
      accounts,
    });
  }

  try {
    const existingClaims = user.customClaims ?? {};

    if (nextRole === null) {
      // Preserve unrelated claims rather than wiping the object.
      const { role: _removed, ...rest } = existingClaims;
      await auth.setCustomUserClaims(user.uid, rest);
      await db.collection('users').doc(user.uid).set(
        { role: null, revokedAt: new Date().toISOString(), revokedBy: session.email ?? session.uid },
        { merge: true },
      );
      // dal.ts verifies with checkRevoked, so this takes effect on their very
      // next request rather than whenever the session happens to lapse.
      await auth.revokeRefreshTokens(user.uid);
    } else {
      await auth.setCustomUserClaims(user.uid, { ...existingClaims, role: nextRole });
      await db.collection('users').doc(user.uid).set(
        {
          role: nextRole,
          email: user.email ?? null,
          grantedAt: new Date().toISOString(),
          grantedBy: session.email ?? session.uid,
        },
        { merge: true },
      );
    }

    return NextResponse.json({
      success: true,
      accounts: await listOperatorAccounts(),
      // Claims ride on the ID token, so a grant is not live until that token
      // refreshes. The UI says so; hiding it produces "it did not work" reports
      // for something that is working exactly as designed.
      message:
        nextRole === null
          ? `Access removed for ${user.email ?? user.uid}. They have been signed out.`
          : `${user.email ?? user.uid} is now ${nextRole}. They need to sign out and back in for it to take effect.`,
    });
  } catch (error) {
    console.error('[operator/team] write failed:', error);
    return NextResponse.json({ success: false, error: 'Could not apply that change' }, { status: 500 });
  }
}
