/**
 * Unit tests for the pre-flight checklist.
 *
 * The cases that matter here are the ones where a naive substring search gets
 * it wrong: generated Blockly comments that name a drive command, and strings
 * that contain one.
 */

import { movesTheRover, runPreFlightChecks } from '@/core/domain/safety/preFlightChecks';
import { workspaceToPython } from '@/lib/roverBlockly';
import {
  MISSION_MAX_DURATION_SECONDS,
  MISSION_MIN_DURATION_SECONDS,
  MISSION_TIME_LIMIT_SECONDS,
} from '@/core/domain/safety/limits';

const checkFor = (code: string, id: string) =>
  runPreFlightChecks(code, { hasRunSimulation: true }).checks.find((check) => check.id === id)!;

describe('movesTheRover', () => {
  it('sees a drive command', () => {
    expect(movesTheRover('rover.forward(60)')).toBe(true);
  });

  it('sees the mast move', () => {
    expect(movesTheRover('rover.setServo(9, 0)')).toBe(true);
  });

  it('is false for a mission that only lights the LEDs', () => {
    expect(movesTheRover('rover.setColor(255, 0, 0)\nrover.show()')).toBe(false);
  });

  it('is false for an empty program', () => {
    expect(movesTheRover('')).toBe(false);
  });

  it('does not count a commented-out drive', () => {
    // The Blockly generator writes "# Drive forward for 5 seconds" above every
    // motion block, so a comment mentioning a command is the normal case, not
    // an exotic one.
    expect(movesTheRover('# rover.forward(60)\ntime.sleep(3)')).toBe(false);
    expect(movesTheRover('# Drive forward for 5 seconds\ntime.sleep(3)')).toBe(false);
  });

  it('does not count a command named inside a string', () => {
    expect(movesTheRover('print("rover.forward(60)")')).toBe(false);
  });

  it('does not match a command that merely starts the same way', () => {
    expect(movesTheRover('rover.forwardish(60)')).toBe(false);
  });

  it('requires a call, not a mention', () => {
    expect(movesTheRover('rover.forward')).toBe(false);
  });
});

describe('runPreFlightChecks', () => {
  it('passes everything for a mission that drives and pauses', () => {
    const result = runPreFlightChecks('rover.forward(60)\ntime.sleep(3)\nrover.stop()', {
      hasRunSimulation: true,
    });

    expect(result.ready).toBe(true);
    expect(result.duration).toBe(3);
  });

  it('fails the duration floor when the motors start and the program exits', () => {
    // The case the floor exists for: forward() returns immediately, so this
    // reaches the yard as a twitch.
    const result = runPreFlightChecks('rover.forward(60)\nrover.stop()', {
      hasRunSimulation: true,
    });

    expect(result.ready).toBe(false);
    expect(checkFor('rover.forward(60)\nrover.stop()', 'rover-moves').passed).toBe(true);
    expect(checkFor('rover.forward(60)\nrover.stop()', 'runs-long-enough').passed).toBe(false);
  });

  it('counts rover.wait towards the floor, not just time.sleep', () => {
    const code = `rover.forward(60)\nrover.wait(${MISSION_MIN_DURATION_SECONDS})`;

    expect(checkFor(code, 'runs-long-enough').passed).toBe(true);
  });

  it('accepts a mission exactly on the floor', () => {
    const code = `rover.forward(60)\ntime.sleep(${MISSION_MIN_DURATION_SECONDS})`;

    expect(runPreFlightChecks(code, { hasRunSimulation: true }).ready).toBe(true);
  });

  it('accepts a mission exactly on the ceiling', () => {
    const code = `rover.forward(60)\ntime.sleep(${MISSION_MAX_DURATION_SECONDS})`;

    expect(checkFor(code, 'within-time-limit').passed).toBe(true);
  });

  it('fails the ceiling one second over', () => {
    const code = `rover.forward(60)\ntime.sleep(${MISSION_MAX_DURATION_SECONDS + 1})`;

    expect(checkFor(code, 'within-time-limit').passed).toBe(false);
  });

  it('reports the duration so the checklist can name it', () => {
    // The wording lives in PreFlightChecklist; what the domain owes it is the
    // number, so a hint can say "runs for 0 seconds" rather than "too short".
    expect(runPreFlightChecks('rover.forward(60)', { hasRunSimulation: true }).duration).toBe(0);
  });

  it('is not ready until the simulator has run the code', () => {
    const code = 'rover.forward(60)\ntime.sleep(3)\nrover.stop()';

    expect(runPreFlightChecks(code, { hasRunSimulation: false }).ready).toBe(false);
    expect(runPreFlightChecks(code, { hasRunSimulation: true }).ready).toBe(true);
  });

  it('holds only the simulation check when the code itself is fine', () => {
    const code = 'rover.forward(60)\ntime.sleep(3)';
    const result = runPreFlightChecks(code, { hasRunSimulation: false });

    const failed = result.checks.filter((check) => !check.passed).map((check) => check.id);
    expect(failed).toEqual(['simulation-run']);
  });

  it('uses the 60 second checklist ceiling, not the 120 second hard limit', () => {
    // The two are deliberately different numbers - see MISSION_MAX_DURATION_SECONDS.
    // 90 seconds clears the hard limit and still fails the checklist.
    const code = 'rover.forward(60)\ntime.sleep(90)';

    expect(MISSION_MAX_DURATION_SECONDS).toBeLessThan(MISSION_TIME_LIMIT_SECONDS);
    expect(checkFor(code, 'within-time-limit').passed).toBe(false);
  });

  it('passes a real Blockly mission, comments and all', () => {
    // The generator's output is the code most learners actually submit, and it
    // is dense with comments naming the commands this checks for.
    const workspace = {
      getTopBlocks: () => [
        {
          type: 'rover_on_receive',
          getInputTargetBlock: () => ({
            type: 'rover_forward',
            getFieldValue: (n: string) => (n === 'TIME' ? 5 : null),
            getNextBlock: () => null,
          }),
          getNextBlock: () => null,
        },
      ],
    };

    const result = runPreFlightChecks(workspaceToPython(workspace), { hasRunSimulation: true });

    expect(result.ready).toBe(true);
  });
});
