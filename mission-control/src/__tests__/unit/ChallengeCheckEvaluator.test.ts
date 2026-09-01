/**
 * One case per ChallengeCheckSpec kind - each check is a small pure function
 * of a context snapshot, so these run against plain fixture contexts with no
 * mocks or rendering.
 */

import { evaluateCheck, stepChecksPass, ChallengeEvalContext } from '@/core/application/services/ChallengeCheckEvaluator';
import { ChallengeCheckSpec } from '@/core/domain/entities/Challenge';

describe('evaluateCheck', () => {
  it('search-query passes on any non-empty query when no match text is given', () => {
    const spec: ChallengeCheckSpec = { kind: 'search-query' };
    expect(evaluateCheck(spec, { search: { query: '', activeFilter: 'all' } })).toBe(false);
    expect(evaluateCheck(spec, { search: { query: 'lunar', activeFilter: 'all' } })).toBe(true);
  });

  it('search-query requires the given substring, case-insensitively', () => {
    const spec: ChallengeCheckSpec = { kind: 'search-query', matches: 'Lunar' };
    expect(evaluateCheck(spec, { search: { query: 'a lunar rover', activeFilter: 'all' } })).toBe(true);
    expect(evaluateCheck(spec, { search: { query: 'a solar rover', activeFilter: 'all' } })).toBe(false);
  });

  it('search-filter matches the active filter key exactly', () => {
    const spec: ChallengeCheckSpec = { kind: 'search-filter', filterKey: 'Pending' };
    expect(evaluateCheck(spec, { search: { query: '', activeFilter: 'Pending' } })).toBe(true);
    expect(evaluateCheck(spec, { search: { query: '', activeFilter: 'all' } })).toBe(false);
  });

  it('load-more only passes once the callback has actually fired', () => {
    const spec: ChallengeCheckSpec = { kind: 'load-more' };
    expect(evaluateCheck(spec, {})).toBe(false);
    expect(evaluateCheck(spec, { loadMoreCalled: false })).toBe(false);
    expect(evaluateCheck(spec, { loadMoreCalled: true })).toBe(true);
  });

  it('code-contains matches a substring of the generated Python', () => {
    const spec: ChallengeCheckSpec = { kind: 'code-contains', pattern: 'rover.getDistance()' };
    expect(evaluateCheck(spec, { generatedCode: 'rover.forward(60)' })).toBe(false);
    expect(evaluateCheck(spec, { generatedCode: "print('Distance: ' + str(rover.getDistance()))" })).toBe(
      true,
    );
  });

  it('trajectory-outcome checks the last simulated run', () => {
    const spec: ChallengeCheckSpec = { kind: 'trajectory-outcome', outcome: 'spun-right' };
    expect(evaluateCheck(spec, { trajectoryOutcomes: ['moved-forward'] })).toBe(false);
    expect(evaluateCheck(spec, { trajectoryOutcomes: ['moved-forward', 'spun-right'] })).toBe(true);
  });
});

describe('stepChecksPass', () => {
  it('requires every check in the step to pass', () => {
    const checks: ChallengeCheckSpec[] = [
      { kind: 'search-filter', filterKey: 'Pending' },
      { kind: 'search-query' },
    ];
    const partial: ChallengeEvalContext = { search: { query: '', activeFilter: 'Pending' } };
    const full: ChallengeEvalContext = { search: { query: 'lunar', activeFilter: 'Pending' } };

    expect(stepChecksPass(checks, partial)).toBe(false);
    expect(stepChecksPass(checks, full)).toBe(true);
  });

  it('an empty check list trivially passes', () => {
    expect(stepChecksPass([], {})).toBe(true);
  });
});
