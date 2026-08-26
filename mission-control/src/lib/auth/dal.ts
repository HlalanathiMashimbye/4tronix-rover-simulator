import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';

import { getFirebaseAdminAuth } from '@/infrastructure/persistence/firebase-admin';

/**
 * Where operator access is actually decided.
 *
 * `proxy.ts` only checks that a session cookie EXISTS, because Next's own
 * guidance is that proxy does optimistic checks and the real one belongs next
 * to the data (node_modules/next/dist/docs/01-app/02-guides/authentication.md).
 * A cookie can be forged; nothing here trusts it until Firebase has verified it.
 *
 * Every operator page and route calls this explicitly. That is deliberately
 * more typing than a single global guard: a route that forgets to call it is
 * visibly missing a line, whereas a route that falls outside a matcher pattern
 * looks fine and is wide open.
 */

/** Name of the httpOnly session cookie set by POST /api/auth/session. */
export const SESSION_COOKIE = 'session';

export type OperatorRole = 'operator' | 'admin';

export interface OperatorSession {
  uid: string;
  email?: string;
  role: OperatorRole;
  /** Yards this operator may act on. Empty means none, not all. */
  yardIds: string[];
}

function isRole(value: unknown): value is OperatorRole {
  return value === 'operator' || value === 'admin';
}

/**
 * The signed-in operator, or null.
 *
 * Memoised per request with React `cache`, so a page and the routes it calls
 * verify once rather than once each. Never throws: callers decide whether
 * "nobody is signed in" is a redirect or a 401, and those differ between a page
 * and an API route.
 */
export const getOperatorSession = cache(async (): Promise<OperatorSession | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!cookie) {
    return null;
  }

  try {
    // checkRevoked: true costs a lookup but means revoking an operator takes
    // effect on their next request rather than whenever their session happens
    // to expire. For an account that can move a robot near children, that is
    // the right trade.
    const claims = await getFirebaseAdminAuth().verifySessionCookie(cookie, true);

    if (!isRole(claims.role)) {
      return null;
    }

    const yardIds = Array.isArray(claims.yardIds)
      ? claims.yardIds.filter((y): y is string => typeof y === 'string')
      : [];

    return {
      uid: claims.uid,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      role: claims.role,
      yardIds,
    };
  } catch {
    // Expired, revoked, malformed, or signed for another project. All of them
    // mean the same thing to a caller, and none of them should leak a reason.
    return null;
  }
});

/** True when this session may act on the given yard. Admins are not exempt. */
export function canActOnYard(session: OperatorSession, yardId: string): boolean {
  return session.yardIds.includes(yardId);
}

/**
 * The session, or throw. For API routes, which turn this into a 401.
 * Pages should use getOperatorSession() and redirect instead.
 */
export async function requireOperator(): Promise<OperatorSession> {
  const session = await getOperatorSession();

  if (!session) {
    throw new UnauthorizedError();
  }

  return session;
}

/** As requireOperator, but the admin tier: delete and dispatch. */
export async function requireAdmin(): Promise<OperatorSession> {
  const session = await requireOperator();

  if (session.role !== 'admin') {
    throw new ForbiddenError();
  }

  return session;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}
