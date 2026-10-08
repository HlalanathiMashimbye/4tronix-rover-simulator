/**
 * @jest-environment jsdom
 */

/**
 * Feedback on a test (AB#448): which checks a run passed, and what the open
 * ones are still missing - without the answer.
 *
 * Runs go through the real physics, so "stopped before the target" is what a
 * run that stops before the target actually produces, not a hand-made point.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { explainOpenCheck } from '@/components/challenges/describeCheck';
import { evaluateCheck, type ChallengeEvalContext } from '@/core/application/services/ChallengeCheckEvaluator';
import { targetGeometry } from '@/core/domain/services/challengeTarget';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { simulateCommands } from '@/lib/simulateCommands';
import { spinSecondsForDegrees } from '@/lib/rover-physics';
import type { Challenge } from '@/core/domain/entities/Challenge';
import type { SimulationCommand } from '@/lib/roverBlockly';

const f = (s: number): SimulationCommand => ({ command: 'forward', speed: 60, duration: s });
const right = (deg = 90): SimulationCommand => ({ command: 'spinRight', speed: 60, duration: spinSecondsForDegrees(deg, 60) });
const left = (deg = 90): SimulationCommand => ({ command: 'spinLeft', speed: 60, duration: spinSecondsForDegrees(deg, 60) });

function context(challenge: Challenge, commands: SimulationCommand[], code = ''): ChallengeEvalContext {
  const run = simulateCommands(commands);
  const path = run.map(({ x, y }) => ({ x, y }));
  const geometry = challenge.target ? targetGeometry(challenge.target) : null;
  return {
    runPath: path,
    runEnd: path[path.length - 1],
    runCrashed: findCrash(run) !== null,
    runCrashInto: findCrash(run)?.into ?? null,
    target: geometry,
    targetGoal: geometry?.goal ?? null,
    generatedCode: code,
  };
}

/** Every open check's explanation for a run, in step order. */
function feedback(challenge: Challenge, ctx: ChallengeEvalContext): (string | null)[] {
  return challenge.steps.flatMap((step) =>
    step.checks.map((check) => explainOpenCheck(check, ctx, evaluateCheck(check, ctx))),
  );
}

const rectangle = CHALLENGES['draw-a-rectangle'];
const site = CHALLENGES['sample-site'];
const rectangleRun = rectangle.target!.commands;

