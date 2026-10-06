/**
 * @jest-environment jsdom
 */

/**
 * The learner-facing Challenges redesign: the mission map, the briefing in
 * front of each challenge, and the tactile pill. See
 * docs/UI_REDESIGN_STANDARDS.md.
 *
 * What each of these guards is a thing a young learner would feel and an
 * adult tester would not notice: two nodes glowing at once, a locked node
 * that is still a link, a workspace that opens before Start Mission, or a
 * button that quietly shrank under the 44px touch target.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ChallengeId, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('motion/react', () => ({ useReducedMotion: () => true }));
jest.mock('@/components/ui/StaggeredEntrance', () => ({
  StaggeredEntrance: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let completed: ChallengeId[] = [];
let unlockedLevels: ChallengeLevelId[] = [1];
jest.mock('@/hooks/useChallengeProgress', () => ({
  useChallengeProgress: () => ({
    loading: false,
    isLevelUnlocked: (id: ChallengeLevelId) => unlockedLevels.includes(id),
    isChallengeComplete: (id: ChallengeId) => completed.includes(id),
    completedCount: completed.length,
    totalCount: Object.keys(CHALLENGES).length,
  }),
}));

// The briefing is under test, not the workspace behind it.
jest.mock('@/components/challenges/ChallengeWorkspace', () => ({
  ChallengeWorkspace: () => <div data-testid="workspace" />,
}));

import { ChallengesHub } from '@/components/challenges/ChallengesHub';
import { ChallengeBriefingGate } from '@/components/challenges/ChallengeBriefing';
import { describeCheck } from '@/components/challenges/describeCheck';
import { pillClass, type PillTone } from '@/components/challenges/pill';

beforeEach(() => {
  completed = [];
  unlockedLevels = [1];
});

describe('the mission map', () => {
  it('marks done, up next, ready and locked nodes in their accessible names', () => {
    completed = ['platform-orientation'];
    render(<ChallengesHub />);

    expect(screen.getByRole('link', { name: /Find Your Way Around.*Done/ })).toHaveAttribute(
      'href',
      '/challenges/platform-orientation',
    );
    expect(screen.getByRole('link', { name: /Explore the Platform.*Up next/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create Your First Mission.*Ready/ })).toBeInTheDocument();
  });

  it('glows exactly one node, the first unfinished one in track order', () => {
    unlockedLevels = [1, 2];
    completed = ['platform-orientation', 'explore-the-platform', 'first-mission'];
    render(<ChallengesHub />);

    const upNext = screen.getAllByRole('link', { name: /Up next/ });
    expect(upNext).toHaveLength(1);
    expect(upNext[0]).toHaveAttribute('href', '/challenges/drive-to-target');
  });

  it('does not make a locked node a link', () => {
    render(<ChallengesHub />);

    const level2 = screen.getByRole('region', { name: /Level 2/ });
    expect(within(level2).queryAllByRole('link')).toHaveLength(0);
    expect(within(level2).getAllByText('Locked')).toHaveLength(CHALLENGE_LEVELS[1].challengeIds.length);
  });

  it("keeps each level's outcomes folded away, so the map is what a child sees", () => {
    render(<ChallengesHub />);

    const level1 = screen.getByRole('region', { name: /Level 1/ });
    const outcome = within(level1).getByText(CHALLENGE_LEVELS[0].outcomes[0].text);
    expect(outcome).not.toBeVisible();

    const summary = within(level1).getByText("What you'll learn");
    expect(summary.closest('summary')).not.toBeNull();
    expect(summary).toBeVisible();
  });

  it('counts stars from completions', () => {
    completed = ['platform-orientation', 'explore-the-platform'];
    render(<ChallengesHub />);

    expect(screen.getByRole('progressbar', { name: 'Challenges completed' })).toHaveAttribute('aria-valuenow', '2');
  });
});

describe('the challenge briefing', () => {
  const challenge = CHALLENGES['draw-a-square'];

  it('lists one Mission Goal per step, from the step titles', () => {
    render(<ChallengeBriefingGate challenge={challenge} />);

    const goals = within(screen.getByRole('region', { name: 'Mission Goals' }))
      .getAllByRole('listitem')
      .slice(0, challenge.steps.length)
      .map((li) => li.textContent);
    expect(goals).toEqual(challenge.steps.map((s) => s.title));
  });

  it('opens the workspace only once Start Mission is pressed', () => {
    render(<ChallengeBriefingGate challenge={challenge} />);
    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start Mission' }));

    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Mission' })).not.toBeInTheDocument();
  });

  it("folds a level's outcomes on its first briefing, leaving Mission Goals and Start in view", () => {
    const level2 = CHALLENGE_LEVELS[1];
    render(<ChallengeBriefingGate challenge={CHALLENGES[level2.challengeIds[0]]} briefingLevel={level2} />);

    expect(screen.getByText(level2.outcomes[0].text)).not.toBeVisible();
    expect(screen.getByText("What you'll learn")).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Mission Goals' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start Mission' })).toBeVisible();
  });

  it('keeps teacher info folded away until asked for', () => {
    render(<ChallengeBriefingGate challenge={challenge} />);

    const detail = screen.getByText('How each step is checked');
    expect(detail.closest('details')).not.toHaveAttribute('open');
    expect(detail).not.toBeVisible();
    expect(screen.getByText('Teacher & Standards Info')).toBeVisible();
  });

  it('says so when a step has nothing to check, rather than trailing off', () => {
    render(<ChallengeBriefingGate challenge={challenge} />);

    const unchecked = challenge.steps.filter((s) => s.checks.length === 0);
    expect(unchecked.length).toBeGreaterThan(0);
    for (const step of unchecked) {
      expect(screen.getByText(`${step.title}:`).parentElement).toHaveTextContent(/pressing Finish/);
    }
  });

  it('tells the teacher what each step actually checks', () => {
    render(<ChallengeBriefingGate challenge={challenge} />);

    for (const step of challenge.steps) {
      for (const check of step.checks) {
        expect(screen.getAllByText(describeCheck(check), { exact: false }).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the pill button', () => {
  it.each<PillTone>(['blue', 'orange', 'green', 'plain'])(
    'keeps a 44px touch target and its 3D lip in the %s tone',
    (tone) => {
      // jsdom has no layout, so the target size can only be pinned at the
      // class that sets it. min-h-11 / min-w-11 are 2.75rem = 44px.
      for (const size of ['md', 'lg'] as const) {
        const classes = pillClass(tone, size).split(/\s+/);
        expect(classes).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11', 'border-b-4']));
      }
    },
  );

  it('never puts white text on a filled tone', () => {
    for (const tone of ['blue', 'orange', 'green'] as const) {
      expect(pillClass(tone)).toContain('text-kid-ink');
      expect(pillClass(tone)).not.toMatch(/text-white/);
    }
  });
});
