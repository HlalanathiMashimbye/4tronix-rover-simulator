import { RoverPhysics } from './rover-physics';
import type { SimulationCommand } from './roverBlockly';

export interface TrajectoryPoint {
  x: number;
  y: number;
  heading: number;
  speedL: number;
  speedR: number;
  servos: Record<string, number>;
  hitWall?: boolean;
  /**
   * The four corner lamps at this moment, as 'r, g, b' or null for off.
   *
   * Carried on every point rather than as separate events, because the
   * simulator scrubs: a learner dragging the playhead back to frame 12 has to
   * see the lights as they were at frame 12, and an event list would have to be
   * replayed from the start to work that out.
   */
  leds: (string | null)[];
}

// Match the canvas playback rate (RoverSimulator advances at 10 fps).
/** Seconds of simulated time per trajectory point. Exported so the
 * mission page can turn a trajectory length back into a duration. */
export const STEP_SECONDS = 0.1;

/**
 * Run a list of generated rover commands through the client-side physics model
 * (the same engine manual control uses) and return the trajectory it traces.
 * This lets a code/Blockly run animate and record locally, with no dependency
 * on a yard-side renderer.
 */
export function simulateCommands(commands: SimulationCommand[]): TrajectoryPoint[] {
  const physics = new RoverPhysics();
  // Lamps persist until something changes them, exactly like the real rover:
  // they do not go out because the next command was a drive.
  let leds: (string | null)[] = [null, null, null, null];
  const trajectory: TrajectoryPoint[] = [toPoint(physics, leds)];

  for (const cmd of commands) {
    if (cmd.command === 'leds') {
      // A null slot means "leave that lamp alone", which is what setPixel does
      // to the other three.
      leds = leds.map((current, i) => cmd.leds?.[i] ?? current);
      // Show it for a beat, so a lights-only program is still watchable rather
      // than a single frame nobody sees.
      const steps = Math.max(1, Math.round((cmd.duration ?? 0.3) / STEP_SECONDS));
      for (let i = 0; i < steps; i++) trajectory.push(toPoint(physics, leds));
      continue;
    }

    if (cmd.command === 'wait') {
      const steps = Math.max(1, Math.round((cmd.duration ?? 1) / STEP_SECONDS));
      physics.setCommand('stop', 0);
      for (let i = 0; i < steps; i++) {
        physics.update(STEP_SECONDS);
        trajectory.push(toPoint(physics, leds));
      }
      continue;
    }

    physics.setCommand(cmd.command, cmd.speed ?? 60);
    const durationSeconds = cmd.duration ?? (cmd.command === 'stop' ? 0 : 1);
    const steps = Math.max(1, Math.round(durationSeconds / STEP_SECONDS));
    for (let i = 0; i < steps; i++) {
      physics.update(STEP_SECONDS);
      trajectory.push(toPoint(physics, leds));
    }
  }

  return trajectory;
}

function toPoint(physics: RoverPhysics, leds: (string | null)[]): TrajectoryPoint {
  const s = physics.getState();
  return {
    x: s.x,
    y: s.y,
    heading: s.heading,
    speedL: s.speedL,
    speedR: s.speedR,
    servos: { '9': s.servos[9], '15': s.servos[15], '11': s.servos[11], '13': s.servos[13] },
    hitWall: s.hitWall,
    leds: [...leds],
  };
}
