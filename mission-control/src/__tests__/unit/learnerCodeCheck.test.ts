/**
 * What the editor tells a learner while they type (AB#348).
 *
 * The story exists because of one mission. "Elsje" contained
 * rover.forward(6300) - a speed of 6300 where the hardware takes 0 to 100. It
 * passed every check, was queued, and the rover refused to run it. The learner
 * was never told anything was wrong, and the operator saw a mission that simply
 * never moved.
 *
 * The rule to catch it already existed server-side. The editor was not asking.
 */

import {
  checkLearnerCode,
  closestCommand,
  findSyntaxProblems,
} from '@/lib/learnerCodeCheck';

describe('the mission that started this', () => {
  it('catches the speed that reached the yard, on the right line', () => {
    const problems = checkLearnerCode(
      'rover.setServo(9, 0)\nrover.forward(6300)\ntime.sleep(1.5)\nrover.stop()',
    );

    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(2);
  });

  it('says what to do, not that the learner is wrong', () => {
    const [problem] = checkLearnerCode('rover.forward(6300)');

    // The rule, then the fix. "Invalid argument" tells a nine-year-old they
    // failed at something; this tells them what number to type.
    expect(problem.message).toContain('goes from 0 to 100');
    expect(problem.message).toContain('rover.forward(100)');
    expect(problem.message).not.toMatch(/invalid|illegal|error/i);
  });

  it('leaves a speed the rover can actually do alone', () => {
    expect(checkLearnerCode('rover.forward(60)\ntime.sleep(1)\nrover.stop()')).toEqual([]);
  });
});

describe('a mistyped command', () => {
  it('offers the command they meant', () => {
    const [problem] = checkLearnerCode('rover.forwrd(50)');

    expect(problem.message).toContain('Did you mean rover.forward?');
  });

  it('does not recite all nineteen commands at a child', () => {
    // The underlying message lists the entire allowlist in one line, which is
    // a wall of text rather than an answer.
    const [problem] = checkLearnerCode('rover.forwrd(50)');

    expect(problem.message).not.toContain('rover.setPixel');
    expect(problem.message.length).toBeLessThan(120);
  });

  it('stays quiet about a suggestion when nothing is close', () => {
    // Guessing "rover.forward" for someone who typed "rover.teleport" would be
    // worse than saying nothing.
    expect(closestCommand('rover.teleport')).toBeNull();
    expect(closestCommand('rover.forwrd')).toBe('rover.forward');
  });
});

describe('syntax, which had no checking at all', () => {
  it('finds a bracket that never closes', () => {
    const [problem] = findSyntaxProblems('rover.forward(50\ntime.sleep(1)');

    expect(problem.line).toBe(1);
    expect(problem.message).toContain('never closed');
  });

  it('finds a quote that never closes', () => {
    const [problem] = findSyntaxProblems("print('hello)");

    expect(problem.line).toBe(1);
    expect(problem.message).toContain('never closes it');
  });

  it('ignores brackets inside strings, which a counter gets wrong', () => {
    expect(findSyntaxProblems('print("a ( inside a string")')).toEqual([]);
  });

  it('ignores brackets inside comments', () => {
    expect(findSyntaxProblems('rover.stop()  # a ( here is just a comment')).toEqual([]);
  });

  it('accepts ordinary nested code', () => {
    expect(
      findSyntaxProblems('for i in range(3):\n    rover.forward(60)\n    time.sleep(1)'),
    ).toEqual([]);
  });
});

describe('which problem gets reported first', () => {
  it('reports the missing bracket rather than a command that looks unknown', () => {
    // A broken line confuses the pattern matcher too. Telling somebody their
    // command does not exist, when the real problem is a bracket, sends them
    // looking in the wrong place.
    const problems = checkLearnerCode('rover.forward(50\nrover.stop()');

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('never closed');
  });

  it('orders problems by line so the first one to fix is first', () => {
    const problems = checkLearnerCode('rover.stop()\nrover.forward(900)\nrover.spinLeft(700)');

    expect(problems.map((p) => p.line)).toEqual([2, 3]);
  });
});
