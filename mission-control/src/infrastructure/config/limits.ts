/**
 * Mission and rover safety limits (AB#401). Mirrored in yard/rover/limits.py -
 * change both, or the yard and the cloud will disagree about what is legal.
 */

/**
 * The longest a single mission may run. Enforced in validateMission at submit
 * and warned about live in the Blockly editor.
 */
export const MISSION_TIME_LIMIT_SECONDS = 120;

/**
 * The fastest the rover may be driven.
 *
 * Not enforced here: ROVER_ARGUMENT_LIMITS already caps every motion command
 * at 0-100 during allowlist analysis, which runs first and gives a better
 * message. This constant is the shared statement of the ceiling, and the rover
 * enforces it for real in mission_validator.py, where there is no allowlist.
 */
export const MAX_ROVER_SPEED = 100;
