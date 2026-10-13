/**
 * How a mission's page arranges itself in the box it has (MissionVideoClient).
 *
 * `stack`: one feed, the simulation above the rover's videos, the code beside
 * it. What a phone and an upright tablet get, and any window without the room
 * for more.
 *
 * `wide`: three things side by side. The simulation, as tall as the box. The
 * rover's videos in a column of their own that scrolls down, with the
 * operator's note under them. The code.
 *
 * WHY `wide` EXISTS. A laptop's window is short and wide, and the stack there
 * was a column of thumbnails beside a thousand pixels of code. Its first
 * answer laid the feed on its side, the simulation and the first video at one
 * height with more videos off to the right. Two things were wrong with that
 * and both were reported on 13 October 2026: a list that runs sideways is not
 * something a mouse wheel finds, and two pictures of fixed shape side by side
 * leave a strip of nothing under them that grows with every pixel of height
 * ("a tonne of whitespace at the bottom of the video, that's where the
 * comment should go"). Here the simulation takes the height, the videos
 * scroll the way everything else does, and what is left under the first video
 * is where the note goes.
 *
 * Decided here rather than in a container query because the page renders a
 * different tree for it (the note moves from the code's card to under the
 * videos), and CSS cannot move an element. So this is the one owner: the page
 * reads the answer, and globals.css sizes the columns from the two widths it
 * is handed (`missionLayoutStyle`).
 */
export type MissionLayout = { kind: 'stack' } | { kind: 'wide'; simWidth: number; videosWidth: number };

export const STACK: MissionLayout = { kind: 'stack' };

/**
 * What a feed tile adds to its picture: a caption above it, and a border of
 * one pixel all round. --tile-chrome in globals.css is the same two numbers,
 * and missionLayout.test.ts holds the two to each other.
 */
export const TILE_CAPTION_REM = 2.25;
export const TILE_BORDER_PX = 2;

/** The gap between any two things on the page. */
const GAP_REM = 0.5;
/** The code is never narrower than this: its header's switch and Copy need it. */
const CODE_MIN_REM = 18;
/** Three columns are not worth having if the videos' one would start narrower than this. */
const VIDEOS_WORTH_REM = 20;
/** Under this a video is a thumbnail again, which is what `wide` is for avoiding. */
const VIDEOS_MIN_REM = 15;
/** Kept clear under the first video for the operator's note and Remix. */
const NOTE_ROOM_REM = 7;
/** What the yard's camera records. */
const VIDEO_ASPECT = 4 / 3;

export function missionLayout({
  width,
  height,
  yardAspect,
  hasVideo,
  rem = 16,
}: {
  /** The box the feed and the code share, in pixels. */
  width: number;
  height: number;
  /** The yard's width over its depth: the simulation's shape. */
  yardAspect: number;
  /** A rover has driven it. Without a video there is nothing for a third column. */
  hasVideo: boolean;
  rem?: number;
}): MissionLayout {
  if (!hasVideo || width <= 0 || height <= 0) return STACK;

  const chrome = TILE_CAPTION_REM * rem + TILE_BORDER_PX;
  const gap = GAP_REM * rem;

  // The simulation's tile as tall as the box, so nothing is left under it.
  const simWidth = (height - chrome) * yardAspect + TILE_BORDER_PX;
  const rest = width - simWidth - 2 * gap;
  if (rest < (VIDEOS_WORTH_REM + CODE_MIN_REM) * rem) return STACK;

  // The videos get what the code can spare, and no more than leaves the note
  // its room under the first one. Past that the code takes the difference.
  const widestWithRoomForTheNote =
    (height - chrome - gap - NOTE_ROOM_REM * rem) * VIDEO_ASPECT + TILE_BORDER_PX;
  const videosWidth = Math.min(rest - CODE_MIN_REM * rem, widestWithRoomForTheNote);
  if (videosWidth < VIDEOS_MIN_REM * rem) return STACK;

  return { kind: 'wide', simWidth: Math.floor(simWidth), videosWidth: Math.floor(videosWidth) };
}

/** The two widths, as the custom properties globals.css sizes the columns from. */
export function missionLayoutStyle(layout: MissionLayout): Record<string, string> {
  if (layout.kind !== 'wide') return {};
  return { '--sim-w': `${layout.simWidth}px`, '--videos-w': `${layout.videosWidth}px` };
}
