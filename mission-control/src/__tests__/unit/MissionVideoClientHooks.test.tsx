/**
 * @jest-environment jsdom
 */

import type React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import MissionVideoClient from '@/app/missions/[missionId]/MissionVideoClient';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import type { Mission } from '@/core/domain/entities/Mission';
import { missionSlug } from '@/core/domain/services/missionSlug';
import { allGeneratedMissionNames } from '@/core/domain/services/missionNameGenerator';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/infrastructure/container.browser', () => ({
  browserMissionRepository: jest.fn(),
}));

jest.mock('@/hooks/useFavorites', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: jest.fn() }),
}));

jest.mock('@/hooks/useYardLayout', () => ({ useYardLayout: () => ({ layout: null }) }));
jest.mock('@/hooks/useMissionTrajectory', () => ({ useMissionTrajectory: () => null }));
// Whether the mission has a video is the one thing these tests vary.
const roverRuns: { id: string }[] = [];
jest.mock('@/lib/missionRuns', () => ({ buildRunOptions: () => roverRuns }));
beforeEach(() => {
  phone = false;
  threeColumns = false;
  roverRuns.length = 0;
  roverRuns.push({ id: 'run-1' });
});
jest.mock('@/lib/missionDuration', () => ({ durationLabel: () => '1s' }));
// Stands in for the feed: a button that says the simulation has just played
// to its end, how many rover videos it was given, and the phone's code where
// the page hands it one.
jest.mock('@/components/mission/RunFeed', () => ({
  yardShapeStyle: () => ({}),
  RunFeed: ({
    onSimFinished,
    runs,
    codeSlot,
    codeOpen,
    videosFoot,
  }: {
    onSimFinished?: () => void;
    runs: unknown[];
    codeSlot?: React.ReactNode;
    codeOpen?: boolean;
    videosFoot?: React.ReactNode;
  }) => (
    <div data-testid="feed" data-videos={runs.length} data-code-open={codeOpen ? 'yes' : 'no'}>
      <button type="button" onClick={onSimFinished}>
        finish the simulation
      </button>
      <div data-testid="code-in-feed">{codeSlot}</div>
      <div data-testid="under-videos">{videosFoot}</div>
    </div>
  ),
}));
jest.mock('@/components/mission/MissionCode', () => ({
  MissionCode: ({
    collapsible,
    open,
    onToggle,
    footer,
  }: {
    collapsible?: boolean;
    open?: boolean;
    onToggle?: () => void;
    footer?: React.ReactNode;
  }) => (
    <div>
      <button
        type="button"
        data-testid="code"
        data-collapsible={collapsible ? 'yes' : 'no'}
        data-open={open === false ? 'no' : 'yes'}
        onClick={onToggle}
      >
        code
      </button>
      <div data-testid="code-foot">{footer}</div>
    </div>
  ),
}));
// Shows how many times it has been nudged, which is all the page decides.
jest.mock('@/components/mission/RemixButton', () => ({
  RemixButton: ({ onRemix, nudge }: { onRemix: () => void; nudge: number }) => (
    <button type="button" onClick={onRemix} data-nudge={nudge}>
      Remix
    </button>
  ),
}));
jest.mock('@/components/mission/OperatorFeedback', () => ({
  OperatorFeedback: ({ ask, roomy, children }: { ask?: boolean; roomy?: boolean; children?: React.ReactNode }) => (
    <div data-testid="operator-note" data-ask={ask ? 'yes' : 'no'} data-roomy={roomy ? 'yes' : 'no'}>
      {children}
    </div>
  ),
}));
// Whether the window has room for three columns is the layout rule's to say
// (lib/missionLayout, which has its own tests); these say which they got.
let threeColumns = false;
jest.mock('@/hooks/useMissionLayout', () => ({
  useMissionLayout: () => [
    () => {},
    threeColumns ? { kind: 'wide', simWidth: 500, videosWidth: 450 } : { kind: 'stack' },
  ],
}));
// Phone or not is the page's to ask; these tests say which.
let phone = false;
jest.mock('@/hooks/useIsPhoneLayout', () => ({ usePhoneLayout: () => phone }));

const mission = {
  id: 'mission-1',
  yardId: 'curiosity',
  learnerRef: 'learner-1',
  sessionId: 'session-1',
  code: 'print("hello")',
  status: 'completed',
  submittedAt: '2026-10-06T00:00:00.000Z',
} as Mission;

