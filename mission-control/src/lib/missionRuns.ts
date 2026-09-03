import { yardPlace } from '@/infrastructure/config/yards';
import { watchableRuns, type MissionRun } from '@/core/domain/entities/MissionRun';

/**
 * The runs a learner can watch for one mission, in the order they see them.
 *
 * Lives here rather than inside the mission page because the ORDER and the
 * COUNT are decisions, not rendering details.
 *
 * David raised it at the 2026-08-27 standup: a child could not tell that a
 * real rover had driven their code, because the run selector was a closed
 * dropdown with the simulation first. The single most exciting thing this
 * platform does was behind a control that looked empty.
 *
 * So real runs come first and the page opens on one. A child who already
 * watched the simulation while writing the code should not have to go looking
 * for the rover.
 */

export type RunKind = 'sim' | 'real';

export interface RunOption {
  id: string;
  /** The card's headline. A place name for a real run. */
  label: string;
  /** The line under it, saying what kind of run this is. */
  sublabel: string;
  kind: RunKind;
  /** Platform-hosted video. This is the primary viewing surface when present. */
  videoUrl?: string;
  youtubeId?: string;
  /** Poster frame for a real run, straight from YouTube. */
  thumbnailUrl?: string;
  /** Carried so the Duration stat can describe the run being watched. */
  startedAt?: string | null;
  completedAt?: string | null;
}

/** The YouTube id in a watch/share/embed URL, or null if there isn't one. */
export function getYouTubeId(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

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


const SIM_OPTION: RunOption = {
  id: 'sim',
  label: 'Simulation',
  sublabel: 'On screen',
  kind: 'sim',
};

export function buildRunOptions(
  mission: { youtubeUrl?: string; videoUrl?: string; yardId?: string } | null | undefined,
  runs: MissionRun[] = [],
): RunOption[] {
  if (!mission) return [SIM_OPTION];

  const options: RunOption[] = [];

  // Every yard whose attempt produced something to watch, newest first. A
  // failed run simply is not here, which is also how "a learner never sees
  // Failed" survives the move to per-yard runs.
  for (const run of watchableRuns(runs)) {
    const youtubeId = getYouTubeId(run.youtubeUrl);
    if (!youtubeId) continue;

    options.push({
      id: `run-${run.yardId}`,
      // The city, because "which yard" only means something to a child as a
      // place they could point to on a map. A yard with no place name falls
      // back to the date rather than repeating the sublabel - two cards both
      // reading "Real rover / Real rover" tell you nothing about which is
      // which, and look like a bug.
      label: yardPlace(run.yardId) ?? runDateLabel(run.completedAt),
      sublabel: 'Real rover',
      kind: 'real',
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
        label: yardPlace(mission.yardId) ?? 'Real rover',
        sublabel: 'Real rover',
        kind: 'real',
        videoUrl: hostedVideoUrl,
        youtubeId,
        thumbnailUrl: youtubeId ? thumbnailFor(youtubeId) : undefined,
      });
    }
  }

  options.push(SIM_OPTION);
  return options;
}

/** "2 rover runs · simulation" - the scale of the strip, before scrolling it. */
export function describeRuns(options: RunOption[]): string {
  const real = options.filter((o) => o.kind === 'real').length;
  if (real === 0) return 'Simulation only';
  return `${real} rover ${real === 1 ? 'run' : 'runs'} · simulation`;
}
