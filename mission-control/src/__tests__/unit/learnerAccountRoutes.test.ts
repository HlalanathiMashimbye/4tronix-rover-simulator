/**
 * The learner routes behind the challenges: profile, recovery code, parent
 * link and parent restore. Each is a controller over the container, so these
 * stub the container and check what reaches it.
 */

const saveProfile = jest.fn();
const ensureExists = jest.fn();
const exists = jest.fn();
const profiles = jest.fn();
const verifyRecent = jest.fn();
const storeCodeHash = jest.fn();
const link = jest.fn();
const findByLearnerId = jest.fn();
const findByParentUid = jest.fn();

jest.mock('@/infrastructure/container.server', () => ({
  learnerAccounts: () => ({ saveProfile, ensureExists, exists, profiles }),
  parentSignIn: () => ({ verifyRecent }),
  adminRecoveryCodeRepository: () => ({ storeCodeHash }),
  adminParentLinkRepository: () => ({ link, findByLearnerId, findByParentUid }),
  adminLeaderboardRepository: () => ({ findByLearnerRef: async () => null }),
}));

import { webcrypto } from 'node:crypto';
import { NextRequest } from 'next/server';

import { POST as saveProfileRoute } from '@/app/api/learners/[id]/profile/route';
import { POST as recoveryCodeRoute } from '@/app/api/learners/[id]/recovery-code/route';
import { POST as parentLinkRoute } from '@/app/api/learners/[id]/parent-link/route';
import { POST as parentRestoreRoute } from '@/app/api/parent-restore/route';
import { generateDisplayName } from '@/core/domain/services/displayNameGenerator';
import { CURRENT_CONSENT_VERSION } from '@/core/domain/services/parentLink';

const params = { params: Promise.resolve({ id: 'learner-1' }) };
const post = (path: string, body?: unknown, ip = '203.0.113.7') => new NextRequest(`https://example.com${path}`, {
  method: 'POST',
  headers: { 'x-forwarded-for': ip },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('saving a profile', () => {
  it('saves a generated name and an allowed avatar', async () => {
    const displayName = generateDisplayName();
    const res = await saveProfileRoute(post('/api/learners/learner-1/profile', { displayName, avatar: { style: 'bottts', seed: 'abc' } }), params);

    expect(res.status).toBe(200);
    expect(saveProfile).toHaveBeenCalledWith('learner-1', displayName, { style: 'bottts', seed: 'abc' }, expect.any(String));
  });

  it('refuses a typed name before anything is saved', async () => {
    const res = await saveProfileRoute(post('/api/learners/learner-1/profile', { displayName: 'Anything I like', avatar: { style: 'bottts', seed: 'abc' } }), params);

    expect(res.status).toBe(400);
    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe('a recovery code', () => {
  it('makes sure the learner has a record, stores only the hash, and returns the code once', async () => {
    const res = await recoveryCodeRoute(post('/api/learners/learner-1/recovery-code'), params);
    const { code } = await res.json();

    expect(ensureExists).toHaveBeenCalledWith('learner-1', expect.any(String));
    const [, , storedHash] = storeCodeHash.mock.calls[0];
    expect(code).toBeTruthy();
    expect(storedHash).not.toContain(code.replace(/-/g, ''));
  });
});

describe('linking a parent', () => {
  const body = { idToken: 't', consentVersion: CURRENT_CONSENT_VERSION };

  it('refuses a stale sign-in with 401 and links nothing', async () => {
    verifyRecent.mockResolvedValue({ ok: false, reason: 'stale' });

    const res = await parentLinkRoute(post('/api/learners/learner-1/parent-link', body), params);

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Please sign in again');
    expect(link).not.toHaveBeenCalled();
  });

  it('refuses a learner with no record', async () => {
    verifyRecent.mockResolvedValue({ ok: true, uid: 'parent-1' });
    exists.mockResolvedValue(false);

    expect((await parentLinkRoute(post('/api/learners/learner-1/parent-link', body), params)).status).toBe(404);
    expect(link).not.toHaveBeenCalled();
  });

  it('links the signed-in parent to an existing learner', async () => {
    verifyRecent.mockResolvedValue({ ok: true, uid: 'parent-1' });
    exists.mockResolvedValue(true);
    findByLearnerId.mockResolvedValue(null);

    expect((await parentLinkRoute(post('/api/learners/learner-1/parent-link', body), params)).status).toBe(200);
    expect(link).toHaveBeenCalledWith('learner-1', 'parent-1', CURRENT_CONSENT_VERSION);
  });
});

describe('restoring through a parent', () => {
  it("returns the linked learners' names and avatars to pick between", async () => {
    verifyRecent.mockResolvedValue({ ok: true, uid: 'parent-1' });
    findByParentUid.mockResolvedValue(['learner-1']);
    profiles.mockResolvedValue([{ learnerId: 'learner-1', displayName: 'Brave Comet' }]);

    const res = await parentRestoreRoute(post('/api/parent-restore', { idToken: 't' }, '203.0.113.8'));

    expect(profiles).toHaveBeenCalledWith(['learner-1']);
    expect((await res.json()).learners).toEqual([{ learnerId: 'learner-1', displayName: 'Brave Comet' }]);
  });

  it('refuses an invalid sign-in without reading any learner', async () => {
    verifyRecent.mockResolvedValue({ ok: false, reason: 'invalid' });

    const res = await parentRestoreRoute(post('/api/parent-restore', { idToken: 't' }, '203.0.113.9'));

    expect(res.status).toBe(401);
    expect(findByParentUid).not.toHaveBeenCalled();
    expect(profiles).not.toHaveBeenCalled();
  });
});