it('keeps the hook order stable when a mission finishes loading', async () => {
  (browserMissionRepository as jest.Mock).mockReturnValue({
    findById: jest.fn().mockResolvedValue(mission),
    findRuns: jest.fn().mockResolvedValue([]),
  });

  render(<MissionVideoClient missionId="mission-1" yards={[]} />);

  expect(await screen.findByRole('button', { name: /remix/i })).toBeInTheDocument();
});
describe('the note and Remix', () => {
  const load = async (status: Mission['status'], { video = true }: { video?: boolean } = {}) => {
    if (!video) roverRuns.length = 0;
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue({ ...mission, status }),
      findRuns: jest.fn().mockResolvedValue([]),
    });
    render(<MissionVideoClient missionId="mission-1" yards={[]} />);
    await screen.findByRole('button', { name: /finish the simulation/i });
  };

  it('offers Remix once, and asks how it went, on a mission that has finished', async () => {
    await load('completed');

    expect(screen.getAllByRole('button', { name: /remix/i })).toHaveLength(1);
    expect(screen.getByTestId('operator-note')).toHaveAttribute('data-ask', 'yes');
  });

  it.each([true, false])('offers no Remix and asks nothing on a mission that is not finished (video: %s)', async (video) => {
    await load('queued', { video });

    expect(screen.queryByRole('button', { name: /remix/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('operator-note')).toHaveAttribute('data-ask', 'no');
  });

  it('are the foot of the code card where the code is beside the feed', async () => {
    // As a bar across the foot of a tablet's or a laptop's page the note went
    // unseen (the review of 13 October 2026).
    await load('completed');
    const foot = within(screen.getByTestId('code-foot'));

    expect(foot.getByTestId('operator-note')).toBeInTheDocument();
    expect(foot.getByRole('button', { name: /remix/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('operator-note')).toHaveLength(1);
  });

  it('are a bar of their own on a phone, where the code is closed more often than not', async () => {
    phone = true;
    await load('completed');
    const foot = within(screen.getByTestId('code-foot'));

    expect(foot.queryByTestId('operator-note')).not.toBeInTheDocument();
    expect(foot.queryByRole('button', { name: /remix/i })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('operator-note')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /remix/i })).toHaveLength(1);
    // Outside the feed, which scrolls: the bar does not.
    expect(screen.getByTestId('feed')).not.toContainElement(screen.getByTestId('operator-note'));
  });

  describe('in three columns', () => {
    const under = () => within(screen.getByTestId('under-videos'));
    const addRun = () => roverRuns.push({ id: 'run-2' });

    it('are under the rover\'s videos, and the code has its whole card', async () => {
      // "A tonne of whitespace at the bottom of the video, that's where the
      // comment should go" (13 October 2026).
      threeColumns = true;
      await load('completed');

      expect(under().getByTestId('operator-note')).toBeInTheDocument();
      expect(under().getByRole('button', { name: /remix/i })).toBeInTheDocument();
      expect(within(screen.getByTestId('code-foot')).queryByTestId('operator-note')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('operator-note')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /remix/i })).toHaveLength(1);
    });

    it('make one card of the room under a single video, with Remix inside it', async () => {
      threeColumns = true;
      await load('completed');
      const note = under().getByTestId('operator-note');

      expect(note).toHaveAttribute('data-roomy', 'yes');
      expect(note).toContainElement(under().getByRole('button', { name: /remix/i }));
    });

    it('are a bar under the list when there are several videos to scroll', async () => {
      threeColumns = true;
      addRun();
      await load('completed');
      const note = under().getByTestId('operator-note');

      expect(note).toHaveAttribute('data-roomy', 'no');
      expect(note).not.toContainElement(under().getByRole('button', { name: /remix/i }));
    });

    it('tell the stylesheet, with the widths the layout worked out', async () => {
      threeColumns = true;
      await load('completed');
      const body = document.querySelector('.missionBody') as HTMLElement;

      expect(body).toHaveAttribute('data-layout', 'wide');
      expect(body.style.getPropertyValue('--sim-w')).toBe('500px');
      expect(body.style.getPropertyValue('--videos-w')).toBe('450px');
    });

    it('are not what a phone gets, whatever the layout rule would say of its box', async () => {
      threeColumns = true;
      phone = true;
      await load('completed');

      expect(under().queryByTestId('operator-note')).not.toBeInTheDocument();
      expect(document.querySelector('.missionBody')).not.toHaveAttribute('data-layout');
      expect(screen.getAllByTestId('operator-note')).toHaveLength(1);
    });
  });

  it('puts nothing under the videos beside one feed', async () => {
    await load('completed');

    expect(screen.getByTestId('under-videos')).toBeEmptyDOMElement();
    expect(document.querySelector('.missionBody')).not.toHaveAttribute('data-layout');
  });

  it('nudges Remix each time the simulation plays to its end', async () => {
    await load('completed');
    const remix = screen.getByRole('button', { name: /remix/i });
    expect(remix).toHaveAttribute('data-nudge', '0');

    act(() => screen.getByRole('button', { name: /finish the simulation/i }).click());
    expect(remix).toHaveAttribute('data-nudge', '1');

    act(() => screen.getByRole('button', { name: /finish the simulation/i }).click());
    expect(remix).toHaveAttribute('data-nudge', '2');
  });
});

