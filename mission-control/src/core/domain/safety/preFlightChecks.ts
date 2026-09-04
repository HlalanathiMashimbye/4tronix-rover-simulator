/**
 * Pre-flight checks: is this mission worth the rover's time?
 *
 * The yard has one rover and a queue of children waiting for it. A mission that
 * starts the motors and exits, or one that only prints, costs the same slot as a
 * real drive and shows the operator a rover that never moved. These checks are
 * what a learner sees BEFORE they send, so the answer arrives while they can
 * still fix it.
 *
 * This is the teaching layer, in the same sense as learnerCodeCheck: it decides
 * what the Send button looks like, not what the queue accepts. validateMission
 * remains the authority on what is legal, and it deliberately does not run these
 * rules - see the note on BLOCKS_SUBMISSION below.
 *
 * Static analysis, not execution. The obvious implementation is to run the code
 * against a mock rover and time it, and this codebase has already decided
 * against a Python runtime in the browser twice (learnerCodeCheck, the allowlist
 * analyser): Pyodide is megabytes on venue wifi. Timing a mock would also
 * measure the mock rather than the rover - a mission's real duration is what it
 * sleeps for, which is exactly what calculatePythonDuration reads.
 */

import { calculatePythonDuration } from '@/core/domain/safety/calculateMissionDuration';
import {
  MISSION_MAX_DURATION_SECONDS,
  MISSION_MIN_DURATION_SECONDS,
} from '@/core/domain/safety/limits';
import { ROVER_MOVEMENT_COMMANDS } from '@/core/domain/safety/rover-command-allowlist';

export type PreFlightCheckId =
  | 'simulation-run'
  | 'rover-moves'
  | 'runs-long-enough'
  | 'within-time-limit';

/**
 * One rule and whether this mission meets it. No wording.
 *
 * The checklist's labels and hints live in PreFlightChecklist, next to the
 * markup that shows them, which is where ChallengeChecklistPanel already keeps
 * the same kind of copy ("presentation only, not domain logic"). Wording them
 * here would mean a safety module changed whenever a sentence was reworded, and
 * would leave two houses for the same decision.
 */
export interface PreFlightCheck {
  id: PreFlightCheckId;
  passed: boolean;
}

export interface PreFlightResult {
  checks: PreFlightCheck[];
  /** True when every check passes - the Send button's enabled state. */
  ready: boolean;
  /** Seconds the mission will run for, as measured by the ceiling. */
  duration: number;
}

/**
 * Python with comments and string literals removed, so that a line the learner
 * has commented out cannot satisfy a check.
 *
 * This matters more than it looks. The Blockly generator writes a
 * `# Drive forward for 5 seconds` header above every motion block, so a
 * workspace whose blocks were all deleted but whose generated Python was left
 * behind would still read as "the rover moves" to a plain substring search.
 *
 * Quotes go too: `print("rover.forward")` is not a drive command.
 */
function stripNonCode(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      let out = '';
      let quote: string | null = null;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (quote) {
          if (char === quote) quote = null;
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (char === '#') break;
        out += char;
      }
      return out;
    })
    .join('\n');
}

/**
 * Does this mission actually drive the rover somewhere?
 *
 * Movement means the wheels or the mast: a mission that only lights the LEDs is
 * a legitimate thing to build, and it is the reason this check reports rather
 * than rejects. The learner is told their rover will not move; they are not
 * stopped from deciding that is what they wanted.
 */
export function movesTheRover(code: string): boolean {
  const source = stripNonCode(code);

  return ROVER_MOVEMENT_COMMANDS.some((command) => {
    // Escape the dot so 'rover.forward' cannot match 'roverXforward', and
    // require the opening bracket so a bare mention is not a call.
    const pattern = new RegExp(`\\b${command.replace('.', '\\.')}\\s*\\(`);
    return pattern.test(source);
  });
}

export interface PreFlightContext {
  /**
   * Whether the learner has watched THIS code run in the simulator.
   *
   * Not a property of the code, which is why it is passed in rather than
   * derived: the workspace knows it, and it goes stale the moment an edit makes
   * the last run describe something the learner is no longer submitting.
   */
  hasRunSimulation: boolean;
}

/**
 * Run every pre-flight check over a mission.
 *
 * Pure and cheap - the UI calls it on every keystroke rather than caching it.
 */
export function runPreFlightChecks(code: string, context: PreFlightContext): PreFlightResult {
  const duration = calculatePythonDuration(code);

  // Order matters, and it is a rule rather than a rendering detail: the
  // simulation check comes first because it is the one the learner satisfies by
  // pressing a button rather than by editing, and watching the run is usually
  // how they discover the other three are wrong.
  const checks: PreFlightCheck[] = [
    { id: 'simulation-run', passed: context.hasRunSimulation },
    { id: 'rover-moves', passed: movesTheRover(code) },
    { id: 'runs-long-enough', passed: duration >= MISSION_MIN_DURATION_SECONDS },
    { id: 'within-time-limit', passed: duration <= MISSION_MAX_DURATION_SECONDS },
  ];

  return { checks, ready: checks.every((check) => check.passed), duration };
}
