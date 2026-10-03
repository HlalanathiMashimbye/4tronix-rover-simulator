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
 *   the simulator on request, and has ONE top-bar button: Run until the
 *   program has been watched, then Send, which opens the launch sheet.
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
import { useIsPhoneLayout, PHONE_QUERY } from '@/hooks/useIsPhoneLayout';

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
});

describe('the docked layout', () => {
  function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PhoneWorkspace>> = {}) {
    const onSendOpenChange = jest.fn();
    const onRun = jest.fn();
    render(
      <PhoneWorkspace
        editor={<div data-testid="editor" />}
        simulator={<div data-testid="simulator" />}
        submitBar={<div data-testid="submit-bar" />}
        onRun={onRun}
        watched={false}
        sendReady={false}
        sendOpen={false}
        onSendOpenChange={onSendOpenChange}
        {...overrides}
      />,
    );
    return { onSendOpenChange, onRun };
  }

  it('shows the simulator and the editor at the same time', () => {
    renderWorkspace();
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('enlarges the simulator on request, and shrinks it back', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge the simulator' }));
    const shrink = screen.getByRole('button', { name: 'Shrink the simulator' });
    expect(shrink).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(shrink);
    expect(screen.getByRole('button', { name: 'Enlarge the simulator' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers Run, not Send, until the program has been watched', () => {
    const { onRun, onSendOpenChange } = renderWorkspace({ watched: false });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalled();
    expect(onSendOpenChange).not.toHaveBeenCalled();
  });

  it('becomes Send once watched, which opens the launch sheet', () => {
    const { onSendOpenChange } = renderWorkspace({ watched: true });
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('submit-bar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows the sheet when open, and closes it on Escape', () => {
    const { onSendOpenChange } = renderWorkspace({ sendOpen: true });
    expect(screen.getByRole('dialog', { name: 'Send your mission' })).toContainElement(screen.getByTestId('submit-bar'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSendOpenChange).toHaveBeenCalledWith(false);
  });

  it('says whether the mission is ready before the sheet is opened', () => {
    renderWorkspace({ watched: true, sendReady: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-ready', 'true');
  });

  it('offers neither in Drive mode, which has no program', () => {
    renderWorkspace({ submitBar: undefined });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
  });
});
