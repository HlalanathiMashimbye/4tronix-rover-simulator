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

  it('load-more passes once the callback has actually fired', () => {
    const spec: ChallengeCheckSpec = { kind: 'load-more' };
    expect(evaluateCheck(spec, {})).toBe(false);
    expect(evaluateCheck(spec, { loadMoreCalled: false })).toBe(false);
    expect(evaluateCheck(spec, { loadMoreCalled: true })).toBe(true);
  });

  it('load-more also passes when the feed has confirmed there is nothing further to load', () => {
    const spec: ChallengeCheckSpec = { kind: 'load-more' };
    // Not yet known (still loading, or MissionFeed hasn't reported) must NOT
    // auto-pass - only an explicit false does, per a small database having
    // no "Show more missions" button to click in the first place.
    expect(evaluateCheck(spec, { feedHasMore: undefined })).toBe(false);
    expect(evaluateCheck(spec, { feedHasMore: true })).toBe(false);
    expect(evaluateCheck(spec, { feedHasMore: false })).toBe(true);
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

describe('checks about what happened on another page', () => {
  /**
   * These two are unlike every other kind: the thing they ask about happened
   * while the challenge workspace was unmounted. The workspace supplies the
   * facts from platformMilestones; this service must stay able to answer
   * without a browser, which is what these fixtures prove.
   */
  it('passes once the learner has opened the page', () => {
    const spec = { kind: 'route-visited', path: '/history' } as const;

    expect(evaluateCheck(spec, { visitedRoutes: ['/history', '/leaderboard'] })).toBe(true);
    expect(evaluateCheck(spec, { visitedRoutes: ['/leaderboard'] })).toBe(false);
  });

  it('fails when nothing has been recorded at all', () => {
    expect(evaluateCheck({ kind: 'route-visited', path: '/history' }, {})).toBe(false);
    expect(evaluateCheck({ kind: 'mission-created' }, {})).toBe(false);
  });

  it('wants the exact page, not one that merely starts the same way', () => {
    /**
     * '/missions' is the feed and '/mission' is Create Mission - two different
     * pages one character apart. A substring match here would tick the
     * "open Create Mission" step for a learner who only browsed the feed.
     */
    expect(evaluateCheck({ kind: 'route-visited', path: '/mission' }, { visitedRoutes: ['/missions'] })).toBe(false);
    expect(evaluateCheck({ kind: 'route-visited', path: '/mission' }, { visitedRoutes: ['/mission'] })).toBe(true);
  });

  it('passes mission-created only once a mission has actually been sent', () => {
    expect(evaluateCheck({ kind: 'mission-created' }, { missionCreated: true })).toBe(true);
    expect(evaluateCheck({ kind: 'mission-created' }, { missionCreated: false })).toBe(false);
  });
});
