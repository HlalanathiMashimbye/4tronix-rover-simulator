/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { TourProvider, useTour } from '@/contexts/TourContext';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn() }),
}));

function TourState() {
  const { currentStep } = useTour();
  return <span data-testid="tour-step">{currentStep?.id ?? 'inactive'}</span>;
}

function ClickableMission() {
  return <div data-tour-id="tour-first-mission">First mission</div>;
}

it('advances once when Next clicks a target step', async () => {
  localStorage.clear();

  render(
    <TourProvider>
      <TourState />
      <ClickableMission />
      <TourOverlay />
    </TourProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('tour-step')).toHaveTextContent('welcome'));
  fireEvent.click(screen.getByRole('button', { name: 'Explore the Platform' }));
  await waitFor(() => expect(screen.getByTestId('tour-step')).toHaveTextContent('first-mission'));

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  await waitFor(() => expect(screen.getByTestId('tour-step')).toHaveTextContent('mission-code'));
});
