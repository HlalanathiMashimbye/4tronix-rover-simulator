import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/infrastructure/auth/dal';

/**
 * Optimistic gate for the operator surface (AB#341).
 *
 * This ONLY checks that a session cookie is present. It does not verify it, and
 * it is not the security boundary: `src/lib/auth/dal.ts` is, and every operator
 * page and route calls it. Next's own guidance is that proxy performs optimistic
 * checks and the real one lives next to the data
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md).
 *
 * Deliberately NOT restored from the version deleted in 30aacc2. That one
 * verified Firebase ID tokens here with `jose`, against the securetoken issuer
 * and x509 endpoint. A Firebase SESSION cookie has a different issuer and
 * different public keys, so restoring it alongside session cookies would reject
 * every valid login. It also cached certs in module scope, which the proxy docs
 * warn against relying on.
 *
 * What it buys: an unauthenticated visitor gets a sign-in page or a 401 without
 * a Firestore round trip, and the operator surface never renders for them.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (hasSession) {
    return NextResponse.next();
  }

  // API routes get JSON. A redirect here would hand a fetch() an HTML page and
  // a 200, which is a far worse thing to debug than a 401.
  if (request.nextUrl.pathname.startsWith('/api/operator')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Pages fall through to /operator itself, which renders the sign-in form when
  // there is no session. One route, so there is no separate /login to discover.
  if (request.nextUrl.pathname === '/operator') {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/operator', request.url));
}

export const config = {
  matcher: ['/operator/:path*', '/api/operator/:path*'],
};
