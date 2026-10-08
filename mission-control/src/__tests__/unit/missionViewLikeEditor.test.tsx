/**
 * @jest-environment jsdom
 */

/**
 * A mission's own page, laid out and lit like the editor (AB#450, AB#455).
 *
 * On a phone it scrolled, with the tab bar and the floating button over the
 * blocks; and while its simulation played, nothing showed which part of the
 * program was running. Layout is checked in a browser; what is behaviour is
 * pinned here.
 */

import { render, screen, act, waitFor, renderHook } from '@testing-library/react';

let pathname = '/missions/abc123';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }) }));
jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({ unread: [], hasUnread: false, markAllSeen: () => {}, dismiss: () => {} }),
}));
jest.mock('@/components/learner/EmailPrompt', () => ({ EmailPrompt: () => null }));
jest.mock('@/contexts/LearnerContext', () => ({
  useLearner: () => ({ learner: null, sessionId: 'test-session', loading: false, updateProfile: jest.fn() }),
}));

// A headless Blockly that yields one tagged command, so the hook's
// "from the blocks" branch can be seen.
const loadBlockly = jest.fn(() => Promise.resolve());
jest.mock('@/infrastructure/browser/loadBlockly', () => ({ loadBlockly: () => loadBlockly() }));
jest.mock('@/lib/roverBlockly', () => ({
  ...jest.requireActual('@/lib/roverBlockly'),
  defineRoverBlocks: () => {},
  workspaceToCommands: () => [{ command: 'forward', speed: 60, duration: 1, source: { blockIds: ['blk-1'] } }],
}));

import { isMissionViewSurface } from '@/lib/appSurfaces';
import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';
import { CodeLines } from '@/components/mission/CodeLines';
import { useMissionTrajectory } from '@/hooks/useMissionTrajectory';
import type { Mission } from '@/core/domain/entities/Mission';

describe('the mission page surface', () => {
  it('is one mission, not the feed of them', () => {
    expect(isMissionViewSurface('/missions/abc123')).toBe(true);
    expect(isMissionViewSurface('/missions')).toBe(false);
    expect(isMissionViewSurface('/missions/')).toBe(false);
  });

  it('drops the tab bar and the floating button, which sat over the blocks', () => {
    pathname = '/missions/abc123';
    render(<SearchProvider><Navbar /></SearchProvider>);
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Create Mission')).not.toBeInTheDocument();
  });
});

describe("the mission's Python", () => {
  const code = ['', 'rover.forward(60)', 'time.sleep(1)', 'rover.stop()'].join('\n');

  it('lights the lines the simulation is running, counting from the very first line', () => {
    // The leading blank line is the trap: trimming it would light the
    // sleep and the stop instead of the forward and the sleep.
    const { container } = render(<CodeLines code={code} highlight={{ fromLine: 2, toLine: 3 }} />);
    const lit = Array.from(container.querySelectorAll('.rover-running-line'), (el) => el.textContent);
    expect(lit).toEqual(['rover.forward(60)', 'time.sleep(1)']);
  });

  it('lights nothing when nothing is running', () => {
    const { container } = render(<CodeLines code={code} highlight={null} />);
    expect(container.querySelectorAll('.rover-running-line')).toHaveLength(0);
  });
});

describe('simulating a stored mission', () => {
  beforeAll(() => {
    (window as unknown as { Blockly: unknown }).Blockly = {
      Workspace: class {
        dispose() {}
      },
      serialization: { workspaces: { load: () => {} } },
    };
  });

  const mission = (blocklyState?: string) =>
    ({ id: 'm', name: 'M', code: 'rover.forward(60)\ntime.sleep(1)\nrover.stop()', blocklyState }) as unknown as Mission;

  it('knows the Python lines for a Python mission', () => {
    const { result } = renderHook(() => useMissionTrajectory(mission()));
    expect(result.current.some((p) => p.source?.fromLine === 1)).toBe(true);
  });

  it('knows the block ids for a block mission, once Blockly has loaded', async () => {
    const { result } = renderHook(() => useMissionTrajectory(mission('{"blocks":{}}')));
    await waitFor(() => expect(result.current.some((p) => p.source?.blockIds?.[0] === 'blk-1')).toBe(true));
  });
});
