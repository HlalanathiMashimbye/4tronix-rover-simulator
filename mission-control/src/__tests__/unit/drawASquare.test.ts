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
    expect(spinDegreesPerSecond(60)).toBeGreaterThan(30);
    expect(spinDegreesPerSecond(60)).toBeLessThan(36);
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

    // 3 seconds was about 99 degrees, and that is what it should still show.
    expect(block.fields.DEGREES).toBeGreaterThan(95);
    expect(block.fields.DEGREES).toBeLessThan(103);
    expect(block.fields.TIME).toBeUndefined();
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
