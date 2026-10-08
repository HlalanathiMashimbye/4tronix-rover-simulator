/**
 * @jest-environment jsdom
 */

/**
 * Running a program on a phone, end to end through Create Mission
 * (6 Oct 2026).
 *
 * Run plays the program with the editor on screen, Run reads Stop while it
 * plays and Stop pauses the simulator, and the end of the run, not the press
 * of Run, opens the launch view. buildPhoneLayout.test.tsx checks the layout
 * on its own; this checks that the workspace actually tells it when a run is
 * playing and when one has ended.
 */

import { useEffect } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('mode=blockly') }));
jest.mock('@/infrastructure/container.browser', () => ({
  browserMissionRepository: jest.fn(),
}));
jest.mock('@/contexts/LearnerContext', () => ({
  useLearner: () => ({ learnerEmail: 'learner@example.com', openEmailPrompt: () => {}, showEmailPrompt: false }),
}));
jest.mock('@/hooks/useIsPhoneLayout', () => ({
  ...jest.requireActual('@/hooks/useIsPhoneLayout'),
  usePhoneLayout: () => true,
}));
// An editor holding a one-block program, with the Run it registers.
jest.mock('@/components/mission/EditorPanel', () => ({
  EditorPanel: ({
    onRegisterRun,
    onGenerateCommands,
    onCodeChange,
  }: {
    onRegisterRun: (run: () => void) => void;
    onGenerateCommands: (commands: unknown[]) => void;
    onCodeChange: (code: string) => void;
  }) => {
    useEffect(() => onCodeChange('rover.forward(60)\ntime.sleep(1)\nrover.stop()'), [onCodeChange]);
    useEffect(() => onRegisterRun(() => onGenerateCommands([{ command: 'forward', speed: 60, duration: 1 }])));
    return <div data-testid="editor" />;
  },
}));
// The simulator as the props it is given, so the test can play its part.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let simulator: any = null;
jest.mock('@/components/mission/RoverSimulator', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RoverSimulator: (props: any) => {
    simulator = props;
    return <div data-testid="simulator" />;
  },
}));
jest.mock('@/components/mission/MissionSubmitBar', () => ({ MissionSubmitBar: () => <div data-testid="submit-bar" /> }));
jest.mock('@/components/mission/MissionSentDialog', () => ({ MissionSentDialog: () => null }));

import { MissionWorkspace } from '@/components/mission/MissionWorkspace';

beforeEach(() => {
  jest.useFakeTimers();
  simulator = null;
});
afterEach(() => jest.useRealTimers());

const launching = () => document.querySelector('.phoneWorkspace')?.getAttribute('data-launch');

it('plays the run with the editor on screen', () => {
  render(<MissionWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  act(() => jest.advanceTimersByTime(2000));
  expect(simulator.isPlaying).toBe(true);
  expect(simulator.trajectory.length).toBeGreaterThan(0);
  expect(launching()).toBe('false');
});

it('offers Stop while the run plays, which pauses the simulator', () => {
  render(<MissionWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  act(() => simulator.onRunningChange(true));
  const pausesBefore = simulator.pauseVersion;
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(simulator.pauseVersion).toBe(pausesBefore + 1);
  act(() => simulator.onRunningChange(false));
  expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(2000));
  expect(launching()).toBe('false');
});

it('opens the launch view when the run has played to its end', () => {
  render(<MissionWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  act(() => simulator.onFinished());
  act(() => jest.advanceTimersByTime(2000));
  expect(launching()).toBe('true');
  expect(screen.getByRole('region', { name: 'Send your mission' })).toContainElement(screen.getByTestId('submit-bar'));
});
