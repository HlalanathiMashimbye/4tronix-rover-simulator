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
const link = jest.fn();
const findById = jest.fn();
jest.mock('@/infrastructure/container.server', () => ({
  videoLinker: () => ({ link }),
  adminMissionRepository: () => ({ findById }),
}));

const configuredMock = isAutoUploadConfigured as jest.MockedFunction<typeof isAutoUploadConfigured>;
const uploadMock = runAutomaticUpload as jest.MockedFunction<typeof runAutomaticUpload>;

function delivery(fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set('missionId', 'mission-1');
  form.set('runId', 'dispatch-1');
  form.set('yardId', 'curiosity');
  form.set('recordingName', 'mission-1__curiosity__20261011T102030Z.mp4');
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), 'recording.mp4');
  return new NextRequest('https://marsyard.sapient.rocks/api/youtube-upload/recording', {
    method: 'POST',
    headers: { 'x-youtube-upload-secret': 'test-ingest-secret' },
    body: form,
  });
}

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

  describe('the video, onto its run', () => {
    /**
     * The scheduled linker reads the channel with an API key, which cannot
     * see a private video, and automatic uploads are private by default. So
     * the upload's video id sat in the ledger and never reached the run.
     */
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      link.mockResolvedValue({ kind: 'linked', runId: 'run-1', completed: true, emailFailed: false });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('attaches a fresh upload through the linker the scheduled poll uses', async () => {
      uploadMock.mockResolvedValue({
        kind: 'uploaded', attempts: 1, videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk',
      });

      const response = await POST(delivery({ outcome: 'completed' }));

      expect(response.status).toBe(200);
      expect(link).toHaveBeenCalledWith(
        { missionId: 'mission-1', yardId: 'curiosity', videoId: 'abcdefghijk' },
        'youtube-auto-upload',
      );
      expect(await response.json()).toMatchObject({ status: 'uploaded', linked: { kind: 'linked' } });
    });

    it('attaches a video an earlier delivery already uploaded', async () => {
      // How a delivery whose link failed gets put right: the satellite asks
      // again, the ledger does not upload twice, and the link is tried again.
      uploadMock.mockResolvedValue({
        kind: 'uploaded',
        entry: {
          missionId: 'mission-1', dispatchId: 'dispatch-1', yardId: 'curiosity',
          recordingName: 'mission-1__curiosity__20261011T102030Z.mp4',
          status: 'uploaded', attempts: 1, videoId: 'zyxwvutsrqp', updatedAt: '2026-10-11T10:30:00Z',
        },
      });

      await POST(delivery());

      expect(link).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'zyxwvutsrqp' }), 'youtube-auto-upload');
    });

    it('leaves a run the rover reported as an error for the operator', async () => {
      /**
       * Attaching closes an open run and emails the learner it is complete.
       * Whether a run the rover could not execute counts is not ours to say.
       */
      uploadMock.mockResolvedValue({
        kind: 'uploaded', attempts: 1, videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk',
      });

      const response = await POST(delivery({ outcome: 'error' }));

      expect(link).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({ status: 'uploaded', linked: { kind: 'skipped' } });
    });

    it('asks the satellite to deliver again when the run could not be written', async () => {
      uploadMock.mockResolvedValue({
        kind: 'uploaded', attempts: 1, videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk',
      });
      link.mockRejectedValue(new Error('firestore unavailable'));

      const response = await POST(delivery());

      // The satellite retries a 5xx; anything below it settles the delivery.
      expect(response.status).toBe(503);
    });

    it('does not link an upload that failed', async () => {
      uploadMock.mockResolvedValue({ kind: 'failed', attempts: 1, errorMessage: 'YouTube upload failed with HTTP 503.' });

      await POST(delivery());

      expect(link).not.toHaveBeenCalled();
    });

    it('refuses an outcome it does not know rather than guessing', async () => {
      const response = await POST(delivery({ outcome: 'probably-fine' }));

      expect(response.status).toBe(400);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  describe('the title', () => {
    beforeEach(() => {
      uploadMock.mockResolvedValue({ kind: 'failed', attempts: 1, errorMessage: 'no' });
    });

    it("is the mission's name, not the recording's file name", async () => {
      findById.mockResolvedValue({ id: 'mission-1', name: 'Cheerful Pebble Ranger' });

      await POST(delivery());

      expect(findById).toHaveBeenCalledWith('mission-1');
      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Cheerful Pebble Ranger · Mars Yard rover run',
      }));
    });

    it('still uploads, under the stand-in, when the mission cannot be read', async () => {
      findById.mockRejectedValue(new Error('Firestore unavailable'));

      await POST(delivery());

      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Rover mission · Mars Yard rover run',
      }));
    });
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
