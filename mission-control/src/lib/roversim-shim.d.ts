/**
 * Type-only stand-in for the one symbol the simulator libraries import from
 * `@/components/mission/roverBlockly`.
 *
 * Only used by tsconfig.roversim.json, which redirects that import path here
 * when building the standalone simulator modules for the yard satellite. The
 * real roverBlockly.ts also exports runtime functions and pulls in the whole
 * Blockly package; without this redirect tsc drags all of that into a build
 * whose output is meant to be four small dependency-free files.
 *
 * `SimulationCommand` is a type, erased at compile time, so nothing here
 * reaches the emitted JavaScript. Keep it identical to the interface in
 * roverBlockly.ts - it is checked against the real one by
 * scripts/build-roversim.mjs.
 */
export interface SimulationCommand {
  command: string;
  speed?: number;
  duration?: number;
  degrees?: number;
}
