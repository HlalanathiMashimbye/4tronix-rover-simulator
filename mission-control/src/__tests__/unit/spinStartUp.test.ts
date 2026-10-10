/**
 * A spin from straight wheels starts late (10 October 2026).
 *
 * The rover swings its corner wheels out before it turns, and until they are
 * there it barely turns at all. The simulator did not know, so a lap round
 * the yard that it drew as four right angles came out on the rover as four
 * turns of about 80 degrees, 59 cm from where the simulator finished.
 *
 * Sixteen spins were read off the satellite camera's recordings that day,
 * over three laps (the numbers are beside SPIN_START_UP_SECONDS in
 * rover-physics.ts). These pin the simulator to them: how far a spin turns
 * from straight wheels and from turned ones, what leaves the wheels turned,
 * and the laps themselves.
 *
 * The ranges are a few degrees wide on purpose. The same spin time turned the
 * rover about 7 degrees differently from one lap to the next, so the
 * simulator sits in the middle of the three laps and matches none exactly.
 */

import { parseRoverCode } from '@/lib/parseRoverCode';
import {
  SPIN_START_UP_SECONDS,
  YARD,
  roverToYard,
  spinDegreesForSeconds,
  spinDegreesPerSecond,
  spinSecondsForDegrees,
} from '@/lib/rover-physics';
import { workspaceToCommands, workspaceToPython } from '@/lib/roverBlockly';
import type { SimulationCommand } from '@/lib/roverBlockly';
import { simulateCommands } from '@/lib/simulateCommands';

// Nothing to bump into: these measure turning, not the yard.
const OPEN = { ...YARD, rocks: [], zones: [] };
const turned = (...commands: SimulationCommand[]) => {
  const path = simulateCommands(commands, OPEN);
  return path[path.length - 1].heading;
};
const spin = (seconds: number): SimulationCommand => ({ command: 'spinRight', speed: 60, duration: seconds });

describe('how far a spin turns the rover', () => {
  it('turns at the rate measured over long spins, which has not changed', () => {
    expect(spinDegreesPerSecond(60)).toBeCloseTo(45.29, 1);
  });

  it('comes up about 10 degrees short of a quarter turn in 1.99s from straight wheels', () => {
    // Measured: 86, 82, 76, 80, 80, 82. Mean 81.
    const degrees = turned(spin(1.99));
    expect(degrees).toBeGreaterThan(77);
    expect(degrees).toBeLessThan(81);
  });

  it('makes the quarter turn in 1.99s when the wheels are already turned', () => {
    // Measured: 92, 90. The second of two spins in a row.
    expect(turned(spin(1.99), spin(1.99)) - turned(spin(1.99))).toBeCloseTo(90, 0);
  });

  it('is still a little short in 2.18s from straight wheels', () => {
    // Measured: 92, 84, 80, 80. Mean 84.
    const degrees = turned(spin(2.18));
    expect(degrees).toBeGreaterThan(85);
    expect(degrees).toBeLessThan(89);
  });

  it('makes the quarter turn in 2.23s from straight wheels', () => {
    // Measured: 92, 92, 98, 90. Mean 93. The lap that finished nearest.
    expect(turned(spin(2.23))).toBeCloseTo(90, 0);
  });

  it('does not turn at all until the wheels are out', () => {
    expect(turned(spin(SPIN_START_UP_SECONDS))).toBeCloseTo(0, 6);
    expect(turned(spin(SPIN_START_UP_SECONDS + 0.5))).toBeCloseTo(0.5 * spinDegreesPerSecond(60), 3);
  });
});

describe('what leaves the wheels turned', () => {
  const second = (...between: SimulationCommand[]) => turned(spin(1.99), ...between, spin(1.99)) - turned(spin(1.99));

  it('a stop or a wait does: the next spin turns the whole time', () => {
    expect(second({ command: 'stop', duration: 0 })).toBeCloseTo(90, 0);
    expect(second({ command: 'wait', duration: 1 })).toBeCloseTo(90, 0);
  });

  it('a drive does not: it straightens them, and the next spin starts late again', () => {
    for (const command of ['forward', 'reverse'] as const) {
      // Out and back, so the turn is all that is left to compare.
      const short = second({ command, speed: 60, duration: 1 });
      expect(short).toBeGreaterThan(77);
      expect(short).toBeLessThan(81);
    }
  });
});

describe('asking for degrees', () => {
  it('gives a quarter turn from straight wheels 2.23 seconds', () => {
    // The spin time of the lap that finished nearest the simulator; a fit
    // through all sixteen spins says 2.22.
    expect(spinSecondsForDegrees(90, 60)).toBeCloseTo(2.23, 2);
    expect(turned(spin(spinSecondsForDegrees(90, 60)))).toBeCloseTo(90, 0);
  });

  it('gives no extra to a spin whose wheels are already turned', () => {
    expect(spinSecondsForDegrees(90, 60, true)).toBeCloseTo(spinSecondsForDegrees(90, 60) - SPIN_START_UP_SECONDS, 3);
    expect(turned(spin(1.99), spin(spinSecondsForDegrees(90, 60, true))) - turned(spin(1.99))).toBeCloseTo(90, 0);
  });

  it('asks for no time at all to turn nothing', () => {
    expect(spinSecondsForDegrees(0, 60)).toBe(0);
  });

  it('reads a saved time back as the turn it really makes', () => {
    for (const degrees of [30, 90, 180]) {
      for (const wheelsTurned of [false, true]) {
        const seconds = spinSecondsForDegrees(degrees, 60, wheelsTurned);
        expect(spinDegreesForSeconds(seconds, 60, wheelsTurned)).toBeCloseTo(degrees, 0);
      }
    }
    // Shorter than the start-up: the rover has not begun to turn.
    expect(spinDegreesForSeconds(0.1, 60)).toBe(0);
  });
});

