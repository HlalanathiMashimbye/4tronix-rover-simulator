/**
 * Which arrangement a mission's page takes for the box it has.
 *
 * The rule is JavaScript's rather than a container query's because the page
 * renders a different tree for three columns: the operator's note moves from
 * the code's card to under the rover's videos. That makes it something these
 * can hold to numbers.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { YARD } from '@/lib/rover-physics';
import {
  STACK,
  TILE_BORDER_PX,
  TILE_CAPTION_REM,
  missionLayout,
  missionLayoutStyle,
  type MissionLayout,
} from '@/lib/missionLayout';

const yardAspect = YARD.widthCm / YARD.depthCm;
const CHROME = TILE_CAPTION_REM * 16 + TILE_BORDER_PX;
const GAP = 8;

const layoutFor = (width: number, height: number, hasVideo = true) =>
  missionLayout({ width, height, yardAspect, hasVideo });

function wide(layout: MissionLayout) {
  if (layout.kind !== 'wide') throw new Error(`expected three columns, got ${layout.kind}`);
  return layout;
}

// The box the page has under its header, at the window sizes in the name.
const LAPTOPS: [name: string, width: number, height: number][] = [
  ['1280 x 720', 1256, 571],
  ['1366 x 768', 1342, 619],
  ['1440 x 900', 1416, 751],
  ['a 14 inch MacBook, as reviewed on 13 October 2026', 1488, 597],
  ['the same, full screen', 1488, 715],
];

describe('three columns, where a window has the room', () => {
  it.each(LAPTOPS)('is what a laptop gets (%s)', (_name, width, height) => {
    expect(layoutFor(width, height).kind).toBe('wide');
  });

  it.each(LAPTOPS)('stands the simulation as tall as the box, so nothing is left under it (%s)', (_name, width, height) => {
    const { simWidth } = wide(layoutFor(width, height));
    // A tile is its picture, a caption, and a border of a pixel all round.
    const tileHeight = (simWidth - TILE_BORDER_PX) / yardAspect + CHROME;

    expect(tileHeight).toBeLessThanOrEqual(height);
    expect(tileHeight).toBeGreaterThan(height - 2);
  });

  it.each(LAPTOPS)('never squeezes the code under 18rem (%s)', (_name, width, height) => {
    const { simWidth, videosWidth } = wide(layoutFor(width, height));

    expect(width - simWidth - videosWidth - 2 * GAP).toBeGreaterThanOrEqual(18 * 16);
  });

  it.each(LAPTOPS)('leaves room under the first video for the note (%s)', (_name, width, height) => {
    // "A tonne of whitespace at the bottom of the video, that's where the
    // comment should go."
    const { videosWidth } = wide(layoutFor(width, height));
    const videoTile = (videosWidth - TILE_BORDER_PX) * 0.75 + CHROME;

    expect(height - videoTile - GAP).toBeGreaterThanOrEqual(7 * 16 - 1);
  });

  it('gives the videos what the code can spare, in a window too tall for them to use it all', () => {
    const { simWidth, videosWidth } = wide(layoutFor(1416, 751));

    expect(1416 - simWidth - videosWidth - 2 * GAP).toBeLessThan(18 * 16 + 2);
  });

  it('gives the code the difference, in a window so short the video has to stop growing', () => {
    const { simWidth, videosWidth } = wide(layoutFor(1488, 597));

    expect(1488 - simWidth - videosWidth - 2 * GAP).toBeGreaterThan(18 * 16 + 40);
  });

  it('follows the yard: a wider yard is a wider simulation', () => {
    const square = wide(missionLayout({ width: 1488, height: 597, yardAspect: 1, hasVideo: true }));
    const measured = wide(layoutFor(1488, 597));

    expect(square.simWidth).toBeGreaterThan(measured.simWidth);
  });

  it('scales with the reader\'s text size, which the tiles\' captions do too', () => {
    const big = missionLayout({ width: 1488, height: 597, yardAspect, hasVideo: true, rem: 20 });

    expect(wide(big).simWidth).toBeLessThan(wide(layoutFor(1488, 597)).simWidth);
  });
});

describe('one feed beside the code, everywhere else', () => {
  it.each([
    ['an upright tablet', 744, 875],
    ['a tablet on its side', 1000, 619],
    ['a phone', 366, 705],
    ['a narrow window, as the app\'s own browser pane is', 767, 610],
  ])('is what there is no room to improve on (%s)', (_name, width, height) => {
    expect(layoutFor(width, height)).toEqual(STACK);
  });

  it('is what a mission no rover has driven gets at any size: there is no third thing', () => {
    // It was getting the layout for two pictures side by side, and drew its
    // one simulation at half size with the rest of the column empty (the
    // screenshot of 13 October 2026).
    for (const [, width, height] of LAPTOPS) expect(layoutFor(width, height, false)).toEqual(STACK);
  });

  it('is the answer before the box has been measured', () => {
    expect(layoutFor(0, 0)).toEqual(STACK);
  });

  it('is the answer when three columns would fit but the videos would start as a sliver', () => {
    // A larger tablet on its side (1180 x 820). The simulation at full height
    // takes 592 of it, and what is left gives the videos 258: a picture half
    // the width of the one beside it is not the layout this is for.
    expect(layoutFor(1156, 671)).toEqual(STACK);
  });

  it('is the answer when a window is so short the videos would be thumbnails again', () => {
    expect(layoutFor(1400, 300)).toEqual(STACK);
  });
});

describe('what the stylesheet is handed', () => {
  it('is the two widths, in pixels, for three columns', () => {
    expect(missionLayoutStyle({ kind: 'wide', simWidth: 525, videosWidth: 587 })).toEqual({
      '--sim-w': '525px',
      '--videos-w': '587px',
    });
  });

  it('is nothing for one feed, whose column globals.css sizes by itself', () => {
    expect(missionLayoutStyle(STACK)).toEqual({});
  });

  it('agrees with globals.css about what a tile adds to its picture', () => {
    // Two languages, one number: if they part, the simulation is a few
    // pixels taller than its box and its controls are cut off.
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

    expect(css).toContain(`--tile-chrome: calc(${TILE_CAPTION_REM}rem + ${TILE_BORDER_PX}px);`);
  });
});
