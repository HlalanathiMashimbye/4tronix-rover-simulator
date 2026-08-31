import type { MissionRun } from '@/core/domain/entities/MissionRun';

/**
 * Matching an uploaded video back to the mission it shows.
 *
 * An operator uploads a run's video to YouTube with `MissionID: <id>` in the
 * description; the yard's run station generates that line so it cannot be
 * mistyped. This is the half that reads it.
 *
 * DIRECTION MATTERS. The satellite's poller asked "which of my missions have
 * no video?" and then fetched YouTube, because a yard only knows its own
 * missions and has a local mirror to ask cheaply. Mission Control has neither
 * that mirror nor that limit, and asking the same question here means reading
 * every recent mission out of Firestore on every pass. The satellite already
 * learned what that costs: the version that streamed completed missions per
 * poll ran ~21,000 reads/day, about 80% of that yard's entire Firestore bill.
 *
 * So this goes the other way. Fetch the channel's recent uploads first, which
 * is one YouTube API call and no Firestore reads at all, and let the videos
 * name the missions. A poll that finds nothing new costs a single quota unit,
 * and a mission is read only when a video actually claims it.
 */

/** The exact shape the yard's run station writes, matched literally. */
const MISSION_ID_PATTERN = /MissionID:\s*([A-Za-z0-9_-]+)/;

export interface ChannelVideo {
  videoId: string;
  description: string;
}

export function missionIdFromDescription(description: string): string | null {
  const match = MISSION_ID_PATTERN.exec(description || '');
  return match ? match[1] : null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * The missions the channel's recent uploads claim, newest upload first.
 *
 * De-duplicated: if somebody re-uploads a run, the newer video wins, because
 * that is almost always why they did it.
 */
export function claimedMissions(videos: ChannelVideo[]): Array<{ missionId: string; videoId: string }> {
  const seen = new Set<string>();
  const claims: Array<{ missionId: string; videoId: string }> = [];

  for (const video of videos) {
    const missionId = missionIdFromDescription(video.description);
    if (!missionId || seen.has(missionId)) continue;
    seen.add(missionId);
    claims.push({ missionId, videoId: video.videoId });
  }

  return claims;
}

/**
 * Which run a found video belongs to, or null to leave the mission alone.
 *
 * A video names a mission, never a yard, so a mission run in two places is
 * ambiguous. Resolved by taking the most recently completed run that has no
 * video yet: the operator is uploading what they just filmed, and the run they
 * just filmed is the one that finished last.
 *
 * Returns null when every completed run already has a video, which is the
 * ordinary case on every poll after the first that saw this upload. Attaching
 * again would be a write that changes nothing and an email that says something
 * already said.
 */
export function runToLink(runs: MissionRun[]): MissionRun | null {
  const candidates = runs
    .filter((run) => run.status === 'completed' && !run.youtubeUrl)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  return candidates[0] ?? null;
}
