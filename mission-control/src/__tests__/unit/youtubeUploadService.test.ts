import { buildAutomaticUploadDescription, buildAutomaticUploadTitle, isAutoUploadConfigured, maybeUploadRecording } from '@/infrastructure/youtube/youtubeUpload';
import { readSetting, writeSetting } from '@/infrastructure/config/runtimeSettingsStore';

jest.mock('@/infrastructure/config/runtimeSettingsStore', () => ({
  readSetting: jest.fn(),
  writeSetting: jest.fn(),
}));

const mockedReadSetting = readSetting as jest.MockedFunction<typeof readSetting>;
const mockedWriteSetting = writeSetting as jest.MockedFunction<typeof writeSetting>;

describe('automated YouTube uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    delete process.env.YOUTUBE_REFRESH_TOKEN;
  });

  it('builds a recording title that preserves the manual filename convention', () => {
    expect(buildAutomaticUploadTitle('mission-42', 'curiosity', '20260912T013122Z')).toBe(
      'mission-42__curiosity__20260912T013122Z',
    );
  });

  it('builds a description that keeps the manual workflow discoverable', () => {
    expect(buildAutomaticUploadDescription('mission-42', 'curiosity')).toContain('MissionID: mission-42');
    expect(buildAutomaticUploadDescription('mission-42', 'curiosity')).toContain('Yard: curiosity');
  });

  it('treats the feature as disabled when OAuth is not configured', async () => {
    mockedReadSetting.mockImplementation(async (name: string) => {
      if (name === 'youtubeClientId') return null;
      if (name === 'youtubeClientSecret') return null;
      if (name === 'youtubeRefreshToken') return null;
      if (name === 'youtubeUploadPrivacy') return null;
      return null;
    });

    await expect(isAutoUploadConfigured()).resolves.toBe(false);
    await expect(maybeUploadRecording({ missionId: 'm1', runId: 'r1', yardId: 'curiosity', file: 'not-a-real-file' })).resolves.toEqual({ status: 'not-configured' });
  });

  it('exchanges a refresh token and uploads bytes without exposing credentials', async () => {
    mockedReadSetting.mockImplementation(async (name: string) => ({
      youtubeClientId: 'client-id',
      youtubeClientSecret: 'client-secret',
      youtubeRefreshToken: 'refresh-token',
      youtubeUploadPrivacy: 'private',
      youtubeMadeForKids: 'true',
    })[name] ?? null);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'short-lived-access-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video-123' }) });

    await expect(maybeUploadRecording({
      missionId: 'mission-1',
      runId: 'dispatch-1',
      yardId: 'curiosity',
      title: 'mission-1__curiosity__20261011T102030Z',
      file: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({
      status: 'uploaded',
      videoId: 'video-123',
      url: 'https://www.youtube.com/watch?v=video-123',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
    }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/upload/youtube/v3/videos'), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer short-lived-access-token' }),
    }));
  });

  it('returns a bounded, non-sensitive failure on YouTube upload errors', async () => {
    mockedReadSetting.mockImplementation(async (name: string) => ({
      youtubeClientId: 'client-id',
      youtubeClientSecret: 'client-secret',
      youtubeRefreshToken: 'refresh-token',
      youtubeUploadPrivacy: 'private',
      youtubeMadeForKids: 'true',
    })[name] ?? null);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-token' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'contains private provider response' });

    await expect(maybeUploadRecording({
      missionId: 'mission-1',
      runId: 'dispatch-1',
      yardId: 'curiosity',
      file: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({
      status: 'failed',
      error: 'YouTube upload failed with HTTP 403.',
    });
  });

  it('stores a rotated refresh token in Secret Manager', async () => {
    mockedReadSetting.mockImplementation(async (name: string) => ({
      youtubeClientId: 'client-id',
      youtubeClientSecret: 'client-secret',
      youtubeRefreshToken: 'previous-refresh-token',
      youtubeUploadPrivacy: 'private',
      youtubeMadeForKids: 'true',
    })[name] ?? null);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-token', refresh_token: 'rotated-refresh-token' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video-456' }) });

    await expect(maybeUploadRecording({
      missionId: 'mission-1',
      runId: 'dispatch-1',
      yardId: 'curiosity',
      file: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({ status: 'uploaded', videoId: 'video-456' });
    expect(mockedWriteSetting).toHaveBeenCalledWith('youtubeRefreshToken', 'rotated-refresh-token');
  });

  it('reports environment-managed token rotation without disclosing the replacement', async () => {
    process.env.YOUTUBE_REFRESH_TOKEN = 'previous-refresh-token';
    mockedReadSetting.mockImplementation(async (name: string) => ({
      youtubeClientId: 'client-id',
      youtubeClientSecret: 'client-secret',
      youtubeRefreshToken: 'previous-refresh-token',
      youtubeUploadPrivacy: 'private',
      youtubeMadeForKids: 'true',
    })[name] ?? null);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'access-token', refresh_token: 'rotated-private-token' }),
    });

    await expect(maybeUploadRecording({
      missionId: 'mission-1',
      runId: 'dispatch-1',
      yardId: 'curiosity',
      file: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({
      status: 'failed',
      error: 'YOUTUBE_REFRESH_TOKEN environment override must be removed after Google rotates the token.',
    });
    expect(mockedWriteSetting).toHaveBeenCalledWith('youtubeRefreshToken', 'rotated-private-token');
  });
});
