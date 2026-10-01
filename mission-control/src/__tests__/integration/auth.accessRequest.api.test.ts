/**
 * Asking an admin for operator access.
 *
 * The request is sent in the name of whoever Google verified, never a typed
 * address, and it can only email: granting stays with the admin.
 */

const verifyIdToken = jest.fn();
const docGet = jest.fn();
const docSet = jest.fn();
const send = jest.fn();
const listOperatorAccounts = jest.fn();

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirebaseAdminAuth: () => ({ verifyIdToken }),
  getFirestoreInstance: () => ({
    collection: () => ({ doc: () => ({ get: docGet, set: docSet }) }),
  }),
}));
jest.mock('@/infrastructure/auth/operatorAccounts', () => ({
  listOperatorAccounts: () => listOperatorAccounts(),
}));
jest.mock('@/infrastructure/email/resend-client', () => ({
  ResendEmailSender: jest.fn().mockImplementation(() => ({ send })),
}));

import { POST } from '@/app/api/auth/access-request/route';
import { NextRequest } from 'next/server';

const NOW = 1_800_000_000_000;

function post(body: unknown) {
  return POST(new NextRequest('http://localhost:3005/api/auth/access-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const googleUser = { uid: 'g1', email: 'thandi@school.org', email_verified: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  verifyIdToken.mockResolvedValue(googleUser);
  docGet.mockResolvedValue({ exists: false, data: () => undefined });
  docSet.mockResolvedValue(undefined);
  send.mockResolvedValue(undefined);
  listOperatorAccounts.mockResolvedValue([
    { uid: 'a1', email: 'mshhla017@myuct.ac.za', role: 'admin' },
    { uid: 'a2', email: 'second@rover.com', role: 'admin' },
    { uid: 'o1', email: 'op@rover.com', role: 'operator' },
  ]);
});

afterEach(() => jest.restoreAllMocks());

it('emails every admin, and only admins, with a link to grant this exact address', async () => {
  const res = await post({ token: 't' });

  expect(res.status).toBe(200);
  expect(send.mock.calls.map((c) => c[0]).sort()).toEqual(['mshhla017@myuct.ac.za', 'second@rover.com']);
  const html: string = send.mock.calls[0][2];
  expect(html).toContain('/operator/team?grant=thandi%40school.org');
  expect(send.mock.calls[0][1]).toContain('thandi@school.org');
});

it('links to this deployment when no app URL is configured', async () => {
  await post({ token: 't' });

  expect(send.mock.calls[0][2]).toContain('http://localhost:3005/operator/team');
});

it('refuses without a verified sign-in, so nobody can ask in someone else\'s name', async () => {
  verifyIdToken.mockRejectedValue(new Error('bad token'));

  const res = await post({ token: 'forged' });

  expect(res.status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});

it('does not put an unverified address in front of an admin', async () => {
  verifyIdToken.mockResolvedValue({ ...googleUser, email_verified: false });

  const res = await post({ token: 't' });

  expect(res.status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

it('tells someone who already has access to sign in again instead', async () => {
  verifyIdToken.mockResolvedValue({ ...googleUser, role: 'operator' });

  const res = await post({ token: 't' });

  expect(res.status).toBe(409);
  expect(send).not.toHaveBeenCalled();
});

it('sends once an hour at most, so a double tap is not two emails', async () => {
  docGet.mockResolvedValue({ exists: true, data: () => ({ requestedAt: new Date(NOW - 10 * 60 * 1000).toISOString() }) });

  const res = await post({ token: 't' });
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body.alreadyAsked).toBe(true);
  expect(send).not.toHaveBeenCalled();
});

it('records the request after sending', async () => {
  await post({ token: 't' });

  expect(docSet).toHaveBeenCalledWith(expect.objectContaining({ email: 'thandi@school.org' }));
});

it('says so when there is no admin to ask', async () => {
  listOperatorAccounts.mockResolvedValue([{ uid: 'o1', email: 'op@rover.com', role: 'operator' }]);

  const res = await post({ token: 't' });

  expect(res.status).toBe(503);
  expect(send).not.toHaveBeenCalled();
});

it('escapes the address in the email', async () => {
  verifyIdToken.mockResolvedValue({ ...googleUser, email: '<b>x</b>@school.org' });

  await post({ token: 't' });

  expect(send.mock.calls[0][2]).not.toContain('<b>x</b>');
});
