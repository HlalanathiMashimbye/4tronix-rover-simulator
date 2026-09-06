/**
 * Tests over the Progressive Challenges CONTENT, not the machinery.
 *
 * The steps in infrastructure/config/challenges.ts tell a learner to type
 * specific Python, and separately declare the checks that decide whether they
 * may move on. Nothing made those two agree. A step could teach code that its
 * own checks reject - the learner does exactly what they are told, the Next
 * button stays dead, and no test in the repository goes red.
 *
 * So these tests do not carry their own copy of the solution. They lift the
 * code back OUT of the instructions the learner reads and run it through the
 * real pipeline: parseRoverCode -> deriveTrajectoryOutcomes -> evaluateCheck.
 * Rewrite a Level 3 step to teach something its checks do not accept and this
 * file fails. That is the same tactic yard/satellite/tests/test_mission_import.py
 * uses on the yard's regexes, and for the same reason: two things that must
 * agree, in different languages, with no shared definition available.
 */

import { CHALLENGES, CHALLENGE_LEVELS } from '@/infrastructure/config/challenges';
import { ChallengeId } from '@/core/domain/entities/Challenge';
import {
  deriveTrajectoryOutcomes,
  evaluateCheck,
  stepChecksPass,
  type ChallengeEvalContext,
} from '@/core/application/services/ChallengeCheckEvaluator';
import { parseRoverCode } from '@/lib/parseRoverCode';

/**
 * Pull the Python out of a step's prose.
 *
 * Instructions are written for a human, so the code sits inline as its own
 * lines among sentences. A line counts as code if it opens a loop or calls the
 * rover/time API, at any indentation - which is exactly the set of lines a
 * learner would copy.
 */
function codeFromInstructions(instructions: string): string {
  return instructions
    .split('\n')
    .filter((line) => /^\s*(for\s+\w+\s+in\s+range\(|rover\.|time\.)/.test(line))
    .join('\n');
}

/** Run a program the way the workspace does, and answer a step's checks with it. */
function contextFor(code: string): ChallengeEvalContext {
  return {
    generatedCode: code,
    trajectoryOutcomes: deriveTrajectoryOutcomes(parseRoverCode(code)),
  };
}

describe('challenge content integrity', () => {
  it('every level lists challenges that exist, and every challenge sits in its level', () => {
    for (const level of CHALLENGE_LEVELS) {
      for (const id of level.challengeIds) {
        expect(CHALLENGES[id]).toBeDefined();
        expect(CHALLENGES[id].levelId).toBe(level.id);
      }
    }

    const listed = CHALLENGE_LEVELS.flatMap((level) => level.challengeIds).sort();
    const defined = (Object.keys(CHALLENGES) as ChallengeId[]).sort();
    expect(listed).toEqual(defined);
  });

  it('no challenge ships a curriculum-standards claim', () => {
    /**
     * CAPS/CSTA codes were removed because nobody on the team can vouch for
     * the mapping, and a claim a teacher can check is only worth shipping if
     * it survives being checked. This asserts over the whole serialized
     * content rather than one component's markup, so re-adding the codes
     * anywhere in the track - a summary, a hint, a step - fails here.
     */
    expect(JSON.stringify(CHALLENGES)).not.toMatch(/CSTA|CAPS/);
  });

  it('explains Jezero Crater wherever it names it', () => {
    const mentions = [
      ...CHALLENGE_LEVELS.map((l) => `${l.title} ${l.description}`),
      ...Object.values(CHALLENGES).map((c) => `${c.title} ${c.summary}`),
    ].filter((text) => text.includes('Jezero'));

    expect(mentions.length).toBeGreaterThan(0);
    for (const text of mentions) {
      expect(text).toMatch(/Perseverance/);
    }
  });
});

describe('the Level 3 square teaches code that its own checks accept', () => {
  const square = CHALLENGES['draw-a-square'];

  it('is real Python in Monaco, not blocks', () => {
    expect(square.workspaceKind).toBe('monaco-sim');
  });

  it.each(
    square.steps
      .filter((step) => step.checks.length > 0)
      .map((step) => [step.id, step] as const),
  )('step %s passes when the learner types what it shows them', (_id, step) => {
    const code = codeFromInstructions(step.instructions);
    expect(code).not.toBe('');
    expect(stepChecksPass(step.checks, contextFor(code))).toBe(true);
  });

  it('the final step actually drives a closed four-sided path', () => {
    const step = square.steps.find((s) => s.id === 'repeat-four-times');
    if (!step) throw new Error('repeat-four-times step is gone');

    const commands = parseRoverCode(codeFromInstructions(step.instructions));
    const forwards = commands.filter((c) => c.command === 'forward');
    const spins = commands.filter((c) => c.command === 'spinRight');

    // Four sides and four corners, i.e. the loop really expanded.
    expect(forwards).toHaveLength(4);
    expect(spins).toHaveLength(4);
  });

  it('a straight line fails the loop step, so that check can actually fail', () => {
    /**
     * Without this, every assertion above would still pass if evaluateCheck
     * returned true unconditionally. A learner who drives forward and stops
     * has not written a loop and must not be let through.
     */
    const step = square.steps.find((s) => s.id === 'repeat-four-times');
    if (!step) throw new Error('repeat-four-times step is gone');

    const straightLine = 'rover.forward(60)\ntime.sleep(2)\nrover.stop()';
    expect(stepChecksPass(step.checks, contextFor(straightLine))).toBe(false);

    const loopCheck = step.checks.find((c) => c.kind === 'code-contains');
    if (!loopCheck) throw new Error('the loop step no longer checks for a loop');
    expect(evaluateCheck(loopCheck, contextFor(straightLine))).toBe(false);
  });
});
