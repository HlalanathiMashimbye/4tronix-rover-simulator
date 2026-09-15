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
 * The longest a mission may be before the pre-flight checklist calls it ready.
 *
 * Sixty, where MISSION_TIME_LIMIT_SECONDS is 120, and the two are different
 * rules rather than a disagreement. 120 is the hard ceiling: the last thing
 * standing between a runaway mission and the rover, enforced at submit and
 * again on the yard. 60 is what a learner is asked to build to, checked in the
 * browser while they can still change it.
 *
 * A gap between the two is the point. The checklist can be tightened to suit
 * how long the queue is on the day without touching the number the rover
 * enforces, and anything that reaches the queue without passing the checklist -
 * a direct POST, an older client - still meets the ceiling that matters.
 */
export const MISSION_MAX_DURATION_SECONDS = 60;

/**
 * The shortest a mission may be before the pre-flight checklist calls it ready.
 *
 * Deliberately NOT mirrored in yard/rover/limits.py, and deliberately not
 * enforced by validateMission. The other two constants here are safety
 * ceilings, and the rover is the last place that can refuse one. This is the
 * opposite kind of rule: a floor, about whether a mission is worth a slot in
 * the queue, and the only useful moment to raise it is while the learner is
 * still looking at their code. Refusing it at the LAN boundary would reject a
 * mission at the one point where nobody can fix it.
 *
 * Two seconds because rover.forward() starts the motors and returns: without a
 * pause after it the program ends, the sandbox stops the rover, and the drive
 * that reaches the yard is a twitch.
 */
export const MISSION_MIN_DURATION_SECONDS = 2;

/**
 * The fastest the rover may be driven.
 *
 * ROVER_ARGUMENT_LIMITS builds the speed range for every motion command from
 * this, so it is the one number to change. The rover enforces the same ceiling
 * in mission_validator.py, and yard/rover/test_limits_match_mission_control.py
 * fails if the two stop agreeing.
 */
export const MAX_ROVER_SPEED = 100;

/**
 * The slowest. Zero rather than -100: the rover library takes a direction and
 * a speed separately (forward, reverse), and a negative speed is a PWM duty
 * cycle the motor driver refuses.
 */
export const MIN_ROVER_SPEED = 0;
