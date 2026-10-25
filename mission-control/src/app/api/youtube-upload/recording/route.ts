import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { VideoLinkResult } from '@/core/application/services/VideoLinker';
import { missionVideoTitle } from '@/core/domain/services/youtubeLinking';
import { adminMissionRepository, videoLinker } from '@/infrastructure/container.server';
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
  // What the rover reported for the run. Absent from a satellite older than
  // this field, which is read as completed, the linker's own assumption.
  outcome: z.enum(['completed', 'error']).optional(),
});

/**
 * The uploaded video, onto the run it shows.
 *
 * Through the same linker the scheduled poll uses, because that poll reads
 * the channel with an API key and never sees a private upload. Not for a run
 * the rover reported as an error: attaching closes an open run and emails the
 * learner that it is complete, and whether an errored run counts is the
 * operator's call. They still have the video, in the upload's row on the
 * mission.
 */
async function linkUpload(
  upload: { missionId: string; runId: string; yardId: string; outcome?: 'completed' | 'error' },
  videoId: string,
): Promise<VideoLinkResult> {
  if (upload.outcome === 'error') {
    return { kind: 'skipped', reason: 'the rover reported an error; left for the operator' };
  }
  // With the dispatch it filmed, so a re-run of a mission whose first run
  // already has its video gets a run of its own instead of being dropped.
  return videoLinker().link(
    { missionId: upload.missionId, yardId: upload.yardId, videoId, dispatchId: upload.runId },
    'youtube-auto-upload',
  );
}

function validIngestSecret(supplied: string | null): boolean {
  const expected = process.env.YOUTUBE_UPLOAD_INGEST_SECRET?.trim();
  if (!expected || !supplied) return false;
  const expectedDigest = createHmac('sha256', 'youtube-upload-ingest').update(expected).digest();
  const suppliedDigest = createHmac('sha256', 'youtube-upload-ingest').update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

/**
 * The video's title, from its mission's name.
 *
 * Read here rather than sent by the satellite: Mission Control owns the name,
 * and a satellite from before this change would have nothing to send. A
 * mission that cannot be read still uploads, under the stand-in, because
 * nothing finds a video by its title: the description names the mission.
 */
async function titleFor(missionId: string): Promise<string> {
  try {
    return missionVideoTitle((await adminMissionRepository().findById(missionId))?.name);
  } catch {
    return missionVideoTitle(null);
  }
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
    outcome: form.get('outcome') ?? undefined,
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
      title: await titleFor(parsed.data.missionId),
      file: new Uint8Array(await file.arrayBuffer()),
    });
    if (result.kind === 'failed') {
      return NextResponse.json({ success: false, status: 'failed', ...result }, { status: 502 });
    }
    if (result.kind === 'claimed') {
      return NextResponse.json({ success: true, status: 'uploaded', ...result });
    }

    // A fresh upload carries its video id; one already uploaded by an earlier
    // delivery carries it in its ledger entry. Both are linked, so a delivery
    // whose link failed is put right by the satellite asking again.
    const videoId = 'videoId' in result ? result.videoId : 'entry' in result ? result.entry.videoId : undefined;
    let linked: VideoLinkResult | undefined;
    if (result.kind === 'uploaded' && videoId) {
      try {
        linked = await linkUpload(parsed.data, videoId);
      } catch {
        // The upload stands, and the ledger will not repeat it. A 503 makes
        // the satellite deliver again, which finds it uploaded and links it.
        console.error(`[youtube-upload] Uploaded ${parsed.data.missionId} but could not attach it to its run.`);
        return NextResponse.json({ success: false, status: 'uploaded', linked: null }, { status: 503 });
      }
      if (linked.kind === 'linked' && linked.emailFailed) {
        console.error(`[youtube-upload] Could not email the learner for ${parsed.data.missionId}.`);
      }
    }
    return NextResponse.json({ success: true, status: result.kind, ...result, linked });
  } catch {
    console.error('[youtube-upload] Could not claim or record the upload attempt.');
    return NextResponse.json({ success: false, error: 'Could not record the upload attempt.' }, { status: 503 });
  }
}
