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
 * This file is the controller: it checks the caller is an admin, validates
 * the request and maps the outcome to HTTP. What may change, and what gets
 * written, is OperatorTeamService and FirebaseOperatorDirectory.
 *
 * The ledger records the granting ADMIN, which the script could not do: it
 * recorded $USER from whatever shell happened to run it.
 */

import { NextRequest, NextResponse } from 'next/server';

import { operatorTeamService } from '@/infrastructure/container.server';
import { requireAdmin, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import { TeamChangeFailed } from '@/core/application/services/OperatorTeamService';
import { isOperatorRole, type OperatorRole } from '@/core/domain/entities/OperatorAccount';

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
    const listing = await operatorTeamService().listing();
    return NextResponse.json({ success: true, ...listing });
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

  const team = operatorTeamService(request.nextUrl.origin);
  try {
    const result = await team.changeAccess(
      { uid: session.uid, label: session.email ?? session.uid },
      email.trim(),
      nextRole,
    );

    if (result.outcome === 'blocked') {
      return NextResponse.json({ success: false, error: result.message }, { status: 409 });
    }
    if (result.outcome === 'nothing-to-revoke') {
      return NextResponse.json({ success: false, error: result.message }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      ...(result.outcome === 'unchanged' ? { unchanged: true } : {}),
      message: result.message,
      ...(await team.listing()),
    });
  } catch (error) {
    console.error('[operator/team] change failed:', error);
    const message = error instanceof TeamChangeFailed ? error.message : 'Could not apply that change';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
