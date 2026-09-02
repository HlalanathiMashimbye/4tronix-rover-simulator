/**
 * The admin settings API: what an admin may change without a deploy.
 */

const requireAdmin = jest.fn();
const readSetting = jest.fn();
const writeSetting = jest.fn();

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireAdmin: () => requireAdmin(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: (...a: unknown[]) => readSetting(...a),
  writeSetting: (...a: unknown[]) => writeSetting(...a),
}));

import { NextRequest } from 'next/server';

import { GET, PUT } from '@/app/api/operator/settings/route';

function put(body: unknown) {
  return new NextRequest('https://example.com/api/operator/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('/api/operator/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdmin.mockResolvedValue({ uid: 'u1', email: 'admin@uct.ac.za', role: 'admin' });
    readSetting.mockResolvedValue(null);
    writeSetting.mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe('who may see and change them', () => {
    it('refuses a signed-out caller', async () => {
      requireAdmin.mockRejectedValue(new UnauthorizedError());

      expect((await GET()).status).toBe(401);
    });

    it('refuses an operator who is not an admin', async () => {
      requireAdmin.mockRejectedValue(new ForbiddenError());

      expect((await PUT(put({ name: 'resendFromEmail', value: 'a@b.co' }))).status).toBe(403);
      expect(writeSetting).not.toHaveBeenCalled();
    });
  });

  describe('reading', () => {
    it('never returns a secret value, only whether it is set', async () => {
      // Only the secret one holds the key, or the assertion below would be
      // catching the mock rather than the code.
      readSetting.mockImplementation(async (name: string) =>
        name === 'resendApiKey' ? 're_a_real_key_that_must_not_leak' : null);

      const body = await (await GET()).json();
      const apiKey = body.settings.find((s: { name: string }) => s.name === 'resendApiKey');

      expect(apiKey.configured).toBe(true);
      expect(apiKey.value).toBeNull();
      expect(JSON.stringify(body)).not.toContain('re_a_real_key');
    });

    it('returns the value of settings that are not secret', async () => {
      readSetting.mockImplementation(async (name: string) =>
        name === 'youtubeChannelId' ? 'UCabcdef' : null);

      const body = await (await GET()).json();
      const channel = body.settings.find((s: { name: string }) => s.name === 'youtubeChannelId');

      expect(channel.value).toBe('UCabcdef');
    });
  });

  describe('writing', () => {
    it('saves a valid change', async () => {
      const resp = await PUT(put({ name: 'youtubeChannelId', value: '  UCnewchannel  ' }));

      expect(resp.status).toBe(200);
      // Trimmed: a pasted value picks up whitespace and a channel id with a
      // trailing space matches nothing, silently.
      expect(writeSetting).toHaveBeenCalledWith('youtubeChannelId', 'UCnewchannel');
    });

    it('refuses a value that would quietly break the thing it configures', async () => {
      const resp = await PUT(put({ name: 'youtubeChannelId', value: 'not-a-channel' }));

      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toMatch(/starts with UC/);
      // A Secret Manager version cannot be edited, only superseded, so a bad
      // value is permanent history and live until somebody notices.
      expect(writeSetting).not.toHaveBeenCalled();
    });

    it('refuses a setting nobody declared', async () => {
      const resp = await PUT(put({ name: 'somethingElse', value: 'x' }));

      expect(resp.status).toBe(400);
      expect(writeSetting).not.toHaveBeenCalled();
    });

    it('refuses an empty value rather than letting Secret Manager reject it', async () => {
      /**
       * Secret Manager answers an empty payload with
       * "3 INVALID_ARGUMENT: Secret Payload cannot be empty", which reached
       * the admin as a 502 that reads like an outage. Every setting that
       * remains needs a value.
       */
      const resp = await PUT(put({ name: 'youtubeChannelId', value: '   ' }));

      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toMatch(/cannot be empty/);
      expect(writeSetting).not.toHaveBeenCalled();
    });

    it('holds the poll interval to the floor the scheduler can actually deliver', async () => {
      const resp = await PUT(put({ name: 'youtubeLinkIntervalMinutes', value: '2' }));

      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toMatch(/5 is the floor/);
    });

    it('says plainly when the write did not land', async () => {
      writeSetting.mockRejectedValue(new Error('Secret Manager is down'));

      const resp = await PUT(put({ name: 'youtubeChannelId', value: 'UCok' }));

      expect(resp.status).toBe(502);
      expect((await resp.json()).error).toMatch(/not applied/);
    });
  });
});
