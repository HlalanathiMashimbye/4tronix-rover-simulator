/**
 * @jest-environment jsdom
 */

/**
 * The first-visit avatar picker.
 *
 * Every way this can go wrong is quiet: a welcome that comes back on every
 * visit teaches children to close it without reading, one keyed to the machine
 * greets only the first child at a shared laptop.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/infrastructure/browser/getLearnerID', () => ({
  getLearnerID: jest.fn(() => 'learner-a'),
}));

jest.mock('@/components/learner/RecoveryCodeCard', () => ({
  RecoveryCodeCard: () => null,
}));
jest.mock('@/components/learner/RestoreFromCode', () => ({
  RestoreFromCode: () => null,
}));
jest.mock('@/contexts/LearnerContext', () => ({
  useLearner: () => ({ learner: null, sessionId: 'learner-a', loading: false, updateProfile: jest.fn(async () => true) }),
}));
jest.mock('@/components/learner/AvatarPicker', () => ({
  AvatarPicker: ({ onConfirm }: { onConfirm: (avatar: unknown, name: string) => void }) => (
    <button onClick={() => onConfirm({ style: 'bottts', seed: 'test' }, 'Astral Ace')}>
      Pick avatar
    </button>
  ),
}));

import { WelcomeCard } from '@/components/challenges/WelcomeCard';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';

beforeEach(() => {
  localStorage.clear();
  (getLearnerID as jest.Mock).mockReturnValue('learner-a');
});

async function renderAfterMount() {
  const view = render(<WelcomeCard />);
  await act(async () => {});
  return view;
}

describe('the first-visit welcome', () => {
  it('greets a learner on their first visit', async () => {
    await renderAfterMount();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText("Who's flying today?")).toBeTruthy();
  });

  it('does not come back once the learner closes it', async () => {
    const first = await renderAfterMount();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    await renderAfterMount();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with Escape', async () => {
    await renderAfterMount();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('still welcomes the next learner on a shared machine', async () => {
    const first = await renderAfterMount();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    (getLearnerID as jest.Mock).mockReturnValue('learner-b');
    await renderAfterMount();

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('confirms avatar and closes the dialog', async () => {
    await renderAfterMount();

    fireEvent.click(screen.getByRole('button', { name: 'Pick avatar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
