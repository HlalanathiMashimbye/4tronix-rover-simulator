/**
 * The optimistic gate (AB#341).
 *
 * This is NOT the security boundary and these tests should not read as if it
 * were: all it decides is where an unauthenticated visitor lands. lib/auth/dal
 * is what verifies. What matters here is that an API caller gets JSON and a
 * page caller gets a page, because handing a fetch() an HTML redirect is
 * miserable to debug.
 */

import { proxy, config } from '@/proxy';
import type { NextRequest } from 'next/server';

function request(pathname: string, cookie?: string): NextRequest {
  return {
    nextUrl: { pathname },
    url: `https://marsyard.labs.ws${pathname}`,
    cookies: { get: () => (cookie ? { value: cookie } : undefined) },
  } as unknown as NextRequest;
}

describe('operator proxy', () => {
  it('lets a request with a session cookie through untouched', () => {
    // Untouched, not trusted: dal.ts still verifies it.
    const res = proxy(request('/operator', 'anything-at-all'));

    expect(res.status).toBe(200);
  });

  it('answers an unauthenticated API call with 401 JSON, never a redirect', async () => {
    const res = proxy(request('/api/operator/missions'));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Unauthorized' });
  });

  it('lets an unauthenticated visitor reach /operator so it can render sign-in', () => {
    // One route: /operator is both the console and the sign-in page, so there
    // is no separate /login to distribute or to stumble across.
    const res = proxy(request('/operator'));

    expect(res.status).toBe(200);
  });

  it('redirects an unauthenticated visitor from a deeper operator page to sign-in', () => {
    const res = proxy(request('/operator/missions/abc123'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://marsyard.labs.ws/operator');
  });

  it('covers both the pages and the API in its matcher', () => {
    // A route outside the matcher is silently unguarded, which looks fine in
    // review. Pin it.
    expect(config.matcher).toEqual(['/operator/:path*', '/api/operator/:path*']);
  });
});
