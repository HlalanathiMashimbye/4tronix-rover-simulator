/**
 * Level tests (AB#446) and the levels after Level 3 (AB#445), held to their
 * acceptance criteria over the shipped content.
 *
 * Every test is graded by running something through the same physics a
 * learner's run goes through, so these prove each test can be passed - by its
 * own reference program, and by the code a learner would actually write - and
 * that the wrong answers a learner would actually try do not pass it.
 */

import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import type { Challenge, ChallengeId } from '@/core/domain/entities/Challenge';
import { isChallengeUnlocked, isLevelUnlocked } from '@/core/domain/entities/ChallengeProgress';
import { followsPath, targetGeometry } from '@/core/domain/services/challengeTarget';
import { evaluateCheck, type ChallengeEvalContext } from '@/core/application/services/ChallengeCheckEvaluator';
import { crashFrame, simulateCommands } from '@/lib/simulateCommands';
import { parseRoverCode } from '@/lib/parseRoverCode';
import type { SimulationCommand } from '@/lib/roverBlockly';

const tests = CHALLENGE_LEVELS.map((level) => CHALLENGES[level.testId]);
const codeTests = tests.filter((t) => t.workspaceKind !== 'embedded-platform');

/** The context a run of these commands would give the checks, as the workspace builds it. */
function runContext(challenge: Challenge, commands: SimulationCommand[], code = ''): ChallengeEvalContext {
  const run = simulateCommands(commands);
  const path = run.map(({ x, y }) => ({ x, y }));
  const geometry = challenge.target ? targetGeometry(challenge.target) : null;
  return {
    runPath: path,
    runEnd: path[path.length - 1],
    runCrashed: crashFrame(run) >= 0,
    target: geometry,
    targetGoal: geometry?.goal ?? null,
    generatedCode: code,
    trajectoryOutcomes: [],
  };
}

function passes(challenge: Challenge, context: ChallengeEvalContext): boolean {
  return challenge.steps.every((step) => step.checks.every((check) => evaluateCheck(check, context)));
}

/** Passes every check that reads the run, ignoring the ones that read the code. */
function runPasses(challenge: Challenge, context: ChallengeEvalContext): boolean {
  return challenge.steps.every((step) =>
    step.checks.filter((c) => c.kind !== 'code-contains').every((check) => evaluateCheck(check, context)),
  );
}

describe('every level ends in a test (AB#446)', () => {
  it.each(CHALLENGE_LEVELS.map((l) => [l.id, l] as const))('level %s ends with its test', (_, level) => {
    expect(level.challengeIds[level.challengeIds.length - 1]).toBe(level.testId);
    // Tutorial first, then the test.
    expect(level.challengeIds.length).toBeGreaterThan(1);
  });

  it.each(tests.map((t) => [t.id, t] as const))('%s gives the goal only', (_, test) => {
    expect(test.steps).toHaveLength(1);
    const [step] = test.steps;
    expect(step.hints ?? []).toEqual([]);
    expect(step.prediction).toBeUndefined();
    // No code handed over: no ready-made program, and no code lines in the goal.
    expect(test.starterBlocks).toBeUndefined();
    expect(test.starterCode).toBeUndefined();
    expect(step.instructions).not.toContain('\n');
    expect(step.instructions).not.toMatch(/rover\.|time\.sleep|take_photo/);
    expect(step.checks.length).toBeGreaterThan(0);
  });

  it.each(codeTests.map((t) => [t.id, t] as const))('%s can be passed by its own reference program', (_, test) => {
    expect(test.target).toBeDefined();
    expect(runPasses(test, runContext(test, test.target!.commands))).toBe(true);
  });

  it.each(codeTests.map((t) => [t.id, t] as const))('%s is not passed by doing nothing', (_, test) => {
    expect(runPasses(test, runContext(test, []))).toBe(false);
  });

  it.each(codeTests.map((t) => [t.id, t] as const))(
    '%s asks for something its own tutorials did not draw',
    (_, test) => {
      const level = CHALLENGE_LEVELS.find((l) => l.id === test.levelId)!;
      const testPath = targetGeometry(test.target!).path;
      for (const id of level.challengeIds.filter((c) => c !== test.id)) {
        const tutorial = CHALLENGES[id];
        if (!tutorial.target) continue;
        expect(followsPath(targetGeometry(tutorial.target).path, testPath, 6)).toBe(false);
      }
    },
  );
});

