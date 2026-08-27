/**
 * Granting and revoking operator access over HTTP.
 *
 * This route can hand someone the ability to drive a robot near children, and
 * can take away the last account able to hand it back. Both directions are
 * tested here against the real handler, with only Firebase mocked.
 */

const requireAdmin = jest.fn();
const setCustomUserClaims = jest.fn();
const revokeRefreshTokens = jest.fn();
const getUserByEmail = jest.fn();
const listUsers = jest.fn();
const docSet = jest.fn();

jest.mock('@/lib/auth/dal', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    requireAdmin: (...args: unknown[]) => requireAdmin(...args),
    UnauthorizedError,
    ForbiddenError,
  };
});

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirebaseAdminAuth: () => ({
    setCustomUserClaims,
    revokeRefreshTokens,
    getUserByEmail,
    listUsers,
  }),
  getFirestoreInstance: () => ({
    collection: () => ({
      doc: () => ({
        set: docSet,
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    }),
  }),
}));

import { POST, GET } from '@/app/api/operator/team/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/dal';
import { NextRequest } from 'next/server';

const ADMIN = { uid: 'admin-uid', email: 'admin@rover.com', role: 'admin' as const };

function authUser(uid: string, email: string, role?: string) {
  return { uid, email, customClaims: role ? { role } : {} };
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/operator/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** The population listUsers reports for a test. */
function population(users: ReturnType<typeof authUser>[]) {
  listUsers.mockResolvedValue({ users, pageToken: undefined });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  docSet.mockResolvedValue(undefined);
  setCustomUserClaims.mockResolvedValue(undefined);
  revokeRefreshTokens.mockResolvedValue(undefined);
});

describe('who may call it', () => {
  it('401s an anonymous caller', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError());
    const response = await post({ email: 'x@y.com', role: 'operator' });
    expect(response.status).toBe(401);
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('403s a plain operator, who must not be able to promote themselves', async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError());
    const response = await post({ email: 'op@rover.com', role: 'admin' });
    expect(response.status).toBe(403);
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('403s a non-admin reading the list of who has access', async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError());
    expect((await GET()).status).toBe(403);
  });
});

describe('granting', () => {
  it('sets the claim and records who granted it', async () => {
    population([authUser('admin-uid', 'admin@rover.com', 'admin')]);
    getUserByEmail.mockResolvedValue(authUser('new-uid', 'new@rover.com'));

    const response = await post({ email: 'new@rover.com', role: 'operator' });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(setCustomUserClaims).toHaveBeenCalledWith('new-uid', { role: 'operator' });
    // The script could only record $USER from whatever shell ran it.
    expect(docSet).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'operator', grantedBy: 'admin@rover.com' }),
      { merge: true },
    );
    // Claims ride on the ID token, so this is not live until it refreshes.
    expect(data.message).toMatch(/sign out and back in/i);
  });

  it('preserves unrelated claims rather than overwriting the object', async () => {
    population([authUser('admin-uid', 'admin@rover.com', 'admin')]);
    getUserByEmail.mockResolvedValue({
      uid: 'u1',
      email: 'u1@rover.com',
      customClaims: { somethingElse: 'keep me' },
    });

    await post({ email: 'u1@rover.com', role: 'operator' });

    expect(setCustomUserClaims).toHaveBeenCalledWith('u1', {
      somethingElse: 'keep me',
      role: 'operator',
    });
  });

  it('explains that an account must exist first', async () => {
    population([authUser('admin-uid', 'admin@rover.com', 'admin')]);
    getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });

    const response = await post({ email: 'ghost@rover.com', role: 'operator' });
    const data = await response.json();

    expect(response.status).toBe(404);
    // Granting a role does not create an account, and saying so is the
    // difference between a two-minute fix and a confused afternoon.
    expect(data.error).toMatch(/Firebase Authentication first/i);
  });

  it('rejects a misspelled role instead of silently granting nothing', async () => {
    const response = await post({ email: 'x@y.com', role: 'oprator' });
    expect(response.status).toBe(400);
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('does not rewrite a role someone already has', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      authUser('op-uid', 'op@rover.com', 'operator'),
    ]);
    getUserByEmail.mockResolvedValue(authUser('op-uid', 'op@rover.com', 'operator'));

    const response = await post({ email: 'op@rover.com', role: 'operator' });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.unchanged).toBe(true);
    // A pointless write would rotate their refresh tokens and sign them out to
    // give them exactly what they already had.
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe('revoking', () => {
  it('clears the claim and signs them out immediately', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      authUser('op-uid', 'op@rover.com', 'operator'),
    ]);
    getUserByEmail.mockResolvedValue(authUser('op-uid', 'op@rover.com', 'operator'));

    const response = await post({ email: 'op@rover.com', role: null });

    expect(response.status).toBe(200);
    expect(setCustomUserClaims).toHaveBeenCalledWith('op-uid', {});
    // dal.ts verifies with checkRevoked, so this bites on their next request
    // rather than whenever the session happens to lapse.
    expect(revokeRefreshTokens).toHaveBeenCalledWith('op-uid');
  });

  it('refuses to remove the last admin, over HTTP', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      authUser('op-uid', 'op@rover.com', 'operator'),
    ]);
    // Another admin is acting, so the self-revoke rule is not what catches it.
    requireAdmin.mockResolvedValue({ uid: 'other', email: 'other@rover.com', role: 'admin' });
    getUserByEmail.mockResolvedValue(authUser('admin-uid', 'admin@rover.com', 'admin'));

    const response = await post({ email: 'admin@rover.com', role: null });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toMatch(/only admin account/i);
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('refuses to remove your own access', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      authUser('a2', 'second@rover.com', 'admin'),
    ]);
    getUserByEmail.mockResolvedValue(authUser('admin-uid', 'admin@rover.com', 'admin'));

    const response = await post({ email: 'admin@rover.com', role: null });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toMatch(/your own admin access/i);
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('allows removing an admin when another remains', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      authUser('a2', 'second@rover.com', 'admin'),
    ]);
    getUserByEmail.mockResolvedValue(authUser('a2', 'second@rover.com', 'admin'));

    const response = await post({ email: 'second@rover.com', role: null });

    expect(response.status).toBe(200);
    expect(setCustomUserClaims).toHaveBeenCalledWith('a2', {});
  });
});

describe('the account list', () => {
  it('returns only accounts holding a role, as a narrow DTO', async () => {
    population([
      authUser('admin-uid', 'admin@rover.com', 'admin'),
      { uid: 'nobody', email: 'nobody@rover.com', customClaims: {} },
    ]);

    const data = await (await GET()).json();

    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({ email: 'admin@rover.com', role: 'admin' });

    // Nothing BEYOND the DTO may cross to the client. A Firebase UserRecord
    // also carries phone numbers, provider identities and password-hash
    // metadata, and this list renders in a browser.
    const allowed = ['uid', 'email', 'role', 'grantedAt', 'grantedBy'];
    expect(Object.keys(data.accounts[0]).filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('omits audit fields rather than inventing them when there is no ledger entry', async () => {
    // Anyone granted by the script before this page existed has no record of
    // by whom. That is missing history, not a reason to fail or fabricate.
    population([authUser('admin-uid', 'admin@rover.com', 'admin')]);

    const data = await (await GET()).json();

    expect(data.accounts[0].grantedBy).toBeUndefined();
  });
});
