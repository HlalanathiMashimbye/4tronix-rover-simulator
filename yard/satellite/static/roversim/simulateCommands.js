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
    const trajectory = [toPoint(physics)];
    for (const cmd of commands) {
        physics.setCommand(cmd.command, cmd.speed ?? 60);
        const durationSeconds = cmd.duration ?? (cmd.command === 'stop' ? 0 : 1);
        const steps = Math.max(1, Math.round(durationSeconds / STEP_SECONDS));
        for (let i = 0; i < steps; i++) {
            physics.update(STEP_SECONDS);
            trajectory.push(toPoint(physics));
        }
    }
    return trajectory;
}
function toPoint(physics) {
    const s = physics.getState();
    return {
        x: s.x,
        y: s.y,
        heading: s.heading,
        speedL: s.speedL,
        speedR: s.speedR,
        servos: { '9': s.servos[9], '15': s.servos[15], '11': s.servos[11], '13': s.servos[13] },
        hitWall: s.hitWall,
    };
}
