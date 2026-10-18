/**
 * POST /api/parent-restore
 *
 * A parent signs in with Google and sends their Firebase ID token. The server
 * looks up which learner profiles are linked to that parent's UID and returns
 * them with enough detail (display name, avatar) for the parent to pick the
 * right child. The browser then writes the chosen learner ID to localStorage,
 * identical to the recovery-code restore flow.
 *
 * Rate-limited per IP: 5 failed attempts in 10 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirebaseAdminAuth, getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminParentLinkRepository } from '@/infrastructure/container.server';

const MAX_SIGN_IN_AGE_MS = 5 * 60 * 1000;

const bodySchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
});

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry) return false;
  if (now - entry.windowStart > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please wait a few minutes.' },
      { status: 429 },
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

  const validation = bodySchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.errors.map((e) => e.message).join(', ') },
      { status: 400 },
    );
  }

  let parentUid: string;
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(validation.data.idToken, true);

    if (Date.now() - decoded.auth_time * 1000 > MAX_SIGN_IN_AGE_MS) {
      recordFailure(ip);
      return NextResponse.json(
        { success: false, error: 'Please sign in again' },
        { status: 401 },
      );
    }

    parentUid = decoded.uid;
  } catch {
    recordFailure(ip);
    return NextResponse.json(
      { success: false, error: 'Invalid or expired sign-in' },
      { status: 401 },
    );
  }

  try {
    const repo = adminParentLinkRepository();
    const learnerIds = await repo.findByParentUid(parentUid);

    if (learnerIds.length === 0) {
      recordFailure(ip);
      return NextResponse.json(
        { success: false, error: 'No linked learners found for this account' },
        { status: 404 },
      );
    }

    const db = getFirestoreInstance();
    const learners = await Promise.all(
      learnerIds.map(async (learnerId) => {
        const snap = await db.collection('learners').doc(learnerId).get();
        const data = snap.data();
        return {
          learnerId,
          displayName: (data?.displayName as string) || undefined,
          avatar: data?.avatar as { style: string; seed: string } | undefined,
        };
      }),
    );

    return NextResponse.json({ success: true, learners });
  } catch (error) {
    console.error('[parent-restore] Failed to look up parent links:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process restore request' },
      { status: 500 },
    );
  }
}
