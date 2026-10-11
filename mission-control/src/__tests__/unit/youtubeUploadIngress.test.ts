import { NextRequest } from 'next/server';

import { isAutoUploadConfigured } from '@/infrastructure/youtube/youtubeUpload';
import { runAutomaticUpload } from '@/infrastructure/youtube/youtubeUploadLedger';
import { POST } from '@/app/api/youtube-upload/recording/route';

jest.mock('@/infrastructure/youtube/youtubeUpload', () => ({
  isAutoUploadConfigured: jest.fn(),
}));
jest.mock('@/infrastructure/youtube/youtubeUploadLedger', () => ({
  recordAutomaticUploadFailure: jest.fn(),
  runAutomaticUpload: jest.fn(),
}));

const configuredMock = isAutoUploadConfigured as jest.MockedFunction<typeof isAutoUploadConfigured>;
const uploadMock = runAutomaticUpload as jest.MockedFunction<typeof runAutomaticUpload>;

describe('satellite automatic-upload ingress', () => {
  const originalSecret = process.env.YOUTUBE_UPLOAD_INGEST_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.YOUTUBE_UPLOAD_INGEST_SECRET = 'test-ingest-secret';
    configuredMock.mockResolvedValue(true);
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.YOUTUBE_UPLOAD_INGEST_SECRET;
    else process.env.YOUTUBE_UPLOAD_INGEST_SECRET = originalSecret;
  });

  it('rejects requests without the satellite shared secret', async () => {
    const request = new NextRequest('https://marsyard.sapient.rocks/api/youtube-upload/recording', {
      method: 'POST',
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('preserves the mission and rover dispatch association and returns upload failures', async () => {
    uploadMock.mockResolvedValue({
      kind: 'failed',
      attempts: 1,
      errorMessage: 'YouTube upload failed with HTTP 503.',
    });
    const form = new FormData();
    form.set('missionId', 'mission-1');
    form.set('runId', 'dispatch-1');
    form.set('yardId', 'curiosity');
    form.set('recordingName', 'mission-1__curiosity__20261011T102030Z.mp4');
    form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), 'recording.mp4');
    const request = new NextRequest('https://marsyard.sapient.rocks/api/youtube-upload/recording', {
      method: 'POST',
      headers: { 'x-youtube-upload-secret': 'test-ingest-secret' },
      body: form,
    });

    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      success: false,
      status: 'failed',
      errorMessage: 'YouTube upload failed with HTTP 503.',
    });
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      missionId: 'mission-1',
      dispatchId: 'dispatch-1',
      yardId: 'curiosity',
      recordingName: 'mission-1__curiosity__20261011T102030Z.mp4',
      file: new Uint8Array([1, 2, 3]),
    }));
  });

  it('keeps automatic upload disabled when OAuth settings are missing', async () => {
    configuredMock.mockResolvedValue(false);
    const request = new NextRequest('https://marsyard.sapient.rocks/api/youtube-upload/recording', {
      method: 'POST',
      headers: { 'x-youtube-upload-secret': 'test-ingest-secret' },
    });

    const response = await POST(request);
    expect(await response.json()).toMatchObject({ success: true, status: 'not-configured' });
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
