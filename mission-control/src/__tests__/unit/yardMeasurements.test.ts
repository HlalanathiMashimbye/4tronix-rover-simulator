/**
 * The simulator's yard is the measured one (AB#464).
 *
 * yard/docs/yard-measurements.md records how the real yard was measured and
 * what came out; YARD in rover-physics.ts is what the simulator drives in.
 * They are in different files for good reasons (one is a record for people,
 * the other is code), so this reads the doc's tables and fails the moment the
 * two disagree, rather than trusting a comment to keep them in step.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { YARD } from '@/lib/rover-physics';

const DOC = readFileSync(join(__dirname, '../../../../yard/docs/yard-measurements.md'), 'utf8');

const BEARINGS: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };

function row(label: string): string {
  const line = DOC.split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!line) throw new Error(`yard-measurements.md has no "${label}" row`);
  return line;
}

describe('the simulator yard against yard-measurements.md', () => {
  it('has the measured size', () => {
    expect(row('Width, west to east')).toMatch(new RegExp(`\\*\\*${YARD.widthCm} cm\\*\\*`));
    expect(row('Depth, north to south')).toMatch(new RegExp(`\\*\\*${YARD.depthCm} cm\\*\\*`));
  });

  it('starts where the doc says, facing the way it says', () => {
    const [, x, y, facing] = row('Start').match(/x ([\d.]+), y ([\d.]+), facing (\w+)/) ?? [];
    expect(Number(x)).toBe(YARD.start.x);
    expect(Number(y)).toBe(YARD.start.y);
    expect(BEARINGS[facing]).toBe(YARD.start.facingDegrees);
  });

  it('has every rock in the doc, where the doc puts it, at its size', () => {
    const rocks = [...DOC.matchAll(/^\| (R\d+)\b[^|]*\| (\d+), (\d+) \| (\d+) x (\d+) \|$/gm)].map(
      ([, name, x, y, w, d]) => ({ name, x: +x, y: +y, widthCm: +w, depthCm: +d }),
    );
    // Guards the pattern itself: a table reformatted out from under it would
    // otherwise match nothing and compare an empty list to an empty yard.
    expect(rocks.length).toBeGreaterThan(0);
    expect(YARD.rocks).toEqual(rocks);
  });
});
