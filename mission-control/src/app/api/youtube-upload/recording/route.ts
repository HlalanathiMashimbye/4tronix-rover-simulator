import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isAutoUploadConfigured } from '@/infrastructure/youtube/youtubeUpload';
import {
  recordAutomaticUploadFailure,
  runAutomaticUpload,
} from '@/infrastructure/youtube/youtubeUploadLedger';

export const runtime = 'nodejs';

const MAX_RECORDING_BYTES = 30 * 1024 * 1024;
const metadataSchema = z.object({
  missionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  yardId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  recordingName: z.string().regex(/^[A-Za-z0-9_.-]{1,180}\.mp4$/i),
});

function validIngestSecret(supplied: string | null): boolean {
  const expected = process.env.YOUTUBE_UPLOAD_INGEST_SECRET?.trim();
  if (!expected || !supplied) return false;
  const expectedDigest = createHmac('sha256', 'youtube-upload-ingest').update(expected).digest();
  const suppliedDigest = createHmac('sha256', 'youtube-upload-ingest').update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export async function POST(request: NextRequest) {
  if (!validIngestSecret(request.headers.get('x-youtube-upload-secret'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.YOUTUBE_UPLOAD_INGEST_SECRET?.trim() || !(await isAutoUploadConfigured())) {
    return NextResponse.json({ success: true, status: 'not-configured' });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Send recording metadata and an MP4 file.' }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse({
    missionId: form.get('missionId'),
    runId: form.get('runId'),
    yardId: form.get('yardId'),
    recordingName: form.get('recordingName'),
  });
  const file = form.get('file');
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: 'Send valid recording metadata.',
    }, { status: 400 });
  }

  try {
    if (form.get('failureCode') === 'too-large') {
      await recordAutomaticUploadFailure(
        parsed.data.missionId,
        parsed.data.runId,
        parsed.data.yardId,
        parsed.data.recordingName,
        `Recording exceeds the ${MAX_RECORDING_BYTES / 1024 / 1024} MiB automatic-upload limit; use manual upload.`,
      );
      return NextResponse.json({ success: true, status: 'failed', retryable: false });
    }
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_RECORDING_BYTES) {
      return NextResponse.json({
        success: false,
        error: `Send a non-empty MP4 smaller than ${MAX_RECORDING_BYTES / 1024 / 1024} MiB.`,
      }, { status: 400 });
    }

    const result = await runAutomaticUpload({
      missionId: parsed.data.missionId,
      dispatchId: parsed.data.runId,
      yardId: parsed.data.yardId,
      recordingName: parsed.data.recordingName,
      file: new Uint8Array(await file.arrayBuffer()),
    });
    if (result.kind === 'failed') {
      return NextResponse.json({ success: false, status: 'failed', ...result }, { status: 502 });
    }
    if (result.kind === 'claimed') {
      return NextResponse.json({ success: true, status: 'uploaded', ...result });
    }
    return NextResponse.json({ success: true, status: result.kind, ...result });
  } catch {
    console.error('[youtube-upload] Could not claim or record the upload attempt.');
    return NextResponse.json({ success: false, error: 'Could not record the upload attempt.' }, { status: 503 });
  }
}
