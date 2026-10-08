/**
 * @jest-environment jsdom
 */

/**
 * The target overlay on the simulator (AB#447) and the PRIMM Predict step
 * (AB#453), as a learner meets them.
 *
 * The editor and the simulator are stubbed: Blockly loads from a CDN and the
 * simulator draws on a canvas jsdom does not have. What is under test is what
 * the challenge tells them - which code to start from, where to save, and
 * whether the target's path is on screen - which the stubs record.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { targetGeometry } from '@/core/domain/services/challengeTarget';
import type { SimTarget } from '@/lib/roverSimRender';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
// The Python editor is loaded through next/dynamic; this stand-in records what
// the challenge hands it.
let pythonEditor: { storageKey?: string; starterCode?: string } | undefined;
jest.mock('next/dynamic', () => () => (props: { storageKey?: string; starterCode?: string }) => {
  pythonEditor = props;
  return null;
});
jest.mock('@/components/mission-feed/MissionFeed', () => ({ MissionFeed: () => null }));
jest.mock('@/components/layout/MobileSearch', () => ({ MobileSearch: () => null }));
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ query: '', activeFilter: 'all' }) }));
jest.mock('@/hooks/useChallengeProgress', () => ({ useChallengeProgress: () => ({ completeChallenge: jest.fn() }) }));
jest.mock('@/infrastructure/browser/challengeHandoff', () => ({ writeChallengeHandoff: jest.fn() }));
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  readMilestones: () => ({ visitedRoutes: [], missionCreated: false }),
}));

type EditorProps = {
  onCodeChange: (code: string) => void;
  onGenerateCommands: (commands: { command: string; speed?: number; duration?: number }[]) => void;
  storageKey?: string;
  starterWorkspace?: object;
};
let editor: EditorProps;
jest.mock('@/components/mission/BlocklyEditor', () => ({
  BlocklyEditor: (props: EditorProps) => {
    editor = props;
    return null;
  },
}));

let simTarget: SimTarget | null | undefined;
jest.mock('@/components/mission/SimulationPanel', () => ({
  SimulationPanel: ({ target }: { target?: SimTarget | null }) => {
    simTarget = target;
    return null;
  },
}));

// The yard the simulator draws. Null means the hook's own default; a test can
// hand it an edited yard instead.
let mockYardLayout: unknown = null;
jest.mock('@/hooks/useYardLayout', () => {
  const { YARD } = jest.requireActual('@/lib/rover-physics');
  return { useYardLayout: () => ({ yardId: 'test-yard', layout: mockYardLayout ?? YARD }) };
});

import { ChallengeCenterPanel, TARGET_PEEK_MS } from '@/components/challenges/ChallengeCenterPanel';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

const drive = CHALLENGES['drive-to-target'];
const geometry = targetGeometry(drive.target!);

function renderPanel(extra: { holdTarget?: boolean; onRun?: jest.Mock } = {}) {
  return render(
    <ChallengeCenterPanel
      challenge={drive}
      onLoadMore={() => {}}
      onFeedState={() => {}}
      onCodeChange={() => {}}
      onBlocklyStateChange={() => {}}
      onTrajectoryOutcomes={() => {}}
      target={geometry}
      {...extra}
    />,
  );
}

beforeEach(() => {
  simTarget = undefined;
  // The workspace remembers the step a learner is on (activeChallenge.ts);
  // each test here starts a challenge from the beginning.
  sessionStorage.clear();
});

describe('the target overlay (AB#447)', () => {
  it('shows the target and its one-line description when the challenge opens', () => {
    renderPanel();

    expect(screen.getByText(drive.target!.description)).toBeInTheDocument();
    expect(simTarget?.showPath).toBe(true);
    expect(simTarget?.goal).toEqual(geometry.goal);
  });

  it('goes away when the learner starts building, but not for the ready-made code loading', () => {
    renderPanel();

    act(() => editor.onCodeChange('rover.forward(60)\ntime.sleep(3)'));
    expect(simTarget?.showPath).toBe(true);

    act(() => editor.onCodeChange('rover.forward(60)\ntime.sleep(4)'));
    expect(simTarget?.showPath).toBe(false);
    expect(screen.queryByText(drive.target!.description)).not.toBeInTheDocument();
    // The place to stop stays: a learner tuning a number has to see it.
    expect(simTarget?.goal).toEqual(geometry.goal);
  });

  it('comes back for about five seconds when asked for', () => {
    jest.useFakeTimers();
    try {
      renderPanel();
      act(() => editor.onCodeChange('a'));
      act(() => editor.onCodeChange('b'));

      fireEvent.click(screen.getByRole('button', { name: 'Show target' }));
      expect(simTarget?.showPath).toBe(true);
      expect(screen.getByText(drive.target!.description)).toBeInTheDocument();

      act(() => jest.advanceTimersByTime(TARGET_PEEK_MS - 1));
      expect(simTarget?.showPath).toBe(true);
      act(() => jest.advanceTimersByTime(1));
      expect(simTarget?.showPath).toBe(false);
      expect(TARGET_PEEK_MS).toBe(5000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the result only, never the commands that make it', () => {
    renderPanel();
    // The overlay's only words are the description, and no description may
    // carry code or a block's setting - "5 seconds" would give the answer away.
    for (const challenge of Object.values(CHALLENGES)) {
      expect(challenge.target?.description ?? '').not.toMatch(/rover\.|sleep\(|\d+(\.\d+)? ?(s|seconds)\b|Move Forward/i);
    }
    expect(screen.getByText(drive.target!.description).parentElement).toHaveTextContent(
      `Target: ${drive.target!.description}`,
    );
    // And the simulator is handed points to draw, not the reference program.
    expect(Object.keys(simTarget ?? {}).sort()).toEqual(['goal', 'path', 'showPath']);
  });

  it('is held back while a Predict step is unanswered, so it cannot answer it', () => {
    renderPanel({ holdTarget: true });

    expect(simTarget?.showPath).toBe(false);
    expect(screen.queryByText(drive.target!.description)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show target' })).not.toBeInTheDocument();
  });
});

describe('the challenge editor', () => {
  it('starts from the ready-made code, saved under its own key rather than Create Mission’s', () => {
    renderPanel();

    expect(editor.starterWorkspace).toBe(drive.starterBlocks);
    expect(editor.storageKey).toBe('challengeWorkspace:drive-to-target');
  });

  it('reports where each run ended, for the reaches-target check', () => {
    const onRun = jest.fn();
    renderPanel({ onRun });

    act(() => editor.onGenerateCommands([{ command: 'forward', speed: 60, duration: 5 }]));

    const { path, crashed } = onRun.mock.calls[0][0];
    const end = path[path.length - 1];
    expect(crashed).toBe(false);
    expect(Math.hypot(end.x - geometry.goal!.x, end.y - geometry.goal!.y)).toBeLessThanOrEqual(geometry.goal!.radiusCm);
  });
});

describe('a Python challenge (AB#446: code kept between tries)', () => {
  it('saves under its own key and starts from its ready-made code', () => {
    const hazard = CHALLENGES['spot-the-hazard'];
    render(
      <ChallengeCenterPanel
        challenge={hazard}
        onLoadMore={() => {}}
        onFeedState={() => {}}
        onCodeChange={() => {}}
        onBlocklyStateChange={() => {}}
        onTrajectoryOutcomes={() => {}}
      />,
    );

    expect(pythonEditor?.storageKey).toBe('challengeCode:spot-the-hazard');
    expect(pythonEditor?.starterCode).toBe(hazard.starterCode);
  });
});

describe('the yard a run is simulated in', () => {
  it('is the yard the simulator draws, not the built-in one (AB#468)', () => {
    const { YARD } = jest.requireActual('@/lib/rover-physics');
    // An edited yard with a rock straight ahead of the start mark.
    const ahead = { x: YARD.start.x, y: YARD.start.y + 30, widthCm: 20, depthCm: 20, name: 'NEW' };
    mockYardLayout = { ...YARD, rocks: [...YARD.rocks, ahead] };
    try {
      const onRun = jest.fn();
      renderPanel({ onRun });
      act(() => editor.onGenerateCommands([{ command: 'forward', speed: 60, duration: 5 }]));
      expect(onRun.mock.calls[0][0].crashed).toBe(true);
    } finally {
      mockYardLayout = null;
    }
  });
});

describe('the finish overlay', () => {
  it('is not painted over by the editor', () => {
    // Asserted at the class because jsdom has no stacking: the editor's panel
    // must be its own stacking context, or Blockly's toolbox (z-index 70) and
    // scrollbars (20) draw over the workspace's z-10 "Challenge complete!"
    // overlay, which is what a learner saw.
    renderPanel();
    expect(screen.getByTestId('challenge-code-workspace')).toHaveClass('isolate');
  });
});

describe('PRIMM Predict (AB#453)', () => {
  it('lets any guess through, and never marks one wrong', () => {
    render(<ChallengeWorkspace challenge={drive} />);
    const next = screen.getByRole('button', { name: /Next/ });
    expect(next).toBeDisabled();

    // A square is not what this code does. It still counts.
    fireEvent.click(screen.getByRole('button', { name: 'Drive in a square' }));

    expect(screen.getByRole('button', { name: 'Drive in a square' })).toHaveAttribute('aria-pressed', 'true');
    expect(next).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/wrong|incorrect|correct|right answer/i);
  });

  it('keeps the guess on screen for the Run step, to compare against', () => {
    render(<ChallengeWorkspace challenge={drive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drive in a triangle' }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('heading', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByText('Your guess: Drive in a triangle')).toBeInTheDocument();
  });

  it('holds the target back until the guess is made', () => {
    render(<ChallengeWorkspace challenge={drive} />);
    expect(simTarget?.showPath).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Drive in a straight line' }));
    expect(simTarget?.showPath).toBe(true);
  });
});
