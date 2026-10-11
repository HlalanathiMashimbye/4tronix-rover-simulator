import { runAutomaticUpload } from '@/infrastructure/youtube/youtubeUploadLedger';

const request = {
  missionId: 'mission-1',
  dispatchId: 'dispatch-1',
  yardId: 'curiosity',
  recordingName: 'mission-1__curiosity__20261011T102030Z.mp4',
  file: new Uint8Array([1, 2, 3]),
};

describe('automatic YouTube upload ledger workflow', () => {
  it('preserves the mission, rover dispatch and recording association', async () => {
    const claim = jest.fn().mockResolvedValue({ kind: 'claimed', attemptId: 'claim-1', attempts: 1 });
    const finish = jest.fn().mockResolvedValue(undefined);
    const upload = jest.fn().mockResolvedValue({
      status: 'uploaded',
      videoId: 'video-1',
      url: 'https://www.youtube.com/watch?v=video-1',
    });

    await expect(runAutomaticUpload(request, { claim, finish, upload })).resolves.toEqual({
      kind: 'uploaded',
      attempts: 1,
      videoId: 'video-1',
      url: 'https://www.youtube.com/watch?v=video-1',
    });
    expect(claim).toHaveBeenCalledWith('mission-1', 'dispatch-1', 'curiosity', request.recordingName);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      missionId: 'mission-1',
      runId: 'dispatch-1',
      yardId: 'curiosity',
      title: 'mission-1__curiosity__20261011T102030Z',
      file: request.file,
    }));
    expect(finish).toHaveBeenCalledWith('mission-1', 'dispatch-1', 'claim-1', expect.objectContaining({
      status: 'uploaded',
      videoId: 'video-1',
    }));
  });

  it('does not upload a repeated or concurrent trigger already claimed by another request', async () => {
    let reserved = false;
    const claim = jest.fn(async () => {
      if (reserved) return { kind: 'in-progress' as const, entry: {} as never };
      reserved = true;
      return { kind: 'claimed' as const, attemptId: 'claim-1', attempts: 1 };
    });
    const finish = jest.fn().mockResolvedValue(undefined);
    const upload = jest.fn().mockResolvedValue({
      status: 'uploaded',
      videoId: 'video-1',
      url: 'https://www.youtube.com/watch?v=video-1',
    });

    const results = await Promise.all([
      runAutomaticUpload(request, { claim, finish, upload }),
      runAutomaticUpload(request, { claim, finish, upload }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['in-progress', 'uploaded']);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('records failed uploads without throwing or modifying manual video metadata', async () => {
    const claim = jest.fn().mockResolvedValue({ kind: 'claimed', attemptId: 'claim-1', attempts: 2 });
    const finish = jest.fn().mockResolvedValue(undefined);
    const upload = jest.fn().mockResolvedValue({ status: 'failed', error: 'YouTube upload failed with HTTP 503.' });

    await expect(runAutomaticUpload(request, { claim, finish, upload })).resolves.toMatchObject({
      kind: 'failed',
      attempts: 2,
    });
    expect(finish).toHaveBeenCalledWith('mission-1', 'dispatch-1', 'claim-1', {
      status: 'failed',
      errorMessage: 'YouTube upload failed with HTTP 503.',
    });
    expect(finish.mock.calls[0][3]).not.toHaveProperty('youtubeUrl');
  });

  it('does not upload after the attempt limit or while another attempt is active', async () => {
    const claim = jest.fn().mockResolvedValue({ kind: 'max-attempts', entry: {} as never });
    const upload = jest.fn();

    await expect(runAutomaticUpload(request, {
      claim,
      finish: jest.fn(),
      upload,
    })).resolves.toMatchObject({ kind: 'max-attempts' });
    expect(upload).not.toHaveBeenCalled();
  });
});
