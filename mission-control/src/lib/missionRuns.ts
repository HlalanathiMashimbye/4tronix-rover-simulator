import { findYardIn, type Yard } from '@/core/domain/entities/Yard';
import { watchableRuns, type MissionRun } from '@/core/domain/entities/MissionRun';
import { getYouTubeId } from '@/core/domain/services/youtubeLinking';

/**
 * The rover's runs a learner can watch for one mission, newest first.
 *
 * Lives here rather than inside the mission page because the ORDER and the
 * COUNT are decisions, not rendering details.
 *
 * THE SIMULATION IS NOT ONE OF THEM. It was, twice, and both times it was
 * David who could not find something. At the 2026-08-27 standup a child could
 * not tell that a real rover had driven their code: the run selector was a
 * closed dropdown with the simulation first. So real runs went first, in a
 * left/right gallery with the simulation as its last card. On 10 October 2026
 * he opened a mission with a video and could not find the simulation: it was
 * behind the arrows.
 *
 * Whichever of the two is behind a control is the one that gets missed. So
 * the mission page shows all of it at once, as a feed with the simulation
 * first (RunFeed), and this list is only what there can be more than one of:
 * the times a rover drove it.
 */

export interface RunOption {
  id: string;
  /** The card's headline. A place name where the yard has one. */
  label: string;
  /** The line under it, saying what this is a video of. */
  sublabel: string;
  /** Platform-hosted video. This is the primary viewing surface when present. */
  videoUrl?: string;
  youtubeId?: string;
  /** Poster frame for a real run, straight from YouTube. */
  thumbnailUrl?: string;
  /** Carried so the Duration stat can describe the run being watched. */
  startedAt?: string | null;
  completedAt?: string | null;
}

// Defined in the domain so the operator's commands can use it too; re-exported
// here for the components that already import it from this module.
export { getYouTubeId };

/**
 * YouTube's own poster frame. `mqdefault` is 320x180 - big enough for a card,
 * small enough that six of them are not a page weight problem.
 *
 * img.youtube.com is already allow-listed in next.config.ts remotePatterns.
 */
export function thumbnailFor(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
}

/** "6 Aug" - short enough for a 104px card, enough to tell two runs apart. */
function runDateLabel(completedAt: string | undefined | null): string {
  if (!completedAt) return 'Real rover';
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) return 'Real rover';
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}


/**
 * `yards` is passed in rather than imported.
 *
 * It used to read a hardcoded registry, which stopped being true the moment an
 * admin could add a venue: a mission run at a yard added this morning would
 * have shown a learner no location at all. The list comes from the server that
 * rendered the page, so this stays a pure function and adding a yard needs no
 * deploy.
 */
export function buildRunOptions(
  mission: { youtubeUrl?: string; videoUrl?: string; yardId?: string } | null | undefined,
  runs: MissionRun[] = [],
  yards: Yard[] = [],
): RunOption[] {
  if (!mission) return [];

  const options: RunOption[] = [];

  // Every yard whose attempt produced something to watch, newest first. A
  // failed run simply is not here, which is also how "a learner never sees
  // Failed" survives the move to per-yard runs.
  for (const run of watchableRuns(runs)) {
    const youtubeId = getYouTubeId(run.youtubeUrl);
    if (!youtubeId) continue;

    options.push({
      id: `run-${run.runId}`,
      // The city, because "which yard" only means something to a child as a
      // place they could point to on a map. A yard with no place name falls
      // back to the date rather than repeating the sublabel - two cards both
      // reading "Real rover / Real rover" tell you nothing about which is
      // which, and look like a bug.
      label: findYardIn(yards, run.yardId)?.city ?? runDateLabel(run.completedAt),
      sublabel: 'Real rover',
      youtubeId,
      thumbnailUrl: thumbnailFor(youtubeId),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
  }

  // Missions that predate the run model keep their video on the mission
  // document. Only used when no run supplied one, so a backfilled mission does
  // not appear twice.
  if (options.length === 0) {
    const legacyId = getYouTubeId(mission.youtubeUrl);
    const legacyVideoId = getYouTubeId(mission.videoUrl);
    const hostedVideoUrl = mission.videoUrl && !legacyVideoId ? mission.videoUrl : undefined;
    const youtubeId = legacyId ?? legacyVideoId ?? undefined;
    if (youtubeId || hostedVideoUrl) {
      options.push({
        id: 'real-legacy',
        label: findYardIn(yards, mission.yardId)?.city ?? 'Real rover',
        sublabel: 'Real rover',
        videoUrl: hostedVideoUrl,
        youtubeId,
        thumbnailUrl: youtubeId ? thumbnailFor(youtubeId) : undefined,
      });
    }
  }

  return options;
}