describe('what an open check says (AB#448)', () => {
  it('the right shape without a loop: shape done, loop named as missing', () => {
    const ctx = context(rectangle, rectangleRun, 'rover.forward(60)');
    expect(feedback(rectangle, ctx)).toEqual(['Your program does not use a loop yet.', null]);
  });

  it('a loop that draws only part of the shape says it stopped before finishing', () => {
    const ctx = context(rectangle, [f(3), right(), f(1.5)], 'for _ in range(1):');
    expect(feedback(rectangle, ctx)[1]).toBe('Your rover drew part of the shape, then stopped before finishing it.');
  });

  it('a run that leaves the shape says so', () => {
    // Right, not left: a left turn here drives into rock R4, which the
    // feedback rightly reports as the rock instead.
    const ctx = context(rectangle, [f(3), right(), f(3)], 'for _ in range(2):');
    expect(feedback(rectangle, ctx)[1]).toBe('Part of your run goes off the target shape.');
  });

  it('a run into the wall names the wall', () => {
    const ctx = context(rectangle, [f(20)], 'for _ in range(2):');
    expect(feedback(rectangle, ctx)[1]).toBe('Your rover hit the wall before it finished the shape.');
  });

  it.each([
    ['stopped on the way', [f(3), right(), f(0.5)], 'Your rover stopped before the target.'],
    ['overshot the last leg', [f(3), right(), f(4)], 'Your rover went past the target.'],
    ['turned the wrong way', [f(3), right(45), f(2)], 'Your rover went a different way and stopped away from the target.'],
  ] as const)('a sample-site run that %s says where it stopped', (_, run, expected) => {
    const reach = site.steps[0];
    const ctx = context(site, [...run]);
    const [check] = reach.checks;
    expect(explainOpenCheck(check, ctx, evaluateCheck(check, ctx))).toBe(expected);
  });

  it('says nothing before the first run, and nothing for a check that passed', () => {
    const [loop] = rectangle.steps[0].checks;
    expect(explainOpenCheck(loop, { generatedCode: '' }, false)).toBeNull();
    const ctx = context(rectangle, rectangleRun, 'for _ in range(2):');
    expect(feedback(rectangle, ctx)).toEqual([null, null]);
  });

  it('never gives the answer: no code, no numbers, no "failed"', () => {
    const runs: SimulationCommand[][] = [[f(1)], [f(20)], [f(3), left(), f(2)], [f(3), right(), f(4)], rectangleRun];
    for (const challenge of Object.values(CHALLENGES)) {
      for (const run of runs) {
        for (const text of feedback(challenge, context(challenge, run))) {
          if (!text) continue;
          expect(text).not.toMatch(/rover\.|sleep|for _|range\(|take_photo|\d|fail/i);
        }
      }
    }
  });
});

// The workspace, with the editor and simulator stubbed to what they report.
type PanelProps = {
  onCodeChange: (code: string) => void;
  onRun?: (run: { path: { x: number; y: number }[]; crashed: boolean; crashInto: 'rock' | 'wall' | null }) => void;
};
let panel: PanelProps;
jest.mock('@/components/challenges/ChallengeCenterPanel', () => ({
  ChallengeCenterPanel: (props: PanelProps) => {
    panel = props;
    return null;
  },
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ query: '', activeFilter: 'all' }) }));
const completeChallenge = jest.fn().mockResolvedValue(null);
jest.mock('@/hooks/useChallengeProgress', () => ({ useChallengeProgress: () => ({ completeChallenge }) }));
jest.mock('@/infrastructure/browser/challengeHandoff', () => ({ writeChallengeHandoff: jest.fn() }));
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  readMilestones: () => ({ visitedRoutes: [], missionCreated: false }),
}));

import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

function run(commands: SimulationCommand[], code: string) {
  const trajectory = simulateCommands(commands);
  const crash = findCrash(trajectory);
  act(() => {
    panel.onCodeChange(code);
    panel.onRun?.({ path: trajectory.map(({ x, y }) => ({ x, y })), crashed: crash !== null, crashInto: crash?.into ?? null });
  });
}

describe('the rectangle test, as a learner sees it', () => {
  it('ticks the shape, leaves the loop open, and names it - and cannot be finished', () => {
    render(<ChallengeWorkspace challenge={rectangle} />);
    run(rectangleRun, 'rover.forward(60)');

    const checklist = screen.getByRole('list', { name: 'Mission checklist' });
    expect(checklist).toHaveTextContent('Draw the target shape - done');
    expect(checklist).toHaveTextContent('Repeat the movement in a loop - not done yet');
    expect(screen.getByRole('list', { name: 'Still to do' })).toHaveTextContent('Your program does not use a loop yet.');

    // AB#449: an attempt that does not pass earns nothing - it cannot be finished.
    const finish = screen.getByRole('button', { name: /Finish/ });
    expect(finish).toBeDisabled();
    fireEvent.click(finish);
    expect(completeChallenge).not.toHaveBeenCalled();

    expect(document.body.textContent).not.toMatch(/fail/i);
  });

  it('passes once every check does, the concept included', () => {
    render(<ChallengeWorkspace challenge={rectangle} />);
    run(rectangleRun, 'for _ in range(2):\n    rover.forward(60)');

    expect(screen.queryByRole('list', { name: 'Still to do' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finish/ })).toBeEnabled();
  });
});

it('a sample-site run that turns into the rock says it hit a rock, before anything about the target', () => {
  const [check] = site.steps[0].checks;
  const ctx = context(site, [f(3), left(), f(2)]);
  expect(explainOpenCheck(check, ctx, evaluateCheck(check, ctx))).toBe('Your rover hit a rock before it reached the target.');
});
