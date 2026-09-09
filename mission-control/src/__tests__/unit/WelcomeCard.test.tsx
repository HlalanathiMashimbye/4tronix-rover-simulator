/**
 * @jest-environment jsdom
 */

/**
 * The first-visit welcome.
 *
 * Every way this can go wrong is quiet: a welcome that comes back on every
 * visit teaches children to close it without reading, one keyed to the machine
 * greets only the first child at a shared laptop, and a tour link pointing at
 * the wrong challenge sends the one learner who asked for help to a 404.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/infrastructure/browser/getLearnerID', () => ({
  getLearnerID: jest.fn(() => 'learner-a'),
}));

// A plain anchor: these tests are about the welcome, not the App Router.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest} onClick={(event) => {
      event.preventDefault();
      (rest as { onClick?: () => void }).onClick?.();
    }}>
      {children}
    </a>
  ),
}));

import { WelcomeCard, TOUR_CHALLENGE_HREF } from '@/components/challenges/WelcomeCard';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import { CHALLENGES } from '@/infrastructure/config/challenges';

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

    expect(screen.getByRole('dialog', { name: 'Welcome to Mission Control' })).toBeTruthy();
  });

  it('sends the tour to a challenge that exists', async () => {
    await renderAfterMount();

    const tour = screen.getByRole('link', { name: 'Show me around' });
    expect(tour.getAttribute('href')).toBe(TOUR_CHALLENGE_HREF);
    const challengeId = TOUR_CHALLENGE_HREF.split('/').pop() as keyof typeof CHALLENGES;
    expect(CHALLENGES[challengeId]).toBeDefined();
  });

  it('does not come back once the learner closes it', async () => {
    const first = await renderAfterMount();
    fireEvent.click(screen.getByRole('button', { name: /explore on my own/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    await renderAfterMount();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('counts taking the tour as having seen it', async () => {
    const first = await renderAfterMount();
    fireEvent.click(screen.getByRole('link', { name: 'Show me around' }));
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
    fireEvent.click(screen.getByRole('button', { name: /explore on my own/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    (getLearnerID as jest.Mock).mockReturnValue('learner-b');
    await renderAfterMount();

    expect(screen.getByRole('dialog', { name: 'Welcome to Mission Control' })).toBeTruthy();
  });
});
