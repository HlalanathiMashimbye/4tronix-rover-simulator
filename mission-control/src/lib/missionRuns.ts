import { yardPlace } from '@/infrastructure/config/yards';

/**
 * The runs a learner can watch for one mission, in the order they see them.
 *
 * Lives here rather than inside the mission page because the ORDER is a
 * decision, not a rendering detail, and a decision worth a test.
 *
 * David raised it at the 2026-08-27 standup: a child could not tell that a
 * real rover had driven their code, because the run selector was a closed
 * dropdown and the simulation was the first entry. The single most exciting
 * thing this platform does was behind a control that looked empty.
 *
 * So the real run comes first and is what the page opens on. A child who has
 * already watched the simulation while writing the code should not have to
 * find the rover.
 */

export type RunKind = 'sim' | 'real';

export interface RunOption {
  id: string;
  /** The chip's headline. A place name for a real run. */
  label: string;
  /** The line under it, saying what kind of run this is. */
  sublabel: string;
  kind: RunKind;
  youtubeId?: string;
}

/** The YouTube id in a watch/share/embed URL, or null if there isn't one. */
export function getYouTubeId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

export function buildRunOptions(mission: {
  youtubeUrl?: string;
  videoUrl?: string;
  yardId?: string;
} | null | undefined): RunOption[] {
  const runs: RunOption[] = [];
  if (!mission) return [{ id: 'sim', label: 'Simulation', sublabel: 'On screen', kind: 'sim' }];

  // videoUrl is the older field; missions submitted before the rename carry it.
  const realId = getYouTubeId(mission.youtubeUrl || mission.videoUrl);

  if (realId) {
    // Name the city. Once Durban and Limpopo have rovers this is how a learner
    // tells runs apart, and "which yard" only means something to them as a
    // place they could point to on a map.
    runs.push({
      id: 'real-1',
      label: yardPlace(mission.yardId) ?? 'Real rover',
      sublabel: 'Real rover',
      kind: 'real',
      youtubeId: realId,
    });
  }

  runs.push({ id: 'sim', label: 'Simulation', sublabel: 'On screen', kind: 'sim' });
  return runs;
}
