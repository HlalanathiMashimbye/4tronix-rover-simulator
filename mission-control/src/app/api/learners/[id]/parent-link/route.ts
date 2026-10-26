/**
 * POST /api/learners/[id]/parent-link   — link a parent's Google account
 * DELETE /api/learners/[id]/parent-link — unlink and delete the link
 *
 * The parent authenticates with a Firebase ID token sent in the request body,
 * NOT a session cookie. Parents are not operators: they must never receive an
 * operator session. The token is verified server-side, the UID extracted, and
 * the token discarded.
 *
 * Only the parent's Firebase UID is stored against the learner — not their
 * name or email beyond what Firebase Auth already holds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminParentLinkRepository, learnerAccounts, parentSignIn } from '@/infrastructure/container.server';
import { CURRENT_CONSENT_VERSION } from '@/core/domain/services/parentLink';

function refusedSignIn(reason: 'stale' | 'invalid') {
  return NextResponse.json(
    { success: false, error: reason === 'stale' ? 'Please sign in again' : 'Invalid or expired sign-in' },
    { status: 401 },
  );
}

const linkSchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
  consentVersion: z.number().int().positive('Consent version is required'),
});

const unlinkSchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validation = linkSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.errors.map((e) => e.message).join(', ') },
      { status: 400 },
    );
  }

  const { idToken, consentVersion } = validation.data;

  if (consentVersion !== CURRENT_CONSENT_VERSION) {
    return NextResponse.json(
      { success: false, error: 'Consent version mismatch — please refresh and try again' },
      { status: 400 },
    );
  }

  const signIn = await parentSignIn().verifyRecent(idToken);
  if (!signIn.ok) return refusedSignIn(signIn.reason);
  const parentUid = signIn.uid;

  try {
    if (!(await learnerAccounts().exists(id))) {
      return NextResponse.json(
        { success: false, error: 'Learner not found' },
        { status: 404 },
      );
    }

    const repo = adminParentLinkRepository();
    const existing = await repo.findByLearnerId(id);

    if (existing && existing.parentUid !== parentUid) {
      return NextResponse.json(
        { success: false, error: 'This learner is already linked to another parent account' },
        { status: 409 },
      );
    }

    if (existing && existing.parentUid === parentUid) {
      return NextResponse.json({ success: true });
    }

    await repo.link(id, parentUid, consentVersion);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[parent-link] Failed to link parent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to link parent account' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validation = unlinkSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.errors.map((e) => e.message).join(', ') },
      { status: 400 },
    );
  }

  const signIn = await parentSignIn().verifyRecent(validation.data.idToken);
  if (!signIn.ok) return refusedSignIn(signIn.reason);
  const parentUid = signIn.uid;

  try {
    const repo = adminParentLinkRepository();
    const existing = await repo.findByLearnerId(id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'No parent link found for this learner' },
        { status: 404 },
      );
    }

    if (existing.parentUid !== parentUid) {
      return NextResponse.json(
        { success: false, error: 'You are not the linked parent for this learner' },
        { status: 403 },
      );
    }

    await repo.unlink(id, parentUid);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[parent-link] Failed to unlink parent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to unlink parent account' },
      { status: 500 },
    );
  }
}
