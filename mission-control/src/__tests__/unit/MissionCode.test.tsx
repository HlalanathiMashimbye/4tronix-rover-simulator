/**
 * @jest-environment jsdom
 */

/**
 * A mission's code on its page: always open where there is room beside the
 * feed, and a bar under the simulation on a phone, closed until asked for.
 */

import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blocks" />,
}));
jest.mock('@/components/mission/CodeLines', () => ({
  CodeLines: ({ code }: { code: string }) => <pre data-testid="python">{code}</pre>,
}));

import { MissionCode } from '@/components/mission/MissionCode';
import type { MissionRecord } from '@/core/domain/entities/Mission';

const python = { id: 'm1', name: 'Sand Observer', code: 'rover.forward(60)', status: 'completed' } as MissionRecord;
const blocks = { ...python, blocklyState: '{"blocks":{}}' } as MissionRecord;

describe('beside the feed', () => {
  it('shows the code without being asked', () => {
    render(<MissionCode mission={python} highlight={null} />);

    expect(screen.getByTestId('python')).toHaveTextContent('rover.forward(60)');
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
  });

  it('opens a block-built mission on its blocks, with the Python one press away', () => {
    render(<MissionCode mission={blocks} highlight={null} />);
    expect(screen.getByTestId('blocks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Python' }));

    expect(screen.getByTestId('python')).toBeInTheDocument();
    expect(screen.queryByTestId('blocks')).not.toBeInTheDocument();
  });

  it('offers no Blocks switch for a mission written in Python', () => {
    render(<MissionCode mission={python} highlight={null} />);

    expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument();
  });

  it('sets what the page gives it into the foot of the card, after the code', () => {
    // From a tablet up that is the operator's note and Remix.
    render(<MissionCode mission={python} highlight={null} footer={<p data-testid="foot">a note</p>} />);
    const card = screen.getByRole('region', { name: 'Code' });
    const foot = screen.getByTestId('foot');

    expect(card).toContainElement(foot);
    expect(screen.getByTestId('python').compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no foot when it is given nothing to put there', () => {
    const { container } = render(<MissionCode mission={python} highlight={null} />);

    // Header and code, and no third box with a rule along its top.
    expect(container.querySelector('section')!.children).toHaveLength(2);
  });
});

describe('on a phone, under the simulation', () => {
  it('is a closed bar that says it is there, and renders no code yet', () => {
    // The block viewer sizes the program to its box. In a box of no height
    // it sized it to nothing, so closed means not rendered at all.
    render(<MissionCode mission={blocks} highlight={null} collapsible open={false} onToggle={() => {}} />);

    expect(screen.getByRole('button', { name: /code/i, expanded: false })).toBeInTheDocument();
    expect(screen.queryByTestId('blocks')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('asks the page to open it when the bar is pressed', () => {
    const onToggle = jest.fn();
    render(<MissionCode mission={python} highlight={null} collapsible open={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /code/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the code and its controls once open, and the bar then closes it', () => {
    render(<MissionCode mission={blocks} highlight={null} collapsible open onToggle={() => {}} />);

    expect(screen.getByRole('button', { name: /code/i, expanded: true })).toBeInTheDocument();
    expect(screen.getByTestId('blocks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Python' })).toBeInTheDocument();
  });
});