describe('where the code goes', () => {
  const load = async ({ video }: { video: boolean }) => {
    if (!video) roverRuns.length = 0;
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue(mission),
      findRuns: jest.fn().mockResolvedValue([]),
    });
    render(<MissionVideoClient missionId="mission-1" yards={[]} />);
    await screen.findByTestId('feed');
  };
  const feed = () => screen.getByTestId('feed');
  const code = () => screen.getByTestId('code');

  it('is beside the feed and always open where there is room', async () => {
    await load({ video: true });

    expect(within(screen.getByTestId('code-in-feed')).queryByTestId('code')).not.toBeInTheDocument();
    expect(code()).toHaveAttribute('data-collapsible', 'no');
    expect(feed()).toHaveAttribute('data-code-open', 'no');
  });

  it('is in the feed on a phone, closed while there are videos under the simulation to find', async () => {
    phone = true;
    await load({ video: true });

    expect(within(screen.getByTestId('code-in-feed')).getByTestId('code')).toBeInTheDocument();
    expect(code()).toHaveAttribute('data-collapsible', 'yes');
    expect(code()).toHaveAttribute('data-open', 'no');
    expect(feed()).toHaveAttribute('data-code-open', 'no');
  });

  it('opens when its bar is pressed, and tells the feed so it can fold the videos away', async () => {
    phone = true;
    await load({ video: true });

    act(() => code().click());
    expect(code()).toHaveAttribute('data-open', 'yes');
    expect(feed()).toHaveAttribute('data-code-open', 'yes');

    act(() => code().click());
    expect(code()).toHaveAttribute('data-open', 'no');
    expect(feed()).toHaveAttribute('data-code-open', 'no');
  });

  it('starts open on a phone when there is no video to find, as it always was', async () => {
    phone = true;
    await load({ video: false });

    expect(code()).toHaveAttribute('data-open', 'yes');
    expect(feed()).toHaveAttribute('data-code-open', 'yes');
  });
});

describe('opened from a name link', () => {
  const named = { ...mission, id: 'jLSLqPhCp1RuUo2CpfQUA', name: allGeneratedMissionNames()[0] } as Mission;
  const slug = missionSlug(named);

  it('finds the mission by its ID prefix and loads its runs by its real ID', async () => {
    const findByIdPrefix = jest.fn().mockResolvedValue([named]);
    const findById = jest.fn();
    const findRuns = jest.fn().mockResolvedValue([]);
    (browserMissionRepository as jest.Mock).mockReturnValue({ findById, findByIdPrefix, findRuns });

    render(<MissionVideoClient missionId={slug} yards={[]} />);

    expect(await screen.findByRole('button', { name: /remix/i })).toBeInTheDocument();
    expect(findByIdPrefix).toHaveBeenCalledWith('jLSLqP', expect.any(Number));
    expect(findById).not.toHaveBeenCalled();
    expect(findRuns).toHaveBeenCalledWith('jLSLqPhCp1RuUo2CpfQUA');
  });

  it('says not found rather than guessing when no mission has the prefix', async () => {
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(), findByIdPrefix: jest.fn().mockResolvedValue([]), findRuns: jest.fn(),
    });
    render(<MissionVideoClient missionId={slug} yards={[]} />);
    expect(await screen.findByRole('heading', { name: /mission not found/i })).toBeInTheDocument();
  });

  it('turns an old full-ID link into the name link in the address bar', async () => {
    window.history.replaceState(null, '', `/missions/${named.id}?run=x`);
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue(named), findByIdPrefix: jest.fn(), findRuns: jest.fn().mockResolvedValue([]),
    });
    render(<MissionVideoClient missionId={named.id} yards={[]} />);
    await screen.findByRole('button', { name: /remix/i });
    expect(window.location.pathname).toBe(`/missions/${slug}`);
    expect(window.location.search).toBe('?run=x');
  });
});
