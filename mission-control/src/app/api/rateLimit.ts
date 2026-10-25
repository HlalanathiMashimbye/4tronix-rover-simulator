/**
 * The one place the public routes read a caller's IP and apply a limit.
 *
 * One helper, not a copy in each route, so the three that need it key the
 * limit the same way and read the IP the same way: the next route to add a
 * limit copies this, not a hand-rolled header read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter } from '@/infrastructure/container.server';

/**
 * The original client's IP.
 *
 * Staging and prod sit behind Cloudflare in front of the load balancer (see
 * docs/go-live.md), so cf-connecting-ip is the real client and is set by the
 * edge, not the caller. x-forwarded-for is the fallback for any path without
 * Cloudflare: its first entry is the original client, the rest are proxies.
 * Neither header means a local or direct caller, keyed together as 'unknown'
 * (local development is not a flooding concern).
 */
export function clientIp(request: NextRequest): string {
  const cloudflare = request.headers.get('cf-connecting-ip');
  if (cloudflare) return cloudflare.trim();

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}

/**
 * A 429 to return when `key` is over its limit, or null when it is within it.
 *
 * The limiter counts this call and fails open, so a null here means "allowed,
 * carry on". `message` is shown to the caller, so it says what a learner can
 * do about it, not what the limit is.
 */
export async function rateLimited(
  key: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<NextResponse | null> {
  const allowed = await rateLimiter().allow(key, limit, windowSeconds);
  if (allowed) return null;

  return NextResponse.json({ success: false, error: message }, { status: 429 });
}
