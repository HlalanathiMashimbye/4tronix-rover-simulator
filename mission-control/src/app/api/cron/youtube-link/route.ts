/**
 * POST /api/cron/youtube-link
 *
 * Attaches uploaded videos to the runs they show, on a schedule.
 *
 * This used to run on the yard satellite, and could not work there. The
 * operator downloads the video from the satellite and uploads it from their
 * own device, plausibly that evening at home; by then the Pi is off in a box.
 * The poll only ever caught up when that yard next ran an event, so a child's
 * video appeared days late or not at all. It also needed internet on the one
 * machine whose entire design goal is working without it, and put the YouTube
 * API key on a Pi sitting on a venue's wifi.
 *
 * Here it runs whether or not any yard is powered on, once for every yard
 * rather than once per yard, with the key in Secret Manager.
 */

import { NextRequest, NextResponse } from 'next/server';

import { adminMissionRepository } from '@/infrastructure/container.server';
import {
  claimedMissions,
  runToLink,
  watchUrl,
} from '@/core/domain/services/youtubeLinking';
import {
  fetchRecentUploads,
  YouTubeNotConfiguredError,
} from '@/infrastructure/youtube/channelUploads';
import { decideAttachVideo } from '@/core/domain/services/missionBookkeeping';
import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';
import { isDue, lastCheckedAt, recordChecked } from '@/infrastructure/persistence/pollState';

/**
 * Cloud Scheduler proves itself with a shared secret rather than a session.
 *
 * Compared in constant time: this endpoint writes to missions, and a timing
 * oracle on a header is a cheap thing to close.
 */
function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const provided = request.headers.get('x-cron-secret') ?? '';
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Scheduler fires every 5 minutes; the admin decides how often that does
  // anything. Checked before YouTube is touched so a throttled call costs
  // nothing at all.
  const interval = Number(await readSetting('youtubeLinkIntervalMinutes')) || 15;
  if (!isDue(await lastCheckedAt(), interval)) {
    return NextResponse.json({ success: true, skipped: 'not-due', intervalMinutes: interval });
  }

  let videos;
  try {
    videos = await fetchRecentUploads();
  } catch (error) {
    if (error instanceof YouTubeNotConfiguredError) {
      // Not an error to page anyone about: a deployment without YouTube
      // configured simply does not auto-link, and manual attach still works.
      return NextResponse.json({ success: true, skipped: 'not-configured', linked: 0 });
    }
    console.error('[youtube-link] Could not read the channel:', error);
    return NextResponse.json({ success: false, error: 'Could not reach YouTube' }, { status: 502 });
  }

  // Recorded once the channel has actually been read, so a YouTube outage
  // does not consume the interval and leave the next real check waiting.
  await recordChecked();

  const claims = claimedMissions(videos);
  if (claims.length === 0) {
    // The common case, and it costs one YouTube quota unit and no Firestore
    // reads at all. This is why the poll reads videos first and missions
    // second, rather than the other way round.
    return NextResponse.json({ success: true, checked: videos.length, linked: 0 });
  }

  const repository = adminMissionRepository();
  const linked: string[] = [];
  const skipped: Array<{ missionId: string; reason: string }> = [];

  for (const claim of claims) {
    try {
      const runs = await repository.findRuns(claim.missionId);
      // When the video named its yard, that IS the answer. runToLink is the
      // fallback for a video that only named a mission, and it guesses:
      // most-recently-completed-without-a-video attaches Cape Town's footage
      // to Durban's run whenever the two finish close together.
      const run = claim.yardId
        ? runs.find((r) => r.yardId === claim.yardId && !r.youtubeUrl) ?? null
        : runToLink(runs);
      if (!run) {
        skipped.push({ missionId: claim.missionId, reason: 'nothing to link' });
        continue;
      }

      // The same decision the operator's own attach goes through, so an
      // automatic link cannot land somewhere a manual one would be refused.
      // runToLink already established this run is completed, so runStatus is
      // the honest field to hand over; missionStatus mirrors it because a
      // roll-up cannot disagree with the only run we are considering.
      const decision = decideAttachVideo({
        runStatus: run.status,
        missionStatus: run.status,
        needsReview: run.needsReview ?? false,
      });
      if (!decision.ok) {
        skipped.push({ missionId: claim.missionId, reason: decision.error });
        continue;
      }

      await repository.applyBookkeeping(claim.missionId, run.runId, run.yardId, {
        status: decision.change.status,
        clearsReview: decision.change.clearsReview,
        youtubeUrl: watchUrl(claim.videoId),
        decidedAt: new Date().toISOString(),
        decidedBy: 'youtube-auto-link',
      });
      linked.push(claim.missionId);
    } catch (error) {
      // One bad mission must not stop the rest of the batch: the next poll
      // will try it again, and the others are already linked by then.
      console.error(`[youtube-link] Could not link ${claim.missionId}:`, error);
      skipped.push({ missionId: claim.missionId, reason: 'write failed' });
    }
  }

  return NextResponse.json({
    success: true,
    checked: videos.length,
    linked: linked.length,
    missions: linked,
    skipped,
  });
}
