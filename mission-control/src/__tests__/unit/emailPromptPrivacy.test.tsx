/**
 * @jest-environment jsdom
 */

/**
 * Where an email address is asked for is where to say what happens to it.
 *
 * The prompt links to the privacy page in a new tab: following the link in
 * the same tab would close the prompt and lose what was typed.
 */

import { render, screen } from '@testing-library/react';

jest.mock('@/contexts/LearnerContext', () => ({
  useLearner: () => ({
    learnerEmail: null,
    setLearnerEmail: jest.fn(),
    showEmailPrompt: true,
    closeEmailPrompt: jest.fn(),
  }),
}));

import { EmailPrompt } from '@/components/learner/EmailPrompt';

it('links to the privacy page, in a new tab, from the email prompt', () => {
  render(<EmailPrompt />);

  const link = screen.getByRole('link', { name: 'How we use it' });

  expect(link).toHaveAttribute('href', '/privacy');
  expect(link).toHaveAttribute('target', '_blank');
});
