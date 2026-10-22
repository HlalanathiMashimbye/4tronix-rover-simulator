/**
 * @jest-environment jsdom
 */

/**
 * Getting back to a challenge from the page it sent you to.
 *
 * Level 1 sends learners to History, the Leaderboard and Create Mission. These
 * hold the way back to what they were told: an offer on the page they went
 * to, landing on the step they left rather than the briefing, and nothing to
 * return to once the challenge is finished.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { CHALLENGES } from '@/infrastructure/config/challenges';

let learner = 'learner-a';
jest.mock('@/infrastructure/browser/getLearnerID', () => ({ getLearnerID: () => learner }));

let pathname = '/history';
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The workspace, with everything outside the step navigation stubbed.
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ query: '', activeFilter: 'all' }) }));
const completeChallenge = jest.fn().mockResolvedValue(null);
jest.mock('@/hooks/useChallengeProgress', () => ({ useChallengeProgress: () => ({ completeChallenge }) }));
jest.mock('@/infrastructure/browser/challengeHandoff', () => ({ writeChallengeHandoff: jest.fn() }));
const VISITED = { visitedRoutes: ['/history', '/leaderboard'], missionCreated: true };
let milestones = VISITED;
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  ...jest.requireActual('@/infrastructure/browser/platformMilestones'),
  readMilestones: () => milestones,
}));
jest.mock('@/components/challenges/ChallengeCenterPanel', () => ({ ChallengeCenterPanel: () => null }));

import {
  clearActiveChallenge,
  readActiveChallenge,
  recordActiveChallenge,
} from '@/infrastructure/browser/activeChallenge';
import { PersistentChallengePanel } from '@/components/challenges/PersistentChallengePanel';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';
import { ChallengeBriefingGate } from '@/components/challenges/ChallengeBriefing';

// "Explore the Platform": step 1 opens History, step 2 the Leaderboard.
const explore = CHALLENGES['explore-the-platform'];
const historyStep = explore.steps.findIndex((s) => s.checks.some((c) => c.kind === 'route-visited' && c.path === '/history'));

beforeEach(() => {
  sessionStorage.clear();
  learner = 'learner-a';
  pathname = '/history';
  milestones = VISITED;
});

describe('the record of the challenge in progress', () => {
  it('is only ever read back for the learner who made it', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: 1 });
    expect(readActiveChallenge()).toEqual({ challengeId: explore.id, stepIndex: 1 });

    // A shared classroom machine: the next child must not be offered it.
    learner = 'learner-b';
    expect(readActiveChallenge()).toBeNull();
  });
});

describe('the persistent challenge panel', () => {
  it('shows the full instructions panel with the step title on non-challenge pages', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    render(<PersistentChallengePanel />);

    expect(screen.getByRole('heading', { name: explore.steps[historyStep].title })).toBeInTheDocument();
  });

  it('evaluates route-visited checks against recorded milestones', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    render(<PersistentChallengePanel />);

    // The mock readMilestones returns visitedRoutes: ['/history', '/leaderboard'],
    // so route-visited checks for /history should be done.
    const doneItems = screen.getAllByText(/done/);
    expect(doneItems.length).toBeGreaterThan(0);
  });

  it.each(['/challenges', `/challenges/${explore.id}`, '/operator'])('is not shown on %s', (path) => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: 0 });
    pathname = path;
    render(<PersistentChallengePanel />);
    expect(screen.queryByText(explore.steps[0].title)).not.toBeInTheDocument();
  });

  it('is not shown when there is no challenge in progress', () => {
    render(<PersistentChallengePanel />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('moves on by itself a few seconds after the step turns done on the page', () => {
    jest.useFakeTimers();
    try {
      // The learner opens History; MilestoneTracker records the visit just
      // after the panel's first read, and its second read turns the check green.
      milestones = { visitedRoutes: [], missionCreated: false };
      recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
      render(<PersistentChallengePanel />);
      milestones = VISITED;
      act(() => jest.advanceTimersByTime(50));
      expect(readActiveChallenge()?.stepIndex).toBe(historyStep);

      act(() => jest.advanceTimersByTime(3000));

      expect(readActiveChallenge()?.stepIndex).toBe(historyStep + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('advances the step when Next is clicked', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    render(<PersistentChallengePanel />);

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(readActiveChallenge()?.stepIndex).toBe(historyStep + 1);
  });
});

describe('coming back', () => {
  it('lands on the step the learner left, past the briefing', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: 1 });
    render(<ChallengeBriefingGate challenge={explore} />);

    expect(screen.queryByRole('button', { name: /Start Mission/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: explore.steps[1].title })).toBeInTheDocument();
  });

  it('shows the briefing as usual when this is not the challenge in progress', () => {
    recordActiveChallenge({ challengeId: 'platform-orientation', stepIndex: 1 });
    render(<ChallengeBriefingGate challenge={explore} />);
    expect(screen.getByRole('button', { name: /Start Mission/ })).toBeInTheDocument();
  });

  it('moves on by itself a few seconds after a step is done', () => {
    jest.useFakeTimers();
    try {
      recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
      render(<ChallengeWorkspace challenge={explore} />);
      expect(readActiveChallenge()?.stepIndex).toBe(historyStep);

      act(() => jest.advanceTimersByTime(3000));

      expect(readActiveChallenge()?.stepIndex).toBe(historyStep + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('remembers each step as the learner moves on', () => {
    render(<ChallengeWorkspace challenge={explore} />);
    expect(readActiveChallenge()).toEqual({ challengeId: explore.id, stepIndex: 0 });

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(readActiveChallenge()).toEqual({ challengeId: explore.id, stepIndex: 1 });
  });

  it('forgets the challenge once it is finished, so nothing offers a way back to it', async () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: explore.steps.length - 1 });
    render(<ChallengeWorkspace challenge={explore} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    });

    expect(completeChallenge).toHaveBeenCalledWith(explore.id);
    expect(readActiveChallenge()).toBeNull();
  });
});

afterAll(() => clearActiveChallenge());
