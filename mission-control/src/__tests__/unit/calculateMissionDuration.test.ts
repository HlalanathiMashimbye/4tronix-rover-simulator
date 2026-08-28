/**
 * Unit Tests for Mission Duration and Speed Limit Validation (User Story 401)
 */

import { calculateBlocklyDuration, calculatePythonDuration, findMaxSpeedInPython } from '@/lib/calculateMissionDuration';
import { MISSION_TIME_LIMIT_SECONDS, MAX_ROVER_SPEED } from '@/infrastructure/config/limits';

describe('calculateBlocklyDuration', () => {
  it('should return 0 for empty workspace', () => {
    const mockWorkspace = {
      getTopBlocks: () => [],
    };
    expect(calculateBlocklyDuration(mockWorkspace)).toBe(0);
  });

  it('should sum single block durations', () => {
    const mockBlock = {
      type: 'rover_forward',
      getFieldValue: (name: string) => {
        if (name === 'TIME') return 5;
        return null;
      },
      getNextBlock: () => null,
    };

    const mockWorkspace = {
      getTopBlocks: () => [
        {
          type: 'rover_on_receive',
          getInputTargetBlock: () => mockBlock,
          getNextBlock: () => null,
        },
      ],
    };

    expect(calculateBlocklyDuration(mockWorkspace)).toBe(5);
  });

  it('should sum multiple blocks in sequence', () => {
    const mockBlock1 = {
      type: 'rover_forward',
      getFieldValue: (name: string) => (name === 'TIME' ? 3 : null),
      getNextBlock: () => mockBlock2,
    };

    const mockBlock2 = {
      type: 'rover_backward',
      getFieldValue: (name: string) => (name === 'TIME' ? 2 : null),
      getNextBlock: () => null,
    };

    const mockWorkspace = {
      getTopBlocks: () => [
        {
          type: 'rover_on_receive',
          getInputTargetBlock: () => mockBlock1,
          getNextBlock: () => null,
        },
      ],
    };

    expect(calculateBlocklyDuration(mockWorkspace)).toBe(5);
  });

  it('should account for loops multiplying duration', () => {
    const mockBlock1 = {
      type: 'rover_forward',
      getFieldValue: (name: string) => (name === 'TIME' ? 2 : null),
      getNextBlock: () => null,
    };

    const mockRepeat = {
      type: 'rover_repeat',
      getFieldValue: (name: string) => (name === 'TIMES' ? 3 : null),
      getInputTargetBlock: () => mockBlock1,
      getNextBlock: () => null,
    };

    const mockWorkspace = {
      getTopBlocks: () => [
        {
          type: 'rover_on_receive',
          getInputTargetBlock: () => mockRepeat,
          getNextBlock: () => null,
        },
      ],
    };

    expect(calculateBlocklyDuration(mockWorkspace)).toBe(6); // 2 * 3
  });
});

describe('calculatePythonDuration', () => {
  it('should return 0 for code with no sleep calls', () => {
    const code = 'rover.forward(60)\nrover.stop()';
    expect(calculatePythonDuration(code)).toBe(0);
  });

  it('should sum single time.sleep calls', () => {
    const code = 'rover.forward(60)\ntime.sleep(2.5)\nrover.stop()';
    expect(calculatePythonDuration(code)).toBe(2.5);
  });

  it('should sum multiple time.sleep calls', () => {
    const code = 'time.sleep(1)\nrover.forward(60)\ntime.sleep(2)\nrover.stop()';
    expect(calculatePythonDuration(code)).toBe(3);
  });

  it('should multiply sleep time by loop repetitions', () => {
    const code = `for _ in range(3):
    time.sleep(2)`;
    expect(calculatePythonDuration(code)).toBe(6); // 2 * 3
  });

  it('should handle nested loops', () => {
    const code = `for _ in range(2):
    for _ in range(3):
        time.sleep(1)`;
    expect(calculatePythonDuration(code)).toBe(6); // 1 * 2 * 3
  });

  it('should handle mixed loop and non-loop code', () => {
    const code = `time.sleep(1)
for _ in range(2):
    time.sleep(2)
time.sleep(1)`;
    expect(calculatePythonDuration(code)).toBe(7); // 1 + (2 * 2) + 1, but loop exit detection is after the 2nd sleep(1)
  });
});

describe('findMaxSpeedInPython', () => {
  it('should return 0 for code with no speed calls', () => {
    const code = 'time.sleep(1)\nrover.stop()';
    expect(findMaxSpeedInPython(code)).toBe(0);
  });

  it('should find forward speed', () => {
    const code = 'rover.forward(75)';
    expect(findMaxSpeedInPython(code)).toBe(75);
  });

  it('should find maximum speed across multiple calls', () => {
    const code = 'rover.forward(50)\nrover.spinLeft(80)\nrover.reverse(60)';
    expect(findMaxSpeedInPython(code)).toBe(80);
  });

  it('should handle various rover methods', () => {
    const code = `rover.forward(40)
rover.reverse(50)
rover.spinLeft(90)
rover.spinRight(70)
rover.steerLeft(60)
rover.steerRight(55)`;
    expect(findMaxSpeedInPython(code)).toBe(90);
  });
});

describe('Mission Limits Validation', () => {
  it('should allow missions at exactly the time limit', () => {
    const code = `time.sleep(${MISSION_TIME_LIMIT_SECONDS})`;
    expect(calculatePythonDuration(code)).toBe(MISSION_TIME_LIMIT_SECONDS);
  });

  it('should detect missions exceeding time limit', () => {
    const code = `time.sleep(${MISSION_TIME_LIMIT_SECONDS + 1})`;
    expect(calculatePythonDuration(code)).toBeGreaterThan(MISSION_TIME_LIMIT_SECONDS);
  });

  it('should allow speed at exactly the limit', () => {
    const code = `rover.forward(${MAX_ROVER_SPEED})`;
    expect(findMaxSpeedInPython(code)).toBe(MAX_ROVER_SPEED);
  });

  it('should detect speed exceeding limit', () => {
    const code = `rover.forward(${MAX_ROVER_SPEED + 1})`;
    expect(findMaxSpeedInPython(code)).toBeGreaterThan(MAX_ROVER_SPEED);
  });
});
