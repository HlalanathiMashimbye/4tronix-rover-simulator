/**
 * @jest-environment jsdom
 */

/**
 * The Navbar's Challenges pill is the one place a learner sees their overall
 * progress without opening the hub - it has to show the real count, and it
 * has to stay quiet (no "0/0") before that count has loaded.
 *
 * Everything Navbar pulls in besides useChallengeProgress (theme, completion
 * notifications, search, the email prompt) is mocked to a stub: this test is
 * about the badge, not the rest of the bar.
 */

import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: jest.fn() }),
}));
jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({
    unread: [],
    hasUnread: false,
    markAllSeen: jest.fn(),
    dismiss: jest.fn(),
  }),
}));
jest.mock('@/components/layout/NavbarSearch', () => ({ NavbarSearch: () => null }));
jest.mock('@/components/layout/NotificationModal', () => ({ NotificationModal: () => null }));
jest.mock('@/components/learner/EmailPrompt', () => ({ EmailPrompt: () => null }));

const useChallengeProgress = jest.fn();
jest.mock('@/hooks/useChallengeProgress', () => ({
  useChallengeProgress: () => useChallengeProgress(),
}));

import { Navbar } from '@/components/layout/Navbar';

describe('Navbar Challenges badge', () => {
  it('shows the completed/total count once progress has loaded', () => {
    useChallengeProgress.mockReturnValue({
      completedCount: 1,
      totalCount: 4,
      loading: false,
    });

    render(<Navbar />);

    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('shows no count while progress is still loading', () => {
    useChallengeProgress.mockReturnValue({
      completedCount: 0,
      totalCount: 0,
      loading: true,
    });

    render(<Navbar />);

    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
  });
});
