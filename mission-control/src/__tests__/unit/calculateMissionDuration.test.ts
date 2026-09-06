/**
 * Unit tests for the mission time ceiling (AB#401).
 *
 * The Blockly cases build blocks shaped like the real ones, spin blocks
 * included, because the first version of this measured spins through a `TIME`
 * field they no longer have and every turn counted as zero.
 */

import { calculateBlocklyDuration, calculatePythonDuration } from '@/core/domain/safety/calculateMissionDuration';
import { workspaceToPython } from '@/lib/roverBlockly';
import { MISSION_TIME_LIMIT_SECONDS } from '@/core/domain/safety/limits';

type Block = Record<string, unknown>;

const drive = (type: 'rover_forward' | 'rover_backward', time: number, next: Block | null = null) => ({
  type,
  getFieldValue: (n: string) => (n === 'TIME' ? time : null),
  getNextBlock: () => next,
});

/** A spin block as it is today: DEGREES, and no TIME anywhere. */
const spin = (degrees: number, next: Block | null = null) => ({
  type: 'rover_spin_right',
  getFieldValue: (n: string) => (n === 'DEGREES' ? degrees : null),
  getNextBlock: () => next,
});

const repeat = (times: number, body: Block | null, next: Block | null = null) => ({
  type: 'rover_repeat',
  getFieldValue: (n: string) => (n === 'TIMES' ? times : null),
  getInputTargetBlock: () => body,
  getNextBlock: () => next,
});

const workspace = (chain: Block | null) => ({
  getTopBlocks: () => [
    { type: 'rover_on_receive', getInputTargetBlock: () => chain, getNextBlock: () => null },
  ],
});

describe('calculateBlocklyDuration', () => {
  it('is zero for an empty workspace', () => {
    expect(calculateBlocklyDuration({ getTopBlocks: () => [] })).toBe(0);
  });

  it('sums a single block', () => {
    expect(calculateBlocklyDuration(workspace(drive('rover_forward', 5)))).toBe(5);
  });

  it('sums blocks in sequence', () => {
    const chain = drive('rover_forward', 3, drive('rover_backward', 2));
    expect(calculateBlocklyDuration(workspace(chain))).toBe(5);
  });

  it('multiplies a repeat by its count', () => {
    expect(calculateBlocklyDuration(workspace(repeat(3, drive('rover_forward', 2))))).toBe(6);
  });

  it('counts the time a spin takes, now that spins are measured in degrees', () => {
    // The regression: reading getFieldValue('TIME') here returned null and a
    // turn of any size measured as zero seconds.
    expect(calculateBlocklyDuration(workspace(spin(360)))).toBeGreaterThan(1);
  });

  it('does not let a spin-only mission slip under the ceiling', () => {
    // Twenty repeats of three full turns. Really about eleven minutes.
    const mission = workspace(repeat(20, spin(360, spin(360, spin(360)))));
    expect(calculateBlocklyDuration(mission)).toBeGreaterThan(MISSION_TIME_LIMIT_SECONDS);
  });

  it('agrees with the Python it generates', () => {
    // The two halves of the ceiling measure the same mission by different
    // routes, and a learner meets both. They must not disagree.
    const square = workspace(repeat(4, drive('rover_forward', 5, spin(90))));
    expect(calculateBlocklyDuration(square)).toBeCloseTo(
      calculatePythonDuration(workspaceToPython(square)),
      2,
    );
  });
});

describe('calculatePythonDuration', () => {
  it('is zero when nothing sleeps', () => {
    expect(calculatePythonDuration('rover.forward(60)\nrover.stop()')).toBe(0);
  });

  it('sums sleeps', () => {
    expect(calculatePythonDuration('time.sleep(2)\ntime.sleep(3)')).toBe(5);
  });

  it('multiplies a loop body by its count', () => {
    expect(calculatePythonDuration('for _ in range(3):\n    time.sleep(2)')).toBe(6);
  });

  it('multiplies nested loops together', () => {
    const code = 'for _ in range(4):\n    for _ in range(5):\n        time.sleep(2)';
    expect(calculatePythonDuration(code)).toBe(40);
  });

  it('counts a block after the loop once', () => {
    expect(calculatePythonDuration('for _ in range(3):\n    time.sleep(10)\ntime.sleep(1)')).toBe(31);
  });

  it('does not multiply two loops that merely follow each other', () => {
    // The old tracker assumed four spaces per nesting level, so the second
    // `for` stacked on the first and this measured 2 + 6 instead of 2 + 3.
    const code = 'for _ in range(2):\n    time.sleep(1)\nfor _ in range(3):\n    time.sleep(1)';
    expect(calculatePythonDuration(code)).toBe(5);
  });

  it('counts rover.wait as a pause, not only time.sleep', () => {
    // rover.wait is on the allowlist and is what a learner writing Python by
    // hand reaches for, but only time.sleep was ever matched - so a mission
    // built from rover.wait measured as zero and had no ceiling at all.
    expect(calculatePythonDuration('rover.forward(60)\nrover.wait(3)')).toBe(3);
  });

  it('does not let a rover.wait loop slip under the ceiling', () => {
    const code = `for _ in range(100):\n    rover.wait(${MISSION_TIME_LIMIT_SECONDS})`;
    expect(calculatePythonDuration(code)).toBeGreaterThan(MISSION_TIME_LIMIT_SECONDS);
  });

  it('adds both kinds of pause together', () => {
    expect(calculatePythonDuration('time.sleep(1)\nrover.wait(2)')).toBe(3);
  });

  it('ignores comments and blank lines between loop and body', () => {
    const code = '# a square\nfor _ in range(4):\n\n    # drive\n    time.sleep(5)\n';
    expect(calculatePythonDuration(code)).toBe(20);
  });
});
