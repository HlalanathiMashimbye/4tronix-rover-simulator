/**
 * @jest-environment jsdom
 */

/**
 * Create Mission on a phone (AB#455).
 *
 * Measured at 375x812 before this: the page was 1381px tall, the simulator
 * started below the fold, and the learner's tab bar and floating Create
 * Mission button sat over the block canvas. What is behaviour, and so tested
 * here:
 *
 * - the build page is its own surface, and '/missions' (the feed) is not;
 * - the navbar drops its phone chrome on it, and keeps it on the feed;
 * - the phone layout is decided in one hook that follows the md breakpoint;
 * - the docked layout shows the simulator and the editor together, expands
 *   the simulator on request, and keeps the editor on screen while a run
 *   plays, so the running block or line can be followed (6 Oct 2026: Run
 *   used to slide the editor away as the program started). Run reads Stop
 *   while a run plays. When a run plays to its end the launch view opens by
 *   itself: the simulator, the checks, the name and Submit. Submitting used
 *   to sit behind a Send button that only appeared after a full watch, and
 *   on a phone nobody found it - there was no way to submit a mission.
 *
 * That the page does not scroll is layout, which jsdom cannot measure; it
 * was checked in a browser at 360x640, 375x667, 390x844 and 412x915.
 */

import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';

let pathname = '/mission';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }),
}));
jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({ unread: [], hasUnread: false, markAllSeen: () => {}, dismiss: () => {} }),
}));
jest.mock('@/components/learner/EmailPrompt', () => ({ EmailPrompt: () => null }));

import { isBuildSurface } from '@/lib/appSurfaces';
import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';
import { PhoneWorkspace } from '@/components/mission/PhoneWorkspace';
import { renderToString } from 'react-dom/server';
import { useIsPhoneLayout, usePhoneLayout, PHONE_QUERY } from '@/hooks/useIsPhoneLayout';

describe('the build surface', () => {
  it('is the Create Mission page', () => {
    expect(isBuildSurface('/mission')).toBe(true);
    expect(isBuildSurface('/mission/anything')).toBe(true);
  });

  it('is not the mission feed, whose path starts the same way', () => {
    expect(isBuildSurface('/missions')).toBe(false);
    expect(isBuildSurface('/missions/abc')).toBe(false);
    expect(isBuildSurface('/')).toBe(false);
  });
});

describe('the navbar on a phone', () => {
  const renderNavbar = (path: string) => {
    pathname = path;
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );
  };

  it('drops the tab bar and the floating button while building', () => {
    renderNavbar('/mission');
    // Exactly "History": the laptop navbar's "My History" is a different
    // element and stays, hidden by CSS below md.
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Create Mission')).not.toBeInTheDocument();
  });

  it('keeps them on the mission feed', () => {
    renderNavbar('/missions');
    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByLabelText('Create Mission')).toBeInTheDocument();
  });
});

