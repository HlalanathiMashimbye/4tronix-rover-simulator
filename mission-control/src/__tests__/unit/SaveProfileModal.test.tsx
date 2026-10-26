/**
 * @jest-environment jsdom
 */

/**
 * The save-a-mission workflow shows the recovery code with an icon-only copy
 * button, the same control the welcome screen's recovery card uses. It used to
 * be a text "Copy" pill, so the two screens described one action two ways.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const CODE = 'ABCD-1234';

jest.mock('@/contexts/LearnerContext', () => ({
  useLearner: () => ({
    generateRecoveryCode: async () => CODE,
    linkParent: jest.fn(),
    markProfileSaved: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/container.browser', () => ({ browserAuth: () => ({}) }));
jest.mock('@/infrastructure/browser/downloadRecoveryCode', () => ({ downloadRecoveryCode: jest.fn() }));

import { SaveProfileModal } from '@/components/learner/SaveProfileModal';

const writeText = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

it('copies the recovery code from an icon button, not a text one', async () => {
  render(<SaveProfileModal open onClose={jest.fn()} />);

  const copy = await screen.findByRole('button', { name: 'Copy code' });
  expect(copy.textContent).toBe('');
  expect(copy.querySelector('svg')).not.toBeNull();

  fireEvent.click(copy);

  await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
});
