/**
 * @jest-environment jsdom
 */

/**
 * Going from Blocks to Python (AB#455).
 *
 * The phone has no Show as Python button, so the tab switch carries the
 * blocks across itself. The rule under test is the one that makes that safe:
 * a draft the learner wrote is never replaced, only an empty one or one that
 * is still exactly what the blocks last put there.
 */

import { carryBlocksToPython, showBlocksAsPython, PYTHON_DRAFT_KEY } from '@/infrastructure/browser/pythonDraft';

const draft = () => localStorage.getItem(PYTHON_DRAFT_KEY);

beforeEach(() => localStorage.clear());

it('fills an empty draft with the blocks', () => {
  expect(carryBlocksToPython('rover.forward(60)\n')).toBe(true);
  expect(draft()).toBe('rover.forward(60)\n');
});

it('keeps following the blocks while nobody has edited the copy', () => {
  carryBlocksToPython('rover.forward(60)\n');
  expect(carryBlocksToPython('rover.reverse(60)\n')).toBe(true);
  expect(draft()).toBe('rover.reverse(60)\n');
});

it('never replaces code the learner wrote', () => {
  carryBlocksToPython('rover.forward(60)\n');
  localStorage.setItem(PYTHON_DRAFT_KEY, '# mine\nrover.forward(60)\n');
  expect(carryBlocksToPython('rover.reverse(60)\n')).toBe(false);
  expect(draft()).toBe('# mine\nrover.forward(60)\n');
});

it('never replaces a draft that predates this, with no record of the blocks', () => {
  localStorage.setItem(PYTHON_DRAFT_KEY, '# from last week\n');
  expect(carryBlocksToPython('rover.reverse(60)\n')).toBe(false);
});

it('does nothing for an empty workspace', () => {
  localStorage.setItem(PYTHON_DRAFT_KEY, '# mine\n');
  expect(carryBlocksToPython('  \n')).toBe(false);
  expect(draft()).toBe('# mine\n');
});

it('lets Show as Python overwrite on request, and later switches follow it', () => {
  localStorage.setItem(PYTHON_DRAFT_KEY, '# mine\n');
  showBlocksAsPython('rover.forward(60)\n');
  expect(draft()).toBe('rover.forward(60)\n');
  expect(carryBlocksToPython('rover.reverse(60)\n')).toBe(true);
});
