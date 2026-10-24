/**
 * @jest-environment jsdom
 */

/**
 * The profile offers sign out only once the profile is saved: an unsaved
 * learner has no recovery code or parent link, so signing out would lose
 * their missions for good. What signing out clears is in learnerSignOut.test.
 */

import { fireEvent, render, screen } from '@testing-library/react';

const learnerState = {
  learner: { id: 'learner-a', displayName: 'Astral Ace' },
  updateProfile: jest.fn(),
  profileSaved: true,
  signOut: jest.fn(),
};

jest.mock('@/contexts/LearnerContext', () => ({ useLearner: () => learnerState }));
jest.mock('@/hooks/useLeaderboard', () => ({
  useLeaderboard: () => ({ status: null, optIn: jest.fn(), optOut: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/infrastructure/browser/getLearnerID', () => ({ getLearnerID: () => 'learner-a' }));
jest.mock('@/components/learner/SaveProfileModal', () => ({ SaveProfileModal: () => null }));
jest.mock('@/components/learner/RestoreProfileModal', () => ({ RestoreProfileModal: () => null }));
jest.mock('@/components/learner/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/learner/AvatarRenderer', () => ({ AvatarRenderer: () => null }));
jest.mock('@/components/learner/AvatarPicker', () => ({
  buildGrid: () => [{ key: 'a', avatar: { style: 'bottts', seed: 'a' } }],
}));

import { ProfileModal } from '@/components/learner/ProfileModal';

beforeEach(() => {
  learnerState.profileSaved = true;
  learnerState.signOut.mockClear();
});

function renderProfile() {
  render(<ProfileModal open onClose={jest.fn()} triggerRef={{ current: null }} />);
}

it('signs a learner with a saved profile out', () => {
  renderProfile();

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  expect(learnerState.signOut).toHaveBeenCalledTimes(1);
});

it('does not offer sign out before the profile is saved', () => {
  learnerState.profileSaved = false;
  renderProfile();

  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Save my profile' })).toBeTruthy();
});
