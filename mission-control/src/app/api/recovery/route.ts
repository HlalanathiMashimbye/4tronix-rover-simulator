/**
 * POST /api/recovery
 *
 * Accepts a recovery code and returns the learner ID it maps to, so the
 * browser can write it to localStorage and become that learner.
 *
 * Rate-limited per IP: 5 failed attempts in 10 minutes triggers a 429.
 * With ~50 bits of entropy this is defence in depth, not the primary
 * barrier — but the acceptance criteria require it, and it stops a script
 * from hammering the endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminRecoveryCodeRepository } from '@/infrastructure/container.server';
import { hashRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_LENGTH } from '@/core/domain/services/recoveryCode';

const bodySchema = z.object({
  code: z.string().min(1, 'Recovery code is required'),
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
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const validation = bodySchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.errors.map((e) => e.message).join(', ') },
      { status: 400 }
    );
  }

  const normalised = normaliseRecoveryCode(validation.data.code);
  if (normalised.length !== RECOVERY_CODE_LENGTH) {
    recordFailure(ip);
    return NextResponse.json(
      { success: false, error: 'Code not recognised' },
      { status: 404 }
    );
  }

  try {
    const codeHash = await hashRecoveryCode(normalised);
    const repo = adminRecoveryCodeRepository();
    const learnerId = await repo.lookupByHash(codeHash);

    if (!learnerId) {
      recordFailure(ip);
      return NextResponse.json(
        { success: false, error: 'Code not recognised' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, learnerId });
  } catch (error) {
    console.error('[recovery] Failed to look up recovery code:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process recovery code' },
      { status: 500 }
    );
  }
}
