/**
 * A child should be able to drive a square.
 *
 * Werner reported that he could not build one in Blockly, and he was right.
 * The spin blocks asked for SECONDS. At speed 60 the rover turns 32.9 degrees
 * per second, so a 90 degree corner needs 2.736 seconds - and the field's step
 * was 0.1, so the closest reachable values were 2.7 (88.8 degrees) and 2.8
 * (92.1 degrees). Four corners of either left the square open, and nothing in
 * the interface ever told the learner the 32.9.
 *
 * Steer Left and Steer Right already took degrees. Turning on the spot was the
 * one motion that did not, and the one a square needs.
 *
 * The 32.9 above is history. It came from a model that ran a spin through the
 * steered-wheel maths, which also slid the rover 9.5cm sideways while it
 * turned. The real rover pivots and stays put, which was confirmed by watching
 * it. Spinning is modelled as a pivot now, and the rate is 45.3 degrees per
 * second at speed 60 - measured on the rover over six runs, not derived.
 *
 * Everything the bug report was about is unchanged: the argument holds at any
 * rate, because no rate divides 90 into a whole number of tenths of a second.
 */

import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import { spinDegreesPerSecond, spinSecondsForDegrees } from '@/lib/rover-physics';
import { migrateSpinBlocks } from '@/lib/roverBlockly';

/** Repeat 4 times: drive forward, turn 90 degrees. */
function square(): TrajectoryPoint[] {
  const commands = [];
  for (let corner = 0; corner < 4; corner++) {
    commands.push({ command: 'forward', speed: 60, duration: 2 });
    commands.push({
      command: 'spinRight',
      speed: 60,
      duration: spinSecondsForDegrees(90, 60),
    });
  }
  return simulateCommands(commands);
}

describe('driving a square', () => {
  it('comes back to where it started', () => {
    const path = square();
    const end = path[path.length - 1];

    // Within a centimetre of the origin, on a 640cm yard.
    expect(Math.hypot(end.x, end.y)).toBeLessThan(1);
  });

  it('ends up facing the way it set off', () => {
    const end = square()[0 + square().length - 1];
    const heading = ((end.heading % 360) + 360) % 360;

    // 360 and 0 are the same direction.
    const offBy = Math.min(heading, 360 - heading);
    expect(offBy).toBeLessThan(1);
  });

  it('turns four square corners, not four nearly-square ones', () => {
    const oneCorner = simulateCommands([
      { command: 'spinRight', speed: 60, duration: spinSecondsForDegrees(90, 60) },
    ]);
    const turned = Math.abs(oneCorner[oneCorner.length - 1].heading);

    expect(turned).toBeGreaterThan(89.5);
    expect(turned).toBeLessThan(90.5);
  });

  it('was genuinely impossible with the old seconds field', () => {
    // The two values a learner could actually reach with a 0.1s step.
    for (const seconds of [2.7, 2.8]) {
      const commands = [];
      for (let corner = 0; corner < 4; corner++) {
        commands.push({ command: 'forward', speed: 60, duration: 2 });
        commands.push({ command: 'spinRight', speed: 60, duration: seconds });
      }
      const path = simulateCommands(commands);
      const end = path[path.length - 1];

      // Never closes. This is the bug, pinned so nobody reintroduces seconds.
      expect(Math.hypot(end.x, end.y)).toBeGreaterThan(1);
    }
  });
});

describe('the turn rate', () => {
  it('is measured from the physics, not written down twice', () => {
    // If the wheelbase or full speed ever changes, this follows automatically.
    // The band has moved twice: 32.9 when a spin was modelled as a tight arc,
    // 38.4 once it became a pivot, and 45.3 once that pivot was calibrated
    // against the rover itself. A band rather than an equality, because
    // restating the exact figure here is the duplication the derivation and
    // the calibration constant exist to avoid.
    expect(spinDegreesPerSecond(60)).toBeGreaterThan(43);
    expect(spinDegreesPerSecond(60)).toBeLessThan(48);
  });

  it('is proportional to how fast the wheels are driven', () => {
    // The property that has to survive any recalibration of the rate, and the
    // one a band cannot check: half the speed, half the turn.
    expect(spinDegreesPerSecond(30)).toBeCloseTo(spinDegreesPerSecond(60) / 2, 6);
  });

  it('scales with speed, so a slower spin takes longer', () => {
    expect(spinSecondsForDegrees(90, 30)).toBeGreaterThan(spinSecondsForDegrees(90, 60));
  });
});

describe('missions saved before the change', () => {
  it('converts a spin block from seconds to the angle it actually turned', () => {
    const saved = JSON.stringify({
      blocks: { blocks: [{ type: 'rover_spin_right', fields: { TIME: 3 } }] },
    });

    const migrated = JSON.parse(migrateSpinBlocks(saved));
    const block = migrated.blocks.blocks[0];

    // What the number has to be is whatever 3 seconds of spinning actually
    // turns, so that regenerating the block emits the same 3 second sleep the
    // saved mission already ran on hardware. Asserting the round trip rather
    // than the figure is what makes that true at any turn rate - the figure
    // moved from 99 to 115 when spinning became a pivot, and the mission it
    // describes did not change at all.
    expect(block.fields.TIME).toBeUndefined();
    // Within a hair of 3, not exactly 3: the block field shows the learner a
    // whole number of degrees, and one degree is 26ms of spinning.
    expect(spinSecondsForDegrees(block.fields.DEGREES, 60)).toBeCloseTo(3, 1);
  });

  it('leaves a workspace that already uses degrees alone', () => {
    const saved = JSON.stringify({
      blocks: { blocks: [{ type: 'rover_spin_left', fields: { DEGREES: 45 } }] },
    });

    expect(migrateSpinBlocks(saved)).toBe(saved);
  });

  it('returns unparseable state untouched rather than half-rewriting it', () => {
    expect(migrateSpinBlocks('not json')).toBe('not json');
  });
});
