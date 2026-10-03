/**
 * @jest-environment jsdom
 */

/**
 * The operator's mission panel shows what a mission will do, beside what was
 * written, BEFORE the controls that send it. The decision comes first.
 */

import { render, screen, act } from '@testing-library/react';

let reportSource: (source: unknown) => void = () => {};
jest.mock('@/components/operator/MissionPreview', () => ({
  MissionPreview: ({ onSourceChange }: { onSourceChange: (s: unknown) => void }) => {
    reportSource = onSourceChange;
    return <section aria-label="What it will do" />;
  },
}));
jest.mock('@/components/operator/AutomaticDispatch', () => ({ AutomaticDispatch: () => <div data-testid="dispatch" /> }));
jest.mock('@/components/operator/MissionActions', () => ({ MissionActions: () => <div data-testid="actions" /> }));
jest.mock('@/components/operator/MissionRuns', () => ({ MissionRuns: () => null }));
jest.mock('@/components/mission/BlocklyViewer', () => ({ BlocklyViewer: () => null }));

import { MissionDetail } from '@/components/operator/MissionDetail';

const mission = {
  id: 'm1',
  name: 'Rock Lover',
  code: 'rover.forward(60)\ntime.sleep(2)\nrover.stop()\n',
  status: 'queued' as const,
};

function renderDetail() {
  return render(
    <MissionDetail mission={mission} runs={[]} yards={[]} yardId="curiosity" isAdmin={false} mode="auto" onResult={() => {}} />,
  );
}

it('shows what it will do before the controls that send it', () => {
  renderDetail();
  const preview = screen.getByRole('region', { name: 'What it will do' });
  const dispatch = screen.getByTestId('dispatch');
  expect(preview.compareDocumentPosition(dispatch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('lights the code as the preview runs it', () => {
  const { container } = renderDetail();
  act(() => reportSource({ fromLine: 1, toLine: 2 }));
  expect(Array.from(container.querySelectorAll('.rover-running-line'), (el) => el.textContent)).toEqual([
    'rover.forward(60)',
    'time.sleep(2)',
  ]);
});
