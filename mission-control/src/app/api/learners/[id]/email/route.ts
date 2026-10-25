/**
 * POST /api/learners/[id]/email
 *
 * Sets (or clears) a learner's contact address.
 *
 * Why this route exists at all, rather than the browser writing the field
 * itself as it used to:
 *
 * Mission documents are world-readable and carry `learnerId`, and learner
 * documents are readable by exact id. So anyone could read the public feed,
 * collect learner ids from it, fetch each learner document and read
 * `learnerEmail` in plaintext - harvesting a list of school children's email
 * addresses from public data, with no credentials. `list: false` on the
 * collection did not help, because the ids were already being published.
 *
 * Firestore rules cannot hide a single field on read, so the address moves to
 * a subcollection that browsers are denied entirely, and only the Admin SDK
 * (which bypasses rules) can reach it. The public learner document keeps the
 * harmless profile fields.
 *
 * Holding the learner id is what this route accepts as being that learner.
 * That only means something because the id is no longer published: missions
 * carry learnerRef, a one-way hash, and scripts/backfill-learner-refs.mjs
 * removed learnerId from every existing mission. The id lives in the
 * learner's own browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { learnerContactWriter } from '@/infrastructure/container.server';
import { clientIp, rateLimited } from '@/app/api/rateLimit';

const bodySchema = z.object({
  // null clears the address (the learner removing it).
  email: z.string().email('Must be a valid email address').nullable(),
});

// Keyed by IP and learner id together, so a class on one school IP is not one
// bucket: each child saving their own address has their own allowance, while a
// single id cannot be hammered. Saving an address is a rare thing a learner
// does a handful of times, so ten in ten minutes is generous.
const EMAIL_LIMIT = 10;
const EMAIL_WINDOW_SECONDS = 600;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  if (!id || id.length > 64) {
    return NextResponse.json(
      { success: false, error: 'Invalid learner id' },
      { status: 400 }
    );
  }

  const limited = await rateLimited(
    `learner-email:${clientIp(request)}:${id}`,
    EMAIL_LIMIT,
    EMAIL_WINDOW_SECONDS,
    'You are changing your email too often. Please wait a minute and try again.',
  );
  if (limited) return limited;

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
      {
        success: false,
        error: validation.error.errors.map((e) => e.message).join(', '),
      },
      { status: 400 }
    );
  }

  const { email } = validation.data;

  try {
    await learnerContactWriter().save(id, email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[learners/email] Failed to persist contact address:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save email' },
      { status: 500 }
    );
  }
}
