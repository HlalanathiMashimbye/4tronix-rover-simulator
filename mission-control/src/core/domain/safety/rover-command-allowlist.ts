/**
 * Rover Command Allowlist
 *
 * User Story 21, Task 22: Define approved rover functions and blocked imports
 *
 * Security Model:
 * - Learners can only call functions in ROVER_COMMAND_ALLOWLIST
 * - All imports from DISALLOWED_IMPORTS are blocked
 * - Python built-ins like print() are allowed for debugging
 * - AST analysis prevents runtime sandbox escapes
 *
 * Design Philosophy:
 * - Start restrictive, expand as needed
 * - Prefer explicit allowlist over denylist
 * - Clear error messages guide learners to safe alternatives
 */

import { ArgumentRange } from '@/core/domain/safety/ArgumentRange';
import { MAX_ROVER_SPEED, MIN_ROVER_SPEED } from '@/core/domain/safety/limits';

/**
 * Approved rover control commands
 *
 * Movement Commands:
 * - forward(speed): Drive forward at a speed of 0-100 (percent of full power)
 * - backward(speed): Drive backward at a speed of 0-100
 * - turn_left(degrees): Rotate left by specified degrees
 * - turn_right(degrees): Rotate right by specified degrees
 *
 * Utility Commands:
 * - wait(seconds): Pause execution for specified seconds
 * - stop(): Emergency stop (halts all motion)
 *
 * Sensor Commands:
 * - get_distance(): Read ultrasonic sensor (returns cm)
 * - get_heading(): Read compass heading (returns degrees)
 *
 * All commands are called as `rover.command_name(args)`
 */
/**
 * Numeric argument limits, checked at submission.
 *
 * The allowlist above answers "may this command be called at all". It never
 * looked at the arguments, so `rover.forward(6300)` passed every check and
 * reached the rover, which then refused to run the whole mission - silently,
 * from the operator's point of view.
 *
 * Speeds are a percentage of full power on the 4tronix API, so 0-100. Sleeps
 * are bounded well under the sandbox's own wall-clock limit so a learner gets
 * a clear message here rather than a watchdog kill on the rover.
 *
 * Only the FIRST numeric argument is checked. That is where every speed and
 * duration sits, and guessing at the rest (servo indices, RGB triples) would
 * reject valid programs.
 *
 * Every motion command shares ONE range built from limits.ts. These used to be
 * seven separate `max: 100` literals beside MAX_ROVER_SPEED, and changing any
 * of them passed the whole test suite.
 */
const SPEED = new ArgumentRange(MIN_ROVER_SPEED, MAX_ROVER_SPEED, 'speed');
const SLEEP_SECONDS = new ArgumentRange(0, 60, 'number of seconds');

export const ROVER_ARGUMENT_LIMITS: Readonly<Record<string, ArgumentRange>> = {
  'rover.forward': SPEED,
  'rover.backward': SPEED,
  'rover.reverse': SPEED,
  'rover.spinLeft': SPEED,
  'rover.spinRight': SPEED,
  'rover.steerLeft': SPEED,
  'rover.steerRight': SPEED,
  'time.sleep': SLEEP_SECONDS,
  'rover.wait': SLEEP_SECONDS,
};

export const ROVER_COMMAND_ALLOWLIST = [
  // Movement commands
  'rover.forward',
  'rover.backward',
  'rover.reverse',
  'rover.turn_left',
  'rover.turn_right',
  'rover.spinLeft',
  'rover.spinRight',
  'rover.steerLeft',
  'rover.steerRight',

  // Utility commands
  'rover.wait',
  'rover.stop',

  // Sensor commands (for future challenges)
  'rover.get_distance',
  'rover.get_heading',

  // Low-level rover API emitted by the Blockly generator (runs on the rover via
  // the yard): servo positioning, distance read, and NeoPixel LEDs.
  'rover.setServo',
  'rover.getDistance',
  'rover.setColor',
  'rover.fromRGB',
  'rover.setPixel',
  'rover.show',
] as const;

/**
 * The subset of the allowlist that actually moves the rover, used by the
 * pre-flight checklist to answer "will anything happen if we run this".
 *
 * The wheels and the mast, not the lights: setColor/show change what the rover
 * looks like without moving it, and a mission that only does that is a
 * legitimate thing to build - it simply is not a drive. Sensor reads are absent
 * for the same reason.
 *
 * Kept next to the allowlist rather than in preFlightChecks so a command added
 * above is one edit away from being counted here, not one file away.
 */
export const ROVER_MOVEMENT_COMMANDS = [
  'rover.forward',
  'rover.backward',
  'rover.reverse',
  'rover.turn_left',
  'rover.turn_right',
  'rover.spinLeft',
  'rover.spinRight',
  'rover.steerLeft',
  'rover.steerRight',
  'rover.setServo',
] as const;

/**
 * Allowed Python built-ins for learner code
 *
 * Allowed for basic programming:
 * - print(): Debug output
 * - range(): Loop iteration
 * - len(): Get length
 * - int(), float(), str(): Type conversions
 * - abs(), min(), max(): Math operations
 *
 * Control flow (if, for, while) is allowed by default
 */
export const ALLOWED_BUILTINS = [
  'print',
  'range',
  'len',
  'int',
  'float',
  'str',
  'abs',
  'min',
  'max',
] as const;

/**
 * Disallowed Python imports (security risk)
 *
 * Blocked Categories:
 * 1. System access: os, sys, subprocess
 * 2. File I/O: pathlib, io, open
 * 3. Network: socket, urllib, requests
 * 4. Code execution: eval, exec, compile, __import__
 * 5. Introspection: inspect, types, importlib
 *
 * Why blocking is necessary:
 * - Prevents sandbox escape
 * - Protects rover hardware
 * - Prevents resource exhaustion
 * - Blocks network attacks
 */
export const DISALLOWED_IMPORTS = [
  // System access
  'os',
  'sys',
  'subprocess',

  // File I/O
  'pathlib',
  'io',
  'open',

  // Network
  'socket',
  'urllib',
  'requests',
  'http',

  // Code execution
  'eval',
  'exec',
  'compile',
  '__import__',

  // Introspection/metaprogramming
  'inspect',
  'types',
  'importlib',

  // Other dangerous modules
  'pickle',  // Arbitrary code execution
  'ctypes',  // C library access
  'multiprocessing',  // Process spawning
  'threading',  // Resource exhaustion
] as const;

/**
 * Error messages for blocked code patterns
 */
export const ALLOWLIST_ERROR_MESSAGES = {
  DISALLOWED_IMPORT: (moduleName: string) =>
    `Import of '${moduleName}' is not allowed. Only rover commands are permitted.`,

  DISALLOWED_FUNCTION: (functionName: string) =>
    `Function '${functionName}' is not in the approved rover command list. ` +
    `Allowed commands: ${ROVER_COMMAND_ALLOWLIST.join(', ')}`,

  DISALLOWED_BUILTIN: (builtinName: string) =>
    `Built-in function '${builtinName}' is not allowed for safety reasons.`,
} as const;

// Type exports for TypeScript safety
export type RoverCommand = typeof ROVER_COMMAND_ALLOWLIST[number];
export type DisallowedImport = typeof DISALLOWED_IMPORTS[number];
export type AllowedBuiltin = typeof ALLOWED_BUILTINS[number];
