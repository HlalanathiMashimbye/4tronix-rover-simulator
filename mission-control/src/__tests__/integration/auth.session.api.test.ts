/**
 * Exchanging a Firebase ID token for a server session (AB#342).
 *
 * This route is the only way to obtain an operator session, so the refusals
 * matter more than the happy path. The version it replaces stored the raw ID
 * token as the cookie with a one-hour life, which signed operators out mid
 * event and could not be revoked.
 */

const verifyIdToken = jest.fn();
const createSessionCookie = jest.fn();
const verifySessionCookie = jest.fn();
const revokeRefreshTokens = jest.fn();

// The yard is validated against the live list at sign-in, so the repository
// is stubbed with one selectable yard rather than reaching Firestore.
jest.mock('@/infrastructure/container.server', () => ({
  adminYardRepository: () => ({
    findAll: async () => [
      { id: 'curiosity', name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true },
    ],
  }),
}));

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken, createSessionCookie, verifySessionCookie, revokeRefreshTokens,
  }),
}));

import { POST, DELETE } from '@/app/api/auth/session/route';
import { NextRequest } from 'next/server';

const NOW = 1_800_000_000_000;
const recentSignIn = () => Math.floor((NOW - 30_000) / 1000);

function post(body: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  createSessionCookie.mockResolvedValue('a-real-session-cookie');
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/auth/session', () => {
  it('issues an httpOnly session cookie for an operator', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', role: 'operator', auth_time: recentSignIn() });

    const res = await POST(post({ token: 'id-token', yardId: 'curiosity' }));
    const cookie = res.cookies.get('session');

    expect(res.status).toBe(200);
    expect(cookie?.value).toBe('a-real-session-cookie');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
  });

  it('stores a session cookie, never the raw ID token', async () => {
    // The regression this route was rewritten for.
    verifyIdToken.mockResolvedValue({ uid: 'u1', role: 'admin', auth_time: recentSignIn() });

    const res = await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    expect(createSessionCookie).toHaveBeenCalledWith('id-token', expect.anything());
    expect(res.cookies.get('session')?.value).not.toBe('id-token');
  });

  it('gives a session long enough to cover an event day', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', role: 'operator', auth_time: recentSignIn() });

    await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    const [, opts] = createSessionCookie.mock.calls[0];
    expect(opts.expiresIn).toBe(12 * 60 * 60 * 1000);
  });

  it('refuses an account with no operator role, before minting anything', async () => {
    // A learner must not receive a cookie that can never work: that turns a
    // clear "no access" into a silent redirect loop.
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: recentSignIn() });

    const res = await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    expect(res.status).toBe(403);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses a token from a sign-in that is not recent', async () => {
    // Firebase's guidance: without this, a stolen but still-valid ID token can
    // be turned into a 12-hour session long after the fact.
    verifyIdToken.mockResolvedValue({
      uid: 'u1', role: 'operator', auth_time: Math.floor((NOW - 10 * 60_000) / 1000),
    });

    const res = await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    expect(res.status).toBe(401);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it('checks the token for revocation', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', role: 'operator', auth_time: recentSignIn() });

    await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    expect(verifyIdToken).toHaveBeenCalledWith('id-token', true);
  });

  it('rejects an invalid token without saying why', async () => {
    // A specific reason helps someone guessing.
    verifyIdToken.mockRejectedValue(new Error('Firebase ID token has expired'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(post({ token: 'id-token', yardId: 'curiosity' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Could not sign you in');
  });

  it.each([
    ['a missing token', {}],
    ['a non-string token', { token: 42 }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await POST(post(body))).status).toBe(400);
  });

  it('rejects a malformed body rather than throwing', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
  });
});

describe('DELETE /api/auth/session', () => {
  function del(cookie?: string) {
    const req = new NextRequest('http://localhost:3000/api/auth/session', { method: 'DELETE' });
    if (cookie) req.cookies.set('session', cookie);
    return req;
  }

  it('clears the cookie and revokes the session everywhere', async () => {
    verifySessionCookie.mockResolvedValue({ sub: 'u1' });

    const res = await DELETE(del('a-session-cookie'));

    expect(res.cookies.get('session')?.value).toBe('');
    expect(revokeRefreshTokens).toHaveBeenCalledWith('u1');
  });

  it('still clears the cookie when the session cannot be verified', async () => {
    // A session we cannot verify is the one a user most wants gone.
    verifySessionCookie.mockRejectedValue(new Error('expired'));

    const res = await DELETE(del('a-stale-cookie'));

    expect(res.status).toBe(200);
    expect(res.cookies.get('session')?.value).toBe('');
  });

  it('is harmless when there is no session at all', async () => {
    const res = await DELETE(del());

    expect(res.status).toBe(200);
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
