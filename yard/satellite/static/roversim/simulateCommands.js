// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run `npm run build:roversim`.
import { RoverPhysics } from './rover-physics.js';
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
export function simulateCommands(commands) {
    const physics = new RoverPhysics();
    // Lamps persist until something changes them, exactly like the real rover:
    // they do not go out because the next command was a drive.
    let leds = [null, null, null, null];
    const trajectory = [toPoint(physics, leds)];
    for (const cmd of commands) {
        if (cmd.command === 'leds') {
            // A null slot means "leave that lamp alone", which is what setPixel does
            // to the other three.
            leds = leds.map((current, i) => cmd.leds?.[i] ?? current);
            // Show it for a beat, so a lights-only program is still watchable rather
            // than a single frame nobody sees.
            const steps = Math.max(1, Math.round((cmd.duration ?? 0.3) / STEP_SECONDS));
            for (let i = 0; i < steps; i++)
                trajectory.push(toPoint(physics, leds));
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
        physics.setCommand(cmd.command, cmd.speed ?? 60, cmd.degrees);
        const durationSeconds = cmd.duration ?? (cmd.command === 'stop' ? 0 : 1);
        /**
         * Whole steps, then whatever is left over.
         *
         * This used to round the duration to the nearest 0.1s, which quietly
         * capped how precisely the rover could be asked to do anything. A 90 degree
         * corner takes 2.734 seconds; rounding it to 2.7 turned 88.9 degrees, so a
         * square still would not close even once the blocks asked for degrees. The
         * limit had simply moved from the block field to here.
         *
         * The remainder step keeps the simulated time exactly what was asked for.
         * It makes the final point of a command represent a shorter slice than the
         * rest, which costs a fraction of a second in the playback clock and buys
         * turns that actually land where the learner said.
         */
        const wholeSteps = Math.floor(durationSeconds / STEP_SECONDS);
        const remainder = durationSeconds - wholeSteps * STEP_SECONDS;
        for (let i = 0; i < wholeSteps; i++) {
            physics.update(STEP_SECONDS);
            trajectory.push(toPoint(physics, leds));
        }
        // 1e-9 rather than 0: floating point leaves crumbs like 2.7755e-17 behind,
        // and a step of that length is a wasted point, not a movement.
        if (remainder > 1e-9) {
            physics.update(remainder);
            trajectory.push(toPoint(physics, leds));
        }
        // A command with no duration at all still gets one point, so 'stop' shows.
        if (wholeSteps === 0 && remainder <= 1e-9) {
            physics.update(0);
            trajectory.push(toPoint(physics, leds));
        }
    }
    return trajectory;
}
function toPoint(physics, leds) {
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
