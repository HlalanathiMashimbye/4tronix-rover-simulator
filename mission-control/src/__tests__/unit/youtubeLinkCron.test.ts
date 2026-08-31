/**
 * The scheduled linker, which used to be a timer loop on the yard satellite.
 */

const findRuns = jest.fn();
const applyBookkeeping = jest.fn();
const fetchRecentUploads = jest.fn();

jest.mock('@/infrastructure/container.server', () => ({
  adminMissionRepository: () => ({ findRuns, applyBookkeeping }),
}));

jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: async () => '15',
}));

// The throttle's state. Defaulted to "never checked", so every test below is
// about linking rather than about being due.
const lastCheckedAt = jest.fn(async () => null);
const recordChecked = jest.fn(async () => {});
jest.mock('@/infrastructure/persistence/pollState', () => ({
  lastCheckedAt: () => lastCheckedAt(),
  recordChecked: () => recordChecked(),
  isDue: jest.requireActual('@/infrastructure/persistence/pollState').isDue,
}));

jest.mock('@/infrastructure/youtube/channelUploads', () => ({
  fetchRecentUploads: (...args: unknown[]) => fetchRecentUploads(...args),
  YouTubeNotConfiguredError: class extends Error {},
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/cron/youtube-link/route';
import { YouTubeNotConfiguredError } from '@/infrastructure/youtube/channelUploads';

function request(secret?: string) {
  return new NextRequest('https://example.com/api/cron/youtube-link', {
    method: 'POST',
    headers: secret === undefined ? {} : { 'x-cron-secret': secret },
  });
}

describe('POST /api/cron/youtube-link', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'right-secret' };
    // Two tests below drive the failure paths on purpose. Their console.error
    // is the code behaving correctly, so it is captured rather than printed:
    // a suite that cries wolf on every run stops being read.
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('who may run it', () => {
    it('refuses a caller with no secret', async () => {
      expect((await POST(request())).status).toBe(401);
      expect(fetchRecentUploads).not.toHaveBeenCalled();
    });

    it('refuses a caller with the wrong secret', async () => {
      expect((await POST(request('wrong-secret'))).status).toBe(401);
    });

    it('refuses everyone when no secret is configured', async () => {
      /**
       * Fail closed. An unset CRON_SECRET must not mean "anyone may write to
       * missions"; a deployment that has not been given one simply does not
       * auto-link.
       */
      delete process.env.CRON_SECRET;

      expect((await POST(request('anything'))).status).toBe(401);
    });
  });

  describe('linking', () => {
    it('costs no Firestore read when no upload names a mission', async () => {
      fetchRecentUploads.mockResolvedValue([
        { videoId: 'v1', description: 'a holiday video' },
      ]);

      const body = await (await POST(request('right-secret'))).json();

      expect(body).toMatchObject({ success: true, linked: 0 });
      // The point of reading videos first: an ordinary poll touches nothing.
      expect(findRuns).not.toHaveBeenCalled();
    });

    it('attaches a claimed video to the run that has none', async () => {
      fetchRecentUploads.mockResolvedValue([
        { videoId: 'abc', description: 'MissionID: m1' },
      ]);
      findRuns.mockResolvedValue([
        { runId: 'r-77', yardId: 'curiosity', status: 'completed', completedAt: '2026-08-30T10:00:00Z' },
      ]);

      const body = await (await POST(request('right-secret'))).json();

      expect(body).toMatchObject({ success: true, linked: 1, missions: ['m1'] });
      // The runId names WHICH attempt the video belongs to, now that a yard
      // can run the same mission more than once.
      expect(applyBookkeeping).toHaveBeenCalledWith('m1', 'r-77', 'curiosity', expect.objectContaining({
        youtubeUrl: 'https://www.youtube.com/watch?v=abc',
        decidedBy: 'youtube-auto-link',
      }));
    });

    it('does not write again once the run already has its video', async () => {
      fetchRecentUploads.mockResolvedValue([
        { videoId: 'abc', description: 'MissionID: m1' },
      ]);
      findRuns.mockResolvedValue([
        { runId: 'r-1', yardId: 'curiosity', status: 'completed', youtubeUrl: 'https://y/abc' },
      ]);

      const body = await (await POST(request('right-secret'))).json();

      expect(body.linked).toBe(0);
      expect(applyBookkeeping).not.toHaveBeenCalled();
    });

    it('carries on when one mission fails, rather than losing the batch', async () => {
      fetchRecentUploads.mockResolvedValue([
        { videoId: 'a', description: 'MissionID: bad' },
        { videoId: 'b', description: 'MissionID: good' },
      ]);
      findRuns.mockImplementation(async (id: string) => {
        if (id === 'bad') throw new Error('Firestore said no');
        return [{ runId: 'r-2', yardId: 'curiosity', status: 'completed' }];
      });

      const body = await (await POST(request('right-secret'))).json();

      expect(body.linked).toBe(1);
      expect(body.missions).toEqual(['good']);
    });

    it('treats an unconfigured deployment as nothing to do, not an error', async () => {
      fetchRecentUploads.mockRejectedValue(new YouTubeNotConfiguredError('no key'));

      const resp = await POST(request('right-secret'));

      expect(resp.status).toBe(200);
      expect(await resp.json()).toMatchObject({ skipped: 'not-configured' });
    });

    it('reports a YouTube outage as a bad gateway', async () => {
      fetchRecentUploads.mockRejectedValue(new Error('HTTP 503'));

      expect((await POST(request('right-secret'))).status).toBe(502);
    });
  });
});

describe('the admin-set interval', () => {
  const { isDue } = jest.requireActual('@/infrastructure/persistence/pollState');

  it('is due when nothing has ever run', () => {
    expect(isDue(null, 15)).toBe(true);
  });

  it('is not due before the interval has passed', () => {
    const now = new Date('2026-08-31T12:00:00Z');
    const tenMinutesAgo = new Date('2026-08-31T11:50:00Z');

    expect(isDue(tenMinutesAgo, 15, now)).toBe(false);
  });

  it('is due once it has', () => {
    const now = new Date('2026-08-31T12:00:00Z');
    const twentyMinutesAgo = new Date('2026-08-31T11:40:00Z');

    expect(isDue(twentyMinutesAgo, 15, now)).toBe(true);
  });
});
