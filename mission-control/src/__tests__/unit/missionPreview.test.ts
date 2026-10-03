/**
 * What the operator console says about a mission before it is sent.
 *
 * The console showed the code and nothing else. These pin what the preview
 * reads off the simulation and the existing checks, and that the worst
 * finding comes first, since that is the line an operator reads.
 */

import { previewMission } from '@/core/domain/safety/missionPreview';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { simulateCommands } from '@/lib/simulateCommands';

const preview = (code: string) => previewMission(code, simulateCommands(parseRoverCode(code)));
const find = (code: string, id: string) => preview(code).find((f) => f.id === id)!;

const SHORT_DRIVE = 'rover.forward(60)\ntime.sleep(3)\nrover.stop()\n';

it('says a short, clean drive looks fine', () => {
  expect(preview(SHORT_DRIVE).every((f) => f.level === 'ok')).toBe(true);
  expect(find(SHORT_DRIVE, 'edge').message).toMatch(/stays inside/i);
  expect(find(SHORT_DRIVE, 'duration').message).toBe('Runs 3s');
});

it('says when the rover reaches the edge of the yard, and when', () => {
  const longDrive = 'rover.forward(100)\ntime.sleep(40)\nrover.stop()\n';
  const edge = find(longDrive, 'edge');
  expect(edge.level).toBe('warn');
  expect(edge.atSeconds).toBeGreaterThan(0);
  expect(edge.atSeconds).toBeLessThan(40);
  expect(edge.message).toContain(`${edge.atSeconds}s`);
});

it('stops a run over the time limit', () => {
  const tooLong = 'rover.forward(10)\ntime.sleep(70)\nrover.stop()\n';
  expect(find(tooLong, 'duration')).toMatchObject({ level: 'stop', message: expect.stringMatching(/over the 60s limit/) });
});

it('stops code with problems, naming the first one and its line', () => {
  const bad = 'rover.forward(6300)\ntime.sleep(2)\nrover.stop()\n';
  const code = find(bad, 'code');
  expect(code.level).toBe('stop');
  expect(code.message).toMatch(/Line 1:/);
});

it('warns about a mission that never moves the rover', () => {
  expect(find('time.sleep(3)\n', 'moves').level).toBe('warn');
});

it('puts the worst finding first, whatever order they were found in', () => {
  // Found as: code (stop), edge (warn), duration (stop). Only sorting puts
  // both stops above the warning.
  const levels = preview('rover.forward(100)\ntime.sleep(70)\nrover.stop()\n').map((f) => f.level);
  const rank = { stop: 0, warn: 1, ok: 2 };
  expect(levels).toContain('warn');
  expect(levels).toEqual([...levels].sort((a, b) => rank[a] - rank[b]));
});

describe("the phone's one-line summary", () => {
  // A phone's panel shows each finding in a couple of words on one line,
  // with the full sentence as its tooltip.
  it('has a short form of every finding, short enough to share a line', () => {
    for (const code of [SHORT_DRIVE, 'rover.forward(100)\ntime.sleep(70)\nrover.stop()\n', 'time.sleep(3)\n']) {
      for (const finding of preview(code)) {
        expect(finding.short.length).toBeGreaterThan(0);
        expect(finding.short.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('keeps the fact that matters in the short form', () => {
    expect(find(SHORT_DRIVE, 'duration').short).toBe('3s');
    const edge = find('rover.forward(100)\ntime.sleep(40)\nrover.stop()\n', 'edge');
    expect(edge.short).toBe(`Edge at ${edge.atSeconds}s`);
    expect(find('rover.forward(6300)\ntime.sleep(2)\nrover.stop()\n', 'code').short).toBe('Code: line 1');
  });
});