describe('the tests named in AB#446', () => {
  it('the line level asks for two lines, and one line does not pass', () => {
    const test = CHALLENGES['two-lines'];
    const oneLine: SimulationCommand[] = [{ command: 'forward', speed: 60, duration: 3 }];
    expect(passes(test, runContext(test, oneLine))).toBe(false);
  });

  it('the square level asks for a rectangle - a loop whose sides are not all equal', () => {
    const test = CHALLENGES['draw-a-rectangle'];
    const sides = test.target!.commands.filter((c) => c.command === 'forward').map((c) => c.duration);
    expect(new Set(sides).size).toBeGreaterThan(1);
    expect(test.steps[0].checks).toContainEqual({ kind: 'code-contains', pattern: 'for _ in range(' });
  });

  it('a rectangle in Python, with corners timed by hand as Level 3 teaches, passes', () => {
    const test = CHALLENGES['draw-a-rectangle'];
    const code = [
      'for _ in range(2):',
      '    rover.forward(60)',
      '    time.sleep(3)',
      '    rover.spinRight(60)',
      '    time.sleep(2)',
      '    rover.forward(60)',
      '    time.sleep(1.5)',
      '    rover.spinRight(60)',
      '    time.sleep(2)',
      'rover.stop()',
    ].join('\n');
    expect(passes(test, runContext(test, parseRoverCode(code), code))).toBe(true);
  });

  it("a square - the level's tutorial shape - does not pass the rectangle test", () => {
    const test = CHALLENGES['draw-a-rectangle'];
    const square = CHALLENGES['draw-a-square'].target!.commands;
    expect(runPasses(test, runContext(test, square))).toBe(false);
  });

  it('the rectangle without a loop does not pass, even when it draws the shape', () => {
    const test = CHALLENGES['draw-a-rectangle'];
    expect(passes(test, runContext(test, test.target!.commands, 'rover.forward(60)'))).toBe(false);
  });
});

describe('a level test opens after its tutorials, and the next level after the test', () => {
  const level1 = CHALLENGE_LEVELS[0];
  const tutorials = level1.challengeIds.filter((id) => id !== level1.testId);
  const done = (ids: ChallengeId[]) => ({
    completions: ids.map((challengeId) => ({ challengeId, completedAt: '2026-10-06' })),
  });

  it('the test is locked until every tutorial in its level is done', () => {
    expect(isChallengeUnlocked(level1.testId, CHALLENGE_LEVELS, done(tutorials.slice(0, -1)))).toBe(false);
    expect(isChallengeUnlocked(level1.testId, CHALLENGE_LEVELS, done(tutorials))).toBe(true);
  });

  it('tutorials are open as soon as their level is', () => {
    for (const id of tutorials) expect(isChallengeUnlocked(id, CHALLENGE_LEVELS, done([]))).toBe(true);
  });

  it('the next level stays locked until the test passes', () => {
    expect(isLevelUnlocked(2, CHALLENGE_LEVELS, done(tutorials))).toBe(false);
    expect(isLevelUnlocked(2, CHALLENGE_LEVELS, done([...tutorials, level1.testId]))).toBe(true);
  });

  it('nothing in a locked level is open, the test included', () => {
    const level2 = CHALLENGE_LEVELS[1];
    for (const id of level2.challengeIds) expect(isChallengeUnlocked(id, CHALLENGE_LEVELS, done([]))).toBe(false);
  });
});

describe('the levels after Level 3 (AB#445)', () => {
  const later = CHALLENGE_LEVELS.filter((l) => l.id > 3);

  it('adds at least two, each with outcomes', () => {
    expect(later.length).toBeGreaterThanOrEqual(2);
    for (const level of later) expect(level.outcomes.length).toBeGreaterThanOrEqual(2);
  });

  it('builds at least one around a NASA-style mission', () => {
    expect(later.some((level) => level.outcomes.every((o) => o.alignment.nasaJpl))).toBe(true);
  });

  it('starts the hazard level with a route that really does hit a rock', () => {
    const tutorial = CHALLENGES['spot-the-hazard'];
    const starter = parseRoverCode(tutorial.starterCode!);
    const context = runContext(tutorial, starter);
    expect(context.runCrashed).toBe(true);
    expect(evaluateCheck({ kind: 'avoids-hazards' }, context)).toBe(false);
    // ...and its own answer is safe.
    expect(runContext(tutorial, tutorial.target!.commands).runCrashed).toBe(false);
  });

  it('does not pass the hazard test by driving straight at the target through the rock', () => {
    const test = CHALLENGES['hazard-test'];
    const throughTheRock: SimulationCommand[] = [
      { command: 'spinLeft', speed: 60, duration: 2 },
      { command: 'forward', speed: 60, duration: 6 },
    ];
    expect(passes(test, runContext(test, throughTheRock))).toBe(false);
  });

  it('only counts a sample taken in code', () => {
    const test = CHALLENGES['sample-run-test'];
    const route = test.target!.commands;
    expect(passes(test, runContext(test, route, 'rover.stop()'))).toBe(false);
    expect(passes(test, runContext(test, route, 'rover.stop()\ntake_photo()'))).toBe(true);
  });
});
