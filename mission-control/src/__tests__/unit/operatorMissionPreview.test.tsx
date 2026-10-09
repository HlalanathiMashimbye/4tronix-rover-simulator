/**
 * @jest-environment jsdom
 */

/**
 * The operator's mission panel shows what a mission will do, and the yard
 * checks that send it. Not the learner's code: operators judge execution.
 */

import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@/components/operator/MissionPreview', () => ({
  MissionPreview: () => <section aria-label="What it will do" />,
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

function renderDetail(onBack?: () => void) {
  return render(
    <MissionDetail mission={mission} runs={[]} yards={[]} yardId="curiosity" isAdmin={false} mode="auto" onResult={() => {}} onBack={onBack} />,
  );
}

it('puts the way back, the name and the id on one row', () => {
  // Three stacked lines, one of them mostly empty, cost the preview a row.
  const onBack = jest.fn();
  renderDetail(onBack);
  const back = screen.getByRole('button', { name: 'Back to the queue' });
  const title = screen.getByRole('heading', { name: 'Rock Lover' });
  expect(back.parentElement).toBe(title.parentElement);
  expect(title.parentElement).toHaveTextContent('m1');
  back.click();
  expect(onBack).toHaveBeenCalled();
});

it('shows what it will do before the controls that send it', () => {
  renderDetail();
  const preview = screen.getByRole('region', { name: 'What it will do' });
  const dispatch = screen.getByTestId('dispatch');
  expect(preview.compareDocumentPosition(dispatch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("does not show the learner's code, only what it will do", () => {
  renderDetail();
  expect(screen.queryByText(/what the learner wrote/i)).toBeNull();
  expect(screen.queryByText('rover.forward(60)')).toBeNull();
  expect(screen.getByTestId('dispatch')).toBeInTheDocument();
});

it('says there is more below the decision, takes the operator there, and steps aside', () => {
  // The record (Mark complete, runs, video) is below the fold so the
  // simulator can be big enough to judge by. That must not be a
  // secret.
  const scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const { container } = renderDetail();
  const cue = screen.getByRole('button', { name: /scroll for actions, runs and video/i });

  fireEvent.click(cue);
  expect(scrollIntoView).toHaveBeenCalled();
  expect(scrollIntoView.mock.contexts[0]).toContainElement(screen.getByTestId('actions'));

  const panel = container.firstElementChild as HTMLElement;
  Object.defineProperty(panel, 'scrollTop', { configurable: true, value: 200 });
  fireEvent.scroll(panel);
  expect(cue).toHaveAttribute('aria-hidden', 'true');
});
