/**
 * What a yard's layout may be (AB#468): one rulebook for the API that saves
 * it and the settings form that edits it, so the form marks a field for the
 * same reason the server would refuse it.
 *
 * Everything in centimetres from the yard's west wall (x) and back, north wall
 * (y), as yard-measurements.md measures. Centres go inside the yard; a zone's
 * edge may run past a wall, because rising ground does not stop at one.
 *
 * The words say what is wrong in the yard, not in the JSON: whoever reads them
 * is looking at a drawing of the floor.
 */

import { z } from 'zod';

import type { YardLayout } from '@/core/domain/entities/Yard';

const cm = (what: string, min: number, max: number) =>
  z
    .number({ message: `${what} has to be a number of centimetres.` })
    .finite()
    .min(min, `${what} has to be at least ${min} cm.`)
    .max(max, `${what} has to be at most ${max} cm.`);

const rock = z.object({
  name: z.string().trim().min(1, 'Give the rock a name, like R5.').max(12, 'Keep a rock name short: it is drawn on the map.'),
  x: cm('Across', 0, 2000),
  y: cm('Down', 0, 2000),
  widthCm: cm('Width', 1, 300),
  depthCm: cm('Depth', 1, 300),
});

const zone = z.object({
  level: z.enum(['yellow', 'orange', 'red'], { message: 'A zone is yellow, orange or red.' }),
  x: cm('Across', 0, 2000),
  y: cm('Down', 0, 2000),
  rx: cm('Width', 1, 1000),
  ry: cm('Depth', 1, 1000),
});

export const yardLayoutSchema = z
  .object({
    widthCm: cm('The yard', 50, 2000),
    depthCm: cm('The yard', 50, 2000),
    start: z.object({
      x: cm('Across', 0, 2000),
      y: cm('Down', 0, 2000),
      facingDegrees: z
        .number({ message: 'Facing has to be a number of degrees.' })
        .finite()
        .min(0, 'Facing is 0 to 359 degrees, 0 for north.')
        .max(359, 'Facing is 0 to 359 degrees, 0 for north.'),
    }),
    rocks: z.array(rock).max(30, 'Thirty rocks is the most a yard can have.'),
    zones: z.array(zone).max(40, 'Forty zones is the most a yard can have.').optional(),
  })
  .superRefine((layout, ctx) => {
    const inside = (x: number, y: number, path: (string | number)[], what: string) => {
      if (x > layout.widthCm) ctx.addIssue({ code: 'custom', path: [...path, 'x'], message: `${what} is past the east wall.` });
      if (y > layout.depthCm) ctx.addIssue({ code: 'custom', path: [...path, 'y'], message: `${what} is past the front wall.` });
    };
    inside(layout.start.x, layout.start.y, ['start'], 'The start');
    const names = new Set<string>();
    layout.rocks.forEach((r, i) => {
      inside(r.x, r.y, ['rocks', i], `Rock ${r.name}`);
      if (names.has(r.name)) ctx.addIssue({ code: 'custom', path: ['rocks', i, 'name'], message: `Two rocks are called ${r.name}.` });
      names.add(r.name);
    });
    layout.zones?.forEach((z, i) => inside(z.x, z.y, ['zones', i], 'A zone\'s centre'));
  });

/** The layout, or the first thing wrong with it in words. */
export function checkYardLayout(value: unknown): { layout: YardLayout } | { error: string; path: (string | number)[] } {
  const parsed = yardLayoutSchema.safeParse(value);
  if (parsed.success) return { layout: parsed.data as YardLayout };
  const issue = parsed.error.issues[0];
  return { error: issue.message, path: issue.path as (string | number)[] };
}
