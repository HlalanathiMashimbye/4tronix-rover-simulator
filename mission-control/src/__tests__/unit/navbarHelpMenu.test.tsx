/**
 * @jest-environment jsdom
 */

/**
 * The navbar's Help menu: the tour, and Sapient's About page.
 *
 * About was a tab in the phone's bottom bar and a link in the laptop's
 * Home / My History pill (PR #318). Both bars are for places in this app, and
 * About opens another website, so a tab there took a learner out of Mission
 * Control. It is one of Help's two items now, on every screen size.
 */

import { render, screen, fireEvent } from '@testing-library/react';

const mockStartTour = jest.fn();
let mockTourActive = false;

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }),
}));
jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({ unread: [], hasUnread: false, markAllSeen: () => {}, dismiss: () => {} }),
}));
jest.mock('@/components/learner/EmailPrompt', () => ({ EmailPrompt: () => null }));
jest.mock('@/contexts/TourContext', () => ({
  useTour: () => ({ start: mockStartTour, active: mockTourActive }),
}));

import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';

function renderNavbar() {
  render(
    <SearchProvider>
      <Navbar />
    </SearchProvider>,
  );
}

beforeEach(() => {
  mockStartTour.mockClear();
  mockTourActive = false;
});

it('keeps About out of both bars', () => {
  renderNavbar();

  expect(screen.queryByRole('link', { name: /about/i })).not.toBeInTheDocument();
  // The phone's bar is back to its three slots.
  expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
});

it('opens to the tour and to Sapient\'s About page, in a new tab', () => {
  renderNavbar();

  fireEvent.click(screen.getByRole('button', { name: 'Help' }));

  const menu = screen.getByRole('menu', { name: 'Help' });
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent);
  expect(items).toEqual(['Take the tour', 'Privacy and terms', 'About Sapient.rocks']);

  const about = screen.getByRole('menuitem', { name: 'About Sapient.rocks' });
  expect(about).toHaveAttribute('href', 'https://sapient.rocks/about/');
  expect(about).toHaveAttribute('target', '_blank');
  expect(about).toHaveAttribute('rel', 'noopener noreferrer');
});

it('starts the tour from the menu, and closes', () => {
  renderNavbar();

  fireEvent.click(screen.getByRole('button', { name: 'Help' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Take the tour' }));

  expect(mockStartTour).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('is not there while the tour is running', () => {
  mockTourActive = true;
  renderNavbar();

  expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
});

it('reaches privacy and terms from Help, on every page, in the same tab', () => {
  renderNavbar();

  fireEvent.click(screen.getByRole('button', { name: 'Help' }));
  const privacy = screen.getByRole('menuitem', { name: 'Privacy and terms' });

  expect(privacy).toHaveAttribute('href', '/privacy');
  expect(privacy).not.toHaveAttribute('target');
});