describe('deciding the phone layout', () => {
  let listeners: (() => void)[] = [];
  let matches = false;

  beforeEach(() => {
    listeners = [];
    window.matchMedia = jest.fn((query: string) => ({
      get matches() {
        return query === PHONE_QUERY && matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => {
        listeners = listeners.filter((l) => l !== fn);
      },
    })) as unknown as typeof window.matchMedia;
  });

  it('follows the md breakpoint, including when the window changes', () => {
    matches = true;
    const { result } = renderHook(() => useIsPhoneLayout());
    expect(result.current).toBe(true);

    matches = false;
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toBe(false);
  });

  it('agrees with the md breakpoint the CSS uses', () => {
    expect(PHONE_QUERY).toBe('(max-width: 767px)');
  });

  it('is unknown on the server, so neither layout is sent to a phone', () => {
    // The server used to render the desktop layout, which a phone painted
    // before any JavaScript ran: the wrong layout flashed up first.
    matches = true;
    function Probe() {
      return <span>{String(usePhoneLayout())}</span>;
    }
    expect(renderToString(<Probe />)).toContain('null');
  });

  it('reads as not a phone where matchMedia does not exist, rather than crashing', () => {
    // @ts-expect-error - simulating a browser without it
    delete window.matchMedia;
    const { result } = renderHook(() => useIsPhoneLayout());
    expect(result.current).toBe(false);
  });
});

describe('the docked layout', () => {
  function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PhoneWorkspace>> = {}) {
    const onLaunchOpenChange = jest.fn();
    const onRun = jest.fn();
    render(
      <PhoneWorkspace
        editor={<div data-testid="editor" />}
        simulator={<div data-testid="simulator" />}
        submitBar={<div data-testid="submit-bar" />}
        onRun={onRun}
        editorKind="blocks"
        launchOpen={false}
        onLaunchOpenChange={onLaunchOpenChange}
        {...overrides}
      />,
    );
    return { onLaunchOpenChange, onRun };
  }

  it('shows the simulator and the editor at the same time while editing', () => {
    renderWorkspace();
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
    expect(screen.getByTestId('editor').parentElement).not.toHaveAttribute('inert');
  });

  it('enlarges the simulator on request, and shrinks it back', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge the simulator' }));
    const shrink = screen.getByRole('button', { name: 'Shrink the simulator' });
    expect(shrink).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(shrink);
    expect(screen.getByRole('button', { name: 'Enlarge the simulator' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('runs the program with the editor still on screen, so the run can be followed in it', () => {
    jest.useFakeTimers();
    const { onRun, onLaunchOpenChange } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => jest.runAllTimers());
    expect(onRun).toHaveBeenCalled();
    expect(onLaunchOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor').parentElement).not.toHaveAttribute('inert');
    jest.useRealTimers();
  });

  it('offers Stop in place of Run while a run plays', () => {
    const onStop = jest.fn();
    renderWorkspace({ running: true, onStop });
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });

  describe('when a run plays to its end', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function endARun(overrides: Partial<React.ComponentProps<typeof PhoneWorkspace>> = {}) {
      const onLaunchOpenChange = jest.fn();
      const props = {
        editor: <div data-testid="editor" />,
        simulator: <div data-testid="simulator" />,
        submitBar: <div data-testid="submit-bar" />,
        onRun: () => {},
        editorKind: 'blocks' as const,
        launchOpen: false,
        onLaunchOpenChange,
        runEnded: 0,
        ...overrides,
      };
      const { rerender } = render(<PhoneWorkspace {...props} />);
      rerender(<PhoneWorkspace {...props} runEnded={props.runEnded + 1} />);
      return onLaunchOpenChange;
    }

    it('opens the launch view, after a moment to see where the rover stopped', () => {
      const onLaunchOpenChange = endARun();
      expect(onLaunchOpenChange).not.toHaveBeenCalled();
      act(() => jest.runAllTimers());
      expect(onLaunchOpenChange).toHaveBeenCalledWith(true);
    });

    it('not for a run that ended before the layout was on screen', () => {
      const onLaunchOpenChange = jest.fn();
      render(
        <PhoneWorkspace
          editor={<div />}
          simulator={<div />}
          submitBar={<div />}
          onRun={() => {}}
          editorKind="blocks"
          launchOpen={false}
          onLaunchOpenChange={onLaunchOpenChange}
          runEnded={3}
        />,
      );
      act(() => jest.runAllTimers());
      expect(onLaunchOpenChange).not.toHaveBeenCalled();
    });

    it('not in Drive, which has nothing to send', () => {
      const onLaunchOpenChange = endARun({ submitBar: undefined });
      act(() => jest.runAllTimers());
      expect(onLaunchOpenChange).not.toHaveBeenCalled();
    });

    it('not while the keyboard is up, which would pull the editor out from under the typing', () => {
      // The keyboard covers the bottom half of the screen.
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { height: window.innerHeight / 2, scale: 1, offsetTop: 0, addEventListener: () => {}, removeEventListener: () => {} },
      });
      try {
        const onLaunchOpenChange = endARun();
        act(() => jest.runAllTimers());
        expect(onLaunchOpenChange).not.toHaveBeenCalled();
      } finally {
        delete (window as { visualViewport?: unknown }).visualViewport;
      }
    });
  });

  it('shows the checks, name and Submit in the launch view, beside the simulator', () => {
    renderWorkspace({ launchOpen: true });
    expect(screen.getByRole('region', { name: 'Send your mission' })).toContainElement(screen.getByTestId('submit-bar'));
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
  });

  it('keeps the editor mounted but out of reach while launching, so the program and its Run survive', () => {
    renderWorkspace({ launchOpen: true });
    const editor = screen.getByTestId('editor');
    expect(editor).toBeInTheDocument();
    // Collapsed by CSS so it can animate away, and inert so a keyboard or
    // screen reader cannot wander into an editor nobody can see.
    expect(editor.parentElement).toHaveAttribute('inert');
  });

  it('says where the way back goes, for blocks and for code', () => {
    const { onLaunchOpenChange } = renderWorkspace({ launchOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Back to blocks' }));
    expect(onLaunchOpenChange).toHaveBeenCalledWith(false);
  });

  it('says Back to code from the Python tab', () => {
    renderWorkspace({ launchOpen: true, editorKind: 'code' });
    expect(screen.getByRole('button', { name: 'Back to code' })).toBeInTheDocument();
  });

  it('keeps the launch controls out of reach while editing', () => {
    renderWorkspace();
    expect(screen.getByTestId('submit-bar').closest('.phoneLaunchSlot')).toHaveAttribute('inert');
  });

  it('has neither Run nor a launch view in Drive mode, which has no program', () => {
    renderWorkspace({ submitBar: undefined, launchOpen: true });
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Send your mission' })).not.toBeInTheDocument();
    expect(screen.getByTestId('editor').parentElement).not.toHaveAttribute('inert');
  });
});
