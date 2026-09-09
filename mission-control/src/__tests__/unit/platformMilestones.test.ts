/**
 * @jest-environment jsdom
 */

/**
 * Tests for the record that survives navigation.
 *
 * The Level 1 challenges ask a learner to do something on another page, which
 * means the evidence has to outlive the challenge workspace unmounting. This
 * module is the only thing standing between "go and open History" and a step
 * that can never be completed, and every one of its failure modes is silent:
 * a wrong key, a route spelled with a trailing slash, storage throwing in
 * private browsing. None of those would show up as an error anywhere - the
 * tick just would not appear.
 */

import {
  normaliseRoute,
  readMilestones,
  recordMissionCreated,
  recordRouteVisit,
} from '@/infrastructure/browser/platformMilestones';

jest.mock('@/infrastructure/browser/getLearnerID', () => ({
  getLearnerID: jest.fn(() => 'learner-under-test'),
}));

import { getLearnerID } from '@/infrastructure/browser/getLearnerID';

beforeEach(() => {
  localStorage.clear();
  (getLearnerID as jest.Mock).mockReturnValue('learner-under-test');
});

describe('normaliseRoute', () => {
  it('treats a trailing slash and a query string as the same page', () => {
    expect(normaliseRoute('/history')).toBe('/history');
    expect(normaliseRoute('/history/')).toBe('/history');
    expect(normaliseRoute('/history?from=nav')).toBe('/history');
    expect(normaliseRoute('/history#top')).toBe('/history');
  });

  it('leaves the root path alone rather than emptying it', () => {
    expect(normaliseRoute('/')).toBe('/');
  });
});

describe('recording what the learner has done', () => {
  it('starts with nothing recorded', () => {
    expect(readMilestones()).toEqual({ visitedRoutes: [], missionCreated: false });
  });

  it('remembers a visited route across reads', () => {
    recordRouteVisit('/history');
    expect(readMilestones().visitedRoutes).toContain('/history');
  });

  it('records the same page once however it is spelled', () => {
    recordRouteVisit('/history');
    recordRouteVisit('/history/');
    recordRouteVisit('/history?from=nav');

    expect(readMilestones().visitedRoutes).toEqual(['/history']);
  });

  it('keeps earlier visits when a new one is added', () => {
    recordRouteVisit('/history');
    recordRouteVisit('/leaderboard');

    expect(readMilestones().visitedRoutes).toEqual(['/history', '/leaderboard']);
  });

  it('remembers that a mission was sent', () => {
    expect(readMilestones().missionCreated).toBe(false);
    recordMissionCreated();
    expect(readMilestones().missionCreated).toBe(true);
  });

  it('does not lose visited routes when a mission is recorded', () => {
    recordRouteVisit('/history');
    recordMissionCreated();

    const after = readMilestones();
    expect(after.visitedRoutes).toEqual(['/history']);
    expect(after.missionCreated).toBe(true);
  });
});

describe('one device, more than one learner', () => {
  it('does not hand a second learner the first one’s progress', () => {
    /**
     * The yard runs on shared classroom machines. An unkeyed record would show
     * the next child every tick the previous one earned, and they would be
     * credited with a platform tour they never took.
     */
    recordRouteVisit('/history');
    recordMissionCreated();

    (getLearnerID as jest.Mock).mockReturnValue('a-different-learner');

    expect(readMilestones()).toEqual({ visitedRoutes: [], missionCreated: false });
  });

  it('gives the first learner their record back when they return', () => {
    recordRouteVisit('/history');
    (getLearnerID as jest.Mock).mockReturnValue('a-different-learner');
    recordRouteVisit('/leaderboard');
    (getLearnerID as jest.Mock).mockReturnValue('learner-under-test');

    expect(readMilestones().visitedRoutes).toEqual(['/history']);
  });
});

describe('when storage misbehaves', () => {
  it('reports nothing recorded rather than throwing, so a check fails closed', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => readMilestones()).not.toThrow();
    expect(readMilestones()).toEqual({ visitedRoutes: [], missionCreated: false });

    getItem.mockRestore();
  });

  it('does not break the page the learner is on when a write fails', () => {
    /**
     * Private browsing and a full quota both throw on setItem. Recording a
     * milestone is a convenience for the challenge track; the mission the
     * learner just sent matters more than the tick for having sent it.
     */
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => recordRouteVisit('/history')).not.toThrow();
    expect(() => recordMissionCreated()).not.toThrow();

    setItem.mockRestore();
  });

  it('survives a corrupt entry rather than crashing the workspace', () => {
    localStorage.setItem('rover-platform-milestones:learner-under-test', 'not json');

    expect(readMilestones()).toEqual({ visitedRoutes: [], missionCreated: false });
  });
});