describe('the lap round the yard', () => {
  const STRAIGHTEN = 'rover.setServo(9, 0)\nrover.setServo(11, 0)\nrover.setServo(13, 0)\nrover.setServo(15, 0)\n';
  const lap = (spinSeconds: number) =>
    (
      [
        ['spinLeft', 7.9],
        ['spinRight', 16.3],
        ['spinRight', 15.6],
        ['spinRight', 10.5],
      ] as const
    )
      .map(([turn, drive]) => `rover.${turn}(60)\ntime.sleep(${spinSeconds})\nrover.stop()\n${STRAIGHTEN}rover.forward(60)\ntime.sleep(${drive})\nrover.stop()\n`)
      .join('');
  const run = (spinSeconds: number) => {
    const path = simulateCommands(parseRoverCode(lap(spinSeconds)));
    const end = path[path.length - 1];
    return { path, end: roverToYard(end.x, end.y), crashed: path.some((p) => p.hitRock || p.hitWall) };
  };
  // Where four true right angles finish: on the front leg, facing the door.
  const SQUARE_END = [76.7, 189.9];

  it('closes with 2.23s spins, the lap the rover finished nearest', () => {
    const { end, crashed } = run(2.23);
    expect(Math.hypot(end[0] - SQUARE_END[0], end[1] - SQUARE_END[1])).toBeLessThan(2);
    expect(crashed).toBe(false);
  });

  it('no longer draws a clean rectangle for 1.99s spins, which the rover could not drive', () => {
    // On the rover this lap drifted east into the far wall. The simulator
    // used to finish it on SQUARE_END with every check green.
    const { end, crashed } = run(1.99);
    expect(crashed || Math.hypot(end[0] - SQUARE_END[0], end[1] - SQUARE_END[1]) > 40).toBe(true);
  });
});

describe('what the blocks ask for', () => {
  type Mock = {
    id: string;
    type: string;
    next: Mock | null;
    previous: Mock | null;
    getFieldValue(name: string): unknown;
    getInputTargetBlock(name: string): Mock | null;
    getNextBlock(): Mock | null;
    getPreviousBlock(): Mock | null;
  };
  let ids = 0;
  const block = (type: string, fields: Record<string, unknown> = {}, body?: Mock): Mock => {
    const b: Mock = {
      id: `${type}#${ids++}`,
      type,
      next: null,
      previous: null,
      getFieldValue: (name) => fields[name],
      getInputTargetBlock: (name) => (name === 'DO' ? body ?? null : null),
      getNextBlock: () => b.next,
      getPreviousBlock: () => b.previous,
    };
    // As in Blockly: the first block of a body is joined to the block around it.
    if (body) body.previous = b;
    return b;
  };
  const chain = (...blocks: Mock[]): Mock => {
    for (let i = 0; i < blocks.length - 1; i++) {
      blocks[i].next = blocks[i + 1];
      blocks[i + 1].previous = blocks[i];
    }
    return blocks[0];
  };
  const program = (...blocks: Mock[]) => ({ getTopBlocks: () => [block('rover_on_receive', {}, chain(...blocks))] });
  const quarter = () => block('rover_spin_right', { DEGREES: 90 });
  const drive = () => block('rover_forward', { TIME: 1 });
  /** The seconds each spin was given, in the Python and in the simulator's commands. */
  const spinTimes = (ws: ReturnType<typeof program>) => ({
    python: [...workspaceToPython(ws).matchAll(/rover\.spinRight\(60\)\n\s*time\.sleep\(([\d.]+)\)/g)].map((m) => Number(m[1])),
    commands: workspaceToCommands(ws)
      .filter((c) => c.command === 'spinRight')
      .map((c) => c.duration),
  });
  const FROM_STRAIGHT = spinSecondsForDegrees(90, 60);
  const ALREADY_TURNED = spinSecondsForDegrees(90, 60, true);

  it('gives a turn after a drive the longer time, in the Python and the simulator alike', () => {
    const times = spinTimes(program(drive(), quarter(), drive(), quarter()));
    expect(times.python).toEqual([FROM_STRAIGHT, FROM_STRAIGHT]);
    expect(times.commands).toEqual([FROM_STRAIGHT, FROM_STRAIGHT]);
  });

  it('gives a turn straight after a turn the shorter one', () => {
    const times = spinTimes(program(quarter(), quarter()));
    expect(times.python).toEqual([FROM_STRAIGHT, ALREADY_TURNED]);
    expect(times.commands).toEqual([FROM_STRAIGHT, ALREADY_TURNED]);
  });

  it('looks past blocks that do not move the wheels', () => {
    const times = spinTimes(program(quarter(), block('rover_wait', { TIME: 1 }), block('rover_stop'), quarter()));
    expect(times.python).toEqual([FROM_STRAIGHT, ALREADY_TURNED]);
  });

  it('treats the first turn in a Repeat as starting straight', () => {
    const times = spinTimes(program(quarter(), block('rover_repeat', { TIMES: 2 }, chain(quarter()))));
    expect(times.python).toEqual([FROM_STRAIGHT, FROM_STRAIGHT]);
  });

  it('turns four square corners on the simulator from what it wrote', () => {
    const corners = program(drive(), quarter(), drive(), quarter(), drive(), quarter(), drive(), quarter());
    const path = simulateCommands(workspaceToCommands(corners), OPEN);
    expect(path[path.length - 1].heading).toBeCloseTo(360, 0);
  });
});
