/**
 * Challenge targets (AB#447) and the drive-to-the-target PRIMM challenge
 * (AB#453), measured through the same physics a learner's run goes through.
 *
 * The numbers here are the ones a child meets: the ready-made code must stop
 * visibly short, the ring must accept the half-second steps the Move Forward
 * block allows around the answer and nothing further, and nothing in the
 * mission may turn. Each is computed, not restated, so retuning the rover's
 * measured speed or the content fails here before a learner finds a target
 * nobody can hit.
 */

import { CHALLENGES } from '@/infrastructure/config/challenges';
import { endsOnGoal, targetGeometry } from '@/core/domain/services/challengeTarget';
import { evaluateCheck } from '@/core/application/services/ChallengeCheckEvaluator';
import { simulateCommands } from '@/lib/simulateCommands';

const drive = CHALLENGES['drive-to-target'];
const geometry = targetGeometry(drive.target!);

/** Where a Blockly "Move Forward N seconds" program ends, exactly as the editor emits it. */
function endAfterForward(seconds: number) {
  const run = simulateCommands([{ command: 'forward', speed: 60, duration: seconds }]);
  return run[run.length - 1];
}

type StarterBlock = { type: string; fields?: { TIME?: number }; inputs?: { DO?: { block: StarterBlock } }; next?: { block: StarterBlock } };

/** Every block in the starter program, walking the uplink's DO and each block's next. */
function starterBlocks(): StarterBlock[] {
  const top = (drive.starterBlocks as { blocks: { blocks: StarterBlock[] } }).blocks.blocks;
  const all: StarterBlock[] = [];
  const walk = (block?: StarterBlock) => {
    if (!block) return;
    all.push(block);
    walk(block.inputs?.DO?.block);
    walk(block.next?.block);
  };
  top.forEach(walk);
  return all;
}

describe('the drive-to-target challenge (AB#453)', () => {
  it('has a goal straight ahead of the start mark', () => {
    expect(geometry.goal).not.toBeNull();
    expect(Math.abs(geometry.goal!.x)).toBeLessThan(0.5);
    expect(geometry.goal!.y).toBeGreaterThan(20);
    for (const point of geometry.path) expect(Math.abs(point.x)).toBeLessThan(0.5);
  });

  it('starts with ready-made code that stops visibly short of the target', () => {
    const forward = starterBlocks().find((b) => b.type === 'rover_forward');
    expect(forward?.fields?.TIME).toBeDefined();

    const end = endAfterForward(forward!.fields!.TIME!);
    expect(endsOnGoal(end, geometry.goal)).toBe(false);
    // Short, not past it: the instructions say "the rover stopped before the target".
    expect(geometry.goal!.y - end.y).toBeGreaterThan(10);
  });

  it.each([4.5, 5, 5.5])('counts %s seconds as reaching the target', (seconds) => {
    expect(endsOnGoal(endAfterForward(seconds), geometry.goal)).toBe(true);
  });

  it.each([4, 6])('does not count %s seconds', (seconds) => {
    expect(endsOnGoal(endAfterForward(seconds), geometry.goal)).toBe(false);
  });

  it('has no turning anywhere: not in the starter, not in the target', () => {
    expect(starterBlocks().map((b) => b.type).sort()).toEqual(['rover_forward', 'rover_on_receive']);
    expect(drive.target!.commands.every((c) => c.command === 'forward')).toBe(true);
  });

  it('runs Predict, Run, Investigate and Modify, then Make, in that order', () => {
    expect(drive.steps.map((s) => s.checks.map((c) => c.kind))).toEqual([
      ['prediction-made'],
      ['trajectory-outcome'],
      ['reaches-target'],
      [],
    ]);
    // A straight line has to be one of the guesses, or the run can never match one.
    expect(drive.steps[0].prediction?.options).toContain('Drive in a straight line');
  });
});

describe('the square target (AB#447)', () => {
  it('draws a closed four-sided shape', () => {
    const square = targetGeometry(CHALLENGES['draw-a-square'].target!);
    const start = square.path[0];
    const end = square.path[square.path.length - 1];

    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(2);
    expect(square.goal).toBeNull();
  });
});

describe('the two new checks', () => {
  it('prediction-made passes for any answer, and only once one is given', () => {
    expect(evaluateCheck({ kind: 'prediction-made' }, {})).toBe(false);
    expect(evaluateCheck({ kind: 'prediction-made' }, { predictionMade: true })).toBe(true);
  });

  it('reaches-target needs a run that ended on the goal', () => {
    const targetGoal = geometry.goal;
    expect(evaluateCheck({ kind: 'reaches-target' }, { targetGoal })).toBe(false);
    expect(evaluateCheck({ kind: 'reaches-target' }, { targetGoal, runEnd: endAfterForward(3) })).toBe(false);
    expect(evaluateCheck({ kind: 'reaches-target' }, { targetGoal, runEnd: endAfterForward(5) })).toBe(true);
  });

  it('reaches-target never passes on a challenge with no goal', () => {
    expect(evaluateCheck({ kind: 'reaches-target' }, { targetGoal: null, runEnd: { x: 0, y: 0 } })).toBe(false);
  });
});
