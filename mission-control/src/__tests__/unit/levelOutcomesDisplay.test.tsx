/**
 * @jest-environment jsdom
 */

/**
 * AB#444: a level's outcomes show on its card in the hub, and before the
 * level's first challenge - but not before its later ones, where the learner
 * has already been briefed. Each outcome links to the challenges that
 * practise it, except on a locked level, where a link would get round the
 * lock; and a teacher can open the standard's full wording.
 *
 * The workspace's panels and its contexts are stubbed: this is about whether
 * the briefing stands in front of the workspace, not the workspace.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import { CSTA_STANDARDS } from '@/infrastructure/config/curriculumStandards';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/contexts/SearchContext', () => ({
  useSearch: () => ({ query: '', activeFilter: 'all' }),
}));

const isLevelUnlocked = jest.fn((levelId: number) => levelId === 1);
jest.mock('@/hooks/useChallengeProgress', () => ({
  useChallengeProgress: () => ({
    loading: false,
    isLevelUnlocked,
    isChallengeComplete: () => false,
    completedCount: 0,
    totalCount: 6,
    completeChallenge: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/browser/challengeHandoff', () => ({ writeChallengeHandoff: jest.fn() }));
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  readMilestones: () => ({ visitedRoutes: [], missionCreated: false }),
}));
jest.mock('@/components/challenges/ChallengeCenterPanel', () => ({
  ChallengeCenterPanel: () => <div data-testid="center-panel" />,
}));
jest.mock('@/components/challenges/ChallengeInstructionsPanel', () => ({
  ChallengeInstructionsPanel: () => <div data-testid="instructions-panel" />,
}));

import { ChallengesHub } from '@/components/challenges/ChallengesHub';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

const level2 = CHALLENGE_LEVELS.find((l) => l.id === 2)!;

function levelCard(levelId: number): HTMLElement {
  return screen.getByRole('heading', { name: new RegExp(`Level ${levelId}:`) }).closest('section')!;
}

function outcomeItem(container: HTMLElement, outcomeId: string): HTMLElement {
  return container.querySelector(`[data-outcome-id="${outcomeId}"]`) as HTMLElement;
}

describe('level outcomes on the hub', () => {
  it("lists every level's outcomes on that level's own card", () => {
    render(<ChallengesHub />);

    for (const level of CHALLENGE_LEVELS) {
      const texts = level.outcomes.map((o) => within(levelCard(level.id)).getByText(o.text));
      expect(texts).toHaveLength(level.outcomes.length);
    }
  });

  it('links each outcome to the challenges that practise it, on an unlocked level', () => {
    render(<ChallengesHub />);

    const item = outcomeItem(levelCard(1), 'l1-privacy');
    const hrefs = within(item)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/challenges/explore-the-platform', '/challenges/first-mission']);
  });

  it('names the challenges without linking them on a locked level', () => {
    render(<ChallengesHub />);

    const item = outcomeItem(levelCard(2), 'l2-repeat');
    expect(within(item).getByText(CHALLENGES['loop-structures'].title)).toBeInTheDocument();
    expect(within(item).queryAllByRole('link')).toHaveLength(0);
  });

  it("puts the cited standard's full CSTA wording and grade band behind For teachers", () => {
    render(<ChallengesHub />);

    const item = outcomeItem(levelCard(2), 'l2-debug');
    const details = item.querySelector('details')!;
    expect(within(details).getByText('For teachers').tagName).toBe('SUMMARY');
    expect(within(details).getByText(CSTA_STANDARDS['1B-AP-15'].text)).toBeInTheDocument();
    expect(within(details).getByText(/Grades 3-5/)).toBeInTheDocument();
  });
});

describe("briefing before a level's first challenge", () => {
  it('shows the level outcomes first, and the workspace only after Start', () => {
    render(<ChallengeWorkspace challenge={CHALLENGES['basic-movement']} briefingLevel={level2} />);

    for (const outcome of level2.outcomes) {
      expect(screen.getByText(outcome.text)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('center-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    expect(screen.getByTestId('center-panel')).toBeInTheDocument();
    expect(screen.queryByText(level2.outcomes[0].text)).not.toBeInTheDocument();
  });

  it('goes straight to the workspace when there is no briefing', () => {
    render(<ChallengeWorkspace challenge={CHALLENGES['loop-structures']} />);

    expect(screen.getByTestId('center-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
  });
});
