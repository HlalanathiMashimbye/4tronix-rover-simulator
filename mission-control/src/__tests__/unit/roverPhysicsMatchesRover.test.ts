/**
 * What the simulator draws has to be what the rover does.
 *
 * Three faults are pinned here, all found together and all with the same
 * shape: the simulator and the rover disagreed and nothing compared them.
 *
 *   1. The steering angle never reached the physics. parseRoverCode read it
 *      off setServo and put it on the command; simulateCommands dropped it;
 *      setCommand hardcoded 30. Steering 10 degrees and steering 45 drew the
 *      same curve.
 *   2. Spinning slid the rover across the yard. A spin went through the
 *      steered-wheel model, which can only produce arcs, so a 90 degree turn
 *      also travelled 9.5cm. The real rover pivots and stays put.
 *   3. (Python side, see yard/rover/test_steering_reaches_the_wheels.py)
 *      rover.forward() recentred the wheels, so hardware never steered at all.
 */

import { parseRoverCode } from '@/lib/parseRoverCode';
import { simulateCommands } from '@/lib/simulateCommands';
import {
  RoverPhysics,
  DEFAULT_STEER_DEGREES,
  spinDegreesPerSecond,
} from '@/lib/rover-physics';

/** The pose a program ends in, which is what a learner is actually judged on. */
function endPose(code: string) {
  const trajectory = simulateCommands(parseRoverCode(code));
  return trajectory[trajectory.length - 1];
}

/**
 * The lines the steer blocks emit, at a given angle.
 *
 * Front wheels one way, rear wheels the other, which is what
 * roverBlockly.ts's rover_steer_left / rover_steer_right generate. Written out
 * rather than derived from the generator so a mistake in the generator cannot
 * quietly make this agree with it.
 */
function steerProgram(direction: 'left' | 'right', degrees: number, seconds = 2) {
  const front = direction === 'left' ? -degrees : degrees;
  const rear = -front;
  return [
    `rover.setServo(9, ${front})`,
    `rover.setServo(15, ${front})`,
    `rover.setServo(11, ${rear})`,
    `rover.setServo(13, ${rear})`,
    'rover.forward(60)',
    `time.sleep(${seconds})`,
    'rover.stop()',
  ].join('\n');
}

const steerLeftProgram = (degrees: number, seconds = 2) =>
  steerProgram('left', degrees, seconds);

describe('the steering angle the learner asked for', () => {
  it('changes how far the rover turns', () => {
    const gentle = Math.abs(endPose(steerLeftProgram(10)).heading);
    const middling = Math.abs(endPose(steerLeftProgram(30)).heading);
    const sharp = Math.abs(endPose(steerLeftProgram(45)).heading);

    // Strictly increasing, so a model that ignored the angle - or clamped it,
    // or used it for only some values - cannot pass.
    expect(gentle).toBeLessThan(middling);
    expect(middling).toBeLessThan(sharp);
    expect(gentle).toBeGreaterThan(0);
  });

  it('is carried all the way from the Python to the trajectory', () => {
    // The servo angles on the trajectory are what the yard renderer draws the
    // wheels from, so a learner watching sees the angle they typed.
    const point = endPose(steerLeftProgram(12));

    expect(point.servos['9']).toBe(-12);
    expect(point.servos['15']).toBe(-12);
    expect(point.servos['11']).toBe(12);
    expect(point.servos['13']).toBe(12);
  });

  it('steers right the other way, by the same amount', () => {
    const left = endPose(steerProgram('left', 25)).heading;
    const right = endPose(steerProgram('right', 25)).heading;

    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(left)).toBeCloseTo(Math.abs(right), 6);
  });

  it('falls back to the documented default when nobody names an angle', () => {
    // Manual control has no angle to give. It must still steer, and by the
    // amount the constant says rather than by an accident.
    const physics = new RoverPhysics();
    physics.setCommand('steerLeft', 60);

    expect(physics.getState().servos[9]).toBe(-DEFAULT_STEER_DEGREES);
  });
});

describe('spinning on the spot', () => {
  it('does not move the rover', () => {
    const before = new RoverPhysics().getState();
    const after = endPose('rover.spinRight(60)\ntime.sleep(2.74)\nrover.stop()');

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    // and it did actually turn, so "never moves" is not how this passes
    expect(Math.abs(after.heading)).toBeGreaterThan(45);
  });

  it('does not move the rover from anywhere else in the yard either', () => {
    // The old arc model's drift depended on where the rover already was, so a
    // check that only ever spun from the origin could miss it.
    const code = [
      'rover.setServo(9, 0)',
      'rover.forward(60)',
      'time.sleep(3)',
      'rover.stop()',
      'rover.spinLeft(60)',
      'time.sleep(1.5)',
      'rover.stop()',
    ].join('\n');
    const trajectory = simulateCommands(parseRoverCode(code));

    const beforeSpin = trajectory.find((p) => p.speedL < 0 && p.speedR > 0);
    const last = trajectory[trajectory.length - 1];
    const droveTo = trajectory.filter((p) => p.speedL > 0 && p.speedR > 0).pop()!;

    expect(beforeSpin).toBeDefined();
    expect(last.x).toBeCloseTo(droveTo.x, 9);
    expect(last.y).toBeCloseTo(droveTo.y, 9);
  });

  it('turns left and right at the same rate, in opposite directions', () => {
    const right = endPose('rover.spinRight(60)\ntime.sleep(2)\nrover.stop()').heading;
    const left = endPose('rover.spinLeft(60)\ntime.sleep(2)\nrover.stop()').heading;

    expect(right).toBeGreaterThan(0);
    expect(left).toBeLessThan(0);
    expect(right).toBeCloseTo(-left, 9);
  });

  it('turns faster when driven faster', () => {
    expect(spinDegreesPerSecond(80)).toBeGreaterThan(spinDegreesPerSecond(40));
  });
});

describe('driving in a line', () => {
  it('is unaffected by all of the above', () => {
    // The spin branch and the steering angle must not have disturbed the one
    // motion that was already correct. 2s at speed 60 is 12cm, straight up.
    const after = endPose(
      'rover.setServo(9, 0)\nrover.forward(60)\ntime.sleep(2)\nrover.stop()'
    );

    expect(after.x).toBeCloseTo(0, 9);
    expect(after.y).toBeCloseTo(12, 6);
    expect(after.heading).toBeCloseTo(0, 9);
  });
});
