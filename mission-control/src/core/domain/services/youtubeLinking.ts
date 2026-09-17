import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type { MissionStatus } from '@/core/domain/entities/Mission';

/**
 * Matching an uploaded video back to the mission it shows.
 *
 * There are two ways a video says which mission it shows, and this reads
 * both. The run station generates a `MissionID: <id>` line to paste into the
 * description, and the satellite already names the file
 * `<missionId>__<yardId>__<stamp>.mp4`, which YouTube turns into the title
 * when it is uploaded unrenamed. The second costs the operator nothing at
 * all, which makes it the one that will actually happen at the end of a long
 * event day.
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

/** The explicit marker, matched literally wherever it appears. */
const MISSION_ID_PATTERN = /MissionID:\s*([A-Za-z0-9_-]+)/;

/**
 * The satellite's own filename, which YouTube turns into the title for free.
 *
 * Recordings are written as `<missionId>__<yardId>__<stamp>.mp4`, and YouTube
 * Studio prefills a video's title from the filename it was uploaded with. So
 * an operator who uploads the file exactly as they downloaded it has already
 * labelled it, without typing anything or knowing that they did. The stamp
 * (`recording_control.start_recording`'s UTC `%Y%m%dT%H%M%SZ`) is matched
 * literally rather than as a generic third segment, so a title that merely
 * happens to have two underscores in it still does not qualify.
 *
 * The `__<yardId>` tail is what makes this safe to match on. A bare id in a
 * title would claim half the channel; this shape does not occur by accident.
 * And a false positive costs one Firestore read that finds no mission, so the
 * failure mode is a wasted lookup rather than a video attached to the wrong
 * child's work.
 */
const RECORDING_FILENAME_PATTERN = /^([A-Za-z0-9-]+)__([A-Za-z0-9-]+)(?:__\d{8}T\d{6}Z)?$/;

/** The yard, when the uploader said it explicitly rather than in a filename. */
const YARD_PATTERN = /Yard:\s*([A-Za-z0-9-]+)/;

export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
}

/**
 * The mission a video claims, from anything it carries.
 *
 * Checked in both places because they cost the same. `part=snippet` returns
 * the title and the description in one response, so reading both is free, and
 * it means the loop closes whether the operator pasted our description block
 * or simply did not rename the file.
 */
export interface VideoClaim {
  missionId: string;
  /**
   * The yard, when the video says which one.
   *
   * WORTH CAPTURING RATHER THAN GUESSING. A mission can be run at more than
   * one yard, and picking the most recently completed run without a video is
   * a heuristic: it attaches Cape Town's footage to Durban's run whenever the
   * two finish close together. The filename carries the yard already
   * (`<missionId>__<yardId>.mp4`), so throwing it away and then guessing was
   * losing information we were handed.
   *
   * Null when the uploader wrote only a mission id, which is what the
   * heuristic is still there for.
   */
  yardId: string | null;
}

export function missionFromVideo(
  video: Pick<ChannelVideo, 'title' | 'description'>,
): VideoClaim | null {
  const haystack = `${video.description || ''}\n${video.title || ''}`;

  const marked = MISSION_ID_PATTERN.exec(haystack);
  if (marked) {
    const yard = YARD_PATTERN.exec(haystack);
    return { missionId: marked[1], yardId: yard ? yard[1] : null };
  }

  const named = RECORDING_FILENAME_PATTERN.exec((video.title || '').trim());
  return named ? { missionId: named[1], yardId: named[2] } : null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * The YouTube id in a watch/share/embed URL, or null if there isn't one.
 *
 * The inverse of watchUrl, and here rather than in lib/missionRuns because an
 * operator's attach-video command validates links with it, and that command is
 * an application service: core may not import lib. lib/missionRuns re-exports
 * it, so the learner's player and the operator still read links the same way.
 */
export function getYouTubeId(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

/**
 * The missions the channel's recent uploads claim, newest upload first.
 *
 * De-duplicated per mission AND yard: if somebody re-uploads a run the newer
 * video wins, because that is almost always why they did it, but two yards'
 * videos of the same mission are two different runs and both survive.
 */
export function claimedMissions(videos: ChannelVideo[]): Array<VideoClaim & { videoId: string }> {
  const seen = new Set<string>();
  const claims: Array<VideoClaim & { videoId: string }> = [];

  for (const video of videos) {
    const claim = missionFromVideo(video);
    if (!claim) continue;

    // Keyed by mission AND yard, not mission alone. Two yards running the
    // same mission produce two videos, and deduping on the mission would drop
    // whichever was uploaded second - the same collision that made capturing
    // the yard worth doing in the first place. A claim naming no yard keys on
    // the mission by itself, so a genuine re-upload still collapses.
    const key = `${claim.missionId}::${claim.yardId ?? '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ ...claim, videoId: video.videoId });
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

/**
 * What to do with a video that claims a mission.
 *
 * A VIDEO OF A RUN IS EVIDENCE THE RUN HAPPENED. The linker used to attach only
 * to runs already marked complete, so a mission whose completion was never
 * recorded - the operator forgot, or their console was closed when the rover
 * reported - sat open with its video found and ignored. Now the video closes it.
 *
 * - `link` with `runId: null` means there is no run to attach to yet and the
 *   write creates one, exactly as an operator's own completion does for a yard
 *   that never logged a run.
 * - `needs-mission` asks the caller to read the mission and plan again. Only
 *   the no-run case needs it, so an ordinary poll costs no extra read.
 *
 * Cancelled and failed runs are left alone: a video does not overrule a person
 * who decided that attempt did not count.
 *
 * `mission` is `undefined` when it has not been read and `null` when it was
 * read and does not exist (or is deleted).
 */
export type VideoLinkPlan =
  | { kind: 'link'; runId: string | null; yardId: string; completes: boolean }
  | { kind: 'needs-mission' }
  | { kind: 'skip'; reason: string };

const OPEN: readonly MissionStatus[] = ['queued', 'processing'];

export function planVideoLink(
  claim: VideoClaim,
  runs: MissionRun[],
  mission: { status: MissionStatus; yardId: string } | null | undefined,
): VideoLinkPlan {
  const candidates = claim.yardId ? runs.filter((r) => r.yardId === claim.yardId) : runs;
  const withoutVideo = candidates.filter((r) => !r.youtubeUrl);

  const finished = runToLink(withoutVideo);
  if (finished) {
    return { kind: 'link', runId: finished.runId, yardId: finished.yardId, completes: false };
  }

  const open = withoutVideo
    .filter((r) => OPEN.includes(r.status))
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
  if (open) {
    if (mission === undefined) return { kind: 'needs-mission' };
    if (mission === null) return { kind: 'skip', reason: 'mission not found' };
    return { kind: 'link', runId: open.runId, yardId: open.yardId, completes: true };
  }

  if (candidates.length > 0) return { kind: 'skip', reason: 'nothing to link' };

  if (mission === undefined) return { kind: 'needs-mission' };
  if (mission === null) return { kind: 'skip', reason: 'mission not found' };
  if (!OPEN.includes(mission.status)) return { kind: 'skip', reason: `mission is ${mission.status}` };
  return { kind: 'link', runId: null, yardId: claim.yardId ?? mission.yardId, completes: true };
}
