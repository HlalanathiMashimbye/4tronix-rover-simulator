/**
 * The operator access decision (AB#341).
 *
 * proxy.ts only checks that a cookie EXISTS. Everything that decides whether
 * someone may act is here, so this is where a mistake is expensive: a forged
 * cookie, a revoked operator, or a token from another Firebase project must all
 * resolve to "nobody is signed in".
 */

const verifySessionCookie = jest.fn();
const cookieStore = { get: jest.fn() };

jest.mock('next/headers', () => ({ cookies: async () => cookieStore }));
jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirebaseAdminAuth: () => ({ verifySessionCookie }),
}));

// Only the pure helpers are imported directly. Everything that reads a cookie
// goes through freshDal() below, because getOperatorSession is memoised with
// React cache and would otherwise carry a result between tests.
import {
  SESSION_COOKIE,
  UnauthorizedError,
  ForbiddenError,
} from '@/infrastructure/auth/dal';

// getOperatorSession is memoised with React cache, which dedupes within a
// request. Re-import per test so each starts from a clean slate.
async function freshDal() {
  jest.resetModules();
  return import('@/infrastructure/auth/dal');
}

beforeEach(() => {
  jest.clearAllMocks();
  cookieStore.get.mockReturnValue({ value: 'a-session-cookie' });
});

describe('getOperatorSession', () => {
  it('returns null when there is no cookie, without calling Firebase', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).toBeNull();
    expect(verifySessionCookie).not.toHaveBeenCalled();
  });

  it('checks for revocation, so removing an operator takes effect immediately', async () => {
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'operator' });
    const dal = await freshDal();

    await dal.getOperatorSession();

    expect(verifySessionCookie).toHaveBeenCalledWith('a-session-cookie', true);
  });

  it('returns the session for a valid operator cookie', async () => {
    verifySessionCookie.mockResolvedValue({
      uid: 'u1', email: 'op@example.com', role: 'operator',
    });
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).toEqual({
      uid: 'u1', email: 'op@example.com', role: 'operator',
    });
  });

  it('rejects a verified user carrying no operator role', async () => {
    // A learner who somehow obtains a session is still not an operator.
    verifySessionCookie.mockResolvedValue({ uid: 'u1' });
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).toBeNull();
  });

  it('rejects an unrecognised role rather than trusting the claim', async () => {
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'superuser' });
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).toBeNull();
  });

  it('returns null when verification throws, and leaks no reason', async () => {
    // Expired, revoked, forged, or signed for another project all land here.
    verifySessionCookie.mockRejectedValue(new Error('Firebase ID token has expired'));
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).toBeNull();
  });

  it('ignores a stale yardIds claim rather than carrying it into the session', async () => {
    // Accounts granted before 2026-08-27 still hold this claim. Operators are
    // no longer assigned yards, so it must not resurface as a permission.
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'admin', yardIds: ['curiosity'] });
    const dal = await freshDal();

    expect(await dal.getOperatorSession()).not.toHaveProperty('yardIds');
  });
});

describe('requireOperator / requireAdmin', () => {
  it('throws Unauthorized when nobody is signed in', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const dal = await freshDal();

    await expect(dal.requireOperator()).rejects.toThrow('Unauthorized');
  });

  it('lets an operator through', async () => {
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'operator' });
    const dal = await freshDal();

    expect((await dal.requireOperator()).role).toBe('operator');
  });

  it('refuses an operator on an admin-only action', async () => {
    // Delete and dispatch are admin. An operator reaching them is a bug, not a
    // permission to widen.
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'operator' });
    const dal = await freshDal();

    await expect(dal.requireAdmin()).rejects.toThrow('Forbidden');
  });

  it('lets an admin through', async () => {
    verifySessionCookie.mockResolvedValue({ uid: 'u1', role: 'admin' });
    const dal = await freshDal();

    expect((await dal.requireAdmin()).role).toBe('admin');
  });
});

it('exports the cookie name the proxy matches on', () => {
  // proxy.ts imports this rather than repeating the string, so the optimistic
  // check and the real one can never disagree about which cookie to read.
  expect(SESSION_COOKIE).toBe('session');
  expect(new UnauthorizedError().name).toBe('UnauthorizedError');
  expect(new ForbiddenError().name).toBe('ForbiddenError');
});
