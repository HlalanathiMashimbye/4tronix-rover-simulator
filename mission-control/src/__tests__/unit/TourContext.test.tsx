/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { TourProvider, useTour } from '@/contexts/TourContext';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn() }),
}));

beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    left: 100,
    right: 200,
    bottom: 140,
    width: 100,
    height: 40,
    x: 100,
    y: 100,
    toJSON: () => {},
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function TourState() {
  const { currentStep } = useTour();
  return <span data-testid="tour-step">{currentStep?.id ?? 'inactive'}</span>;
}

function ClickableMission() {
  return <div data-tour-id="tour-first-mission">First mission</div>;
}

function DelayedBlocklyTarget() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return ready ? <div data-tour-id="tour-blockly-editor">Blockly</div> : null;
}

function DelayedSendTarget() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div inert={!ready || undefined}>
      <button data-tour-id="tour-send-mission">Send</button>
    </div>
  );
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

it('keeps waiting for a delayed editor target after the initial wait', async () => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('tour-step', '8');

  render(
    <TourProvider>
      <DelayedBlocklyTarget />
      <TourOverlay />
    </TourProvider>,
  );

  await act(async () => {
    jest.advanceTimersByTime(2500);
  });

  expect(screen.getByRole('dialog', { name: 'Build Your Mission' })).toBeInTheDocument();
});

it('waits for the mobile send target to leave the collapsed launch view', async () => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('tour-step', '12');

  render(
    <TourProvider>
      <DelayedSendTarget />
      <TourOverlay />
    </TourProvider>,
  );

  await act(async () => {
    jest.advanceTimersByTime(2500);
  });

  expect(screen.getByRole('dialog', { name: 'Mission Complete!' })).toBeInTheDocument();
  expect(document.querySelector('.tour-spotlight')).toBeInTheDocument();
});

it('keeps the final mobile spotlight aligned while the launch slot animates', async () => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('tour-step', '12');

  render(
    <TourProvider>
      <button data-tour-id="tour-send-mission">Send</button>
      <TourOverlay />
    </TourProvider>,
  );

  const target = screen.getByRole('button', { name: 'Send' });
  const getRect = jest.spyOn(target, 'getBoundingClientRect');
  getRect
    .mockReturnValueOnce({ top: 500, left: 100, width: 100, height: 40, bottom: 540, right: 200, x: 100, y: 500, toJSON: () => {} })
    .mockReturnValue({ top: 700, left: 100, width: 100, height: 40, bottom: 740, right: 200, x: 100, y: 700, toJSON: () => {} });

  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  expect(document.querySelector('.tour-spotlight')).toHaveStyle({ top: '692px' });

  await act(async () => {
    jest.advanceTimersByTime(700);
  });
});
