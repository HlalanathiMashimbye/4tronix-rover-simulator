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
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  ...jest.requireActual('@/infrastructure/browser/platformMilestones'),
  readMilestones: () => ({ visitedRoutes: ['/history', '/leaderboard'], missionCreated: true }),
}));
jest.mock('@/components/challenges/ChallengeCenterPanel', () => ({ ChallengeCenterPanel: () => null }));

import {
  clearActiveChallenge,
  readActiveChallenge,
  recordActiveChallenge,
} from '@/infrastructure/browser/activeChallenge';
import { ReturnToChallenge } from '@/components/challenges/ReturnToChallenge';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';
import { ChallengeBriefingGate } from '@/components/challenges/ChallengeBriefing';

// "Explore the Platform": step 1 opens History, step 2 the Leaderboard.
const explore = CHALLENGES['explore-the-platform'];
const historyStep = explore.steps.findIndex((s) => s.checks.some((c) => c.kind === 'route-visited' && c.path === '/history'));

beforeEach(() => {
  sessionStorage.clear();
  learner = 'learner-a';
  pathname = '/history';
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

describe('the offer to go back', () => {
  it('says they found it on the page their step asked them to open, and links to the challenge', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    render(<ReturnToChallenge />);

    expect(screen.getByText('You found it! Go back and tick it off.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to my challenge/ })).toHaveAttribute('href', `/challenges/${explore.id}`);
  });

  it('still offers the way back on any other page', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    pathname = '/';
    render(<ReturnToChallenge />);

    expect(screen.getByText('Your challenge is waiting for you!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to my challenge/ })).toBeInTheDocument();
  });

  it.each(['/challenges', `/challenges/${explore.id}`, '/operator'])('is not shown on %s', (path) => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: 0 });
    pathname = path;
    render(<ReturnToChallenge />);
    expect(screen.queryByRole('complementary', { name: 'Your challenge' })).not.toBeInTheDocument();
  });

  it('is not shown when there is no challenge in progress', () => {
    render(<ReturnToChallenge />);
    expect(screen.queryByRole('complementary', { name: 'Your challenge' })).not.toBeInTheDocument();
  });

  it('closes for this page only, and comes back on the next', () => {
    recordActiveChallenge({ challengeId: explore.id, stepIndex: historyStep });
    const { rerender } = render(<ReturnToChallenge />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide this for now' }));
    expect(screen.queryByRole('complementary', { name: 'Your challenge' })).not.toBeInTheDocument();

    pathname = '/leaderboard';
    rerender(<ReturnToChallenge />);
    expect(screen.getByRole('complementary', { name: 'Your challenge' })).toBeInTheDocument();
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
