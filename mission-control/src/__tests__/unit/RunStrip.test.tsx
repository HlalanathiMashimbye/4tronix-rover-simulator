/**
 * @jest-environment jsdom
 */

/**
 * The run strip has to survive six runs on a phone.
 *
 * It started as a dropdown (one option visible, so a child never knew a real
 * rover had run their code), became chips (discoverable, but six of them wrap
 * into a block that pushes the video off screen), and is now a scrolling strip
 * of poster frames.
 */

import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="thumb" aria-label={alt} />,
}));

import { RunStrip } from '@/components/mission/RunStrip';
import { buildRunOptions } from '@/lib/missionRuns';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

function run(yardId: string, id: string, completedAt: string): MissionRun {
  return {
    yardId,
    status: 'completed',
    youtubeUrl: `https://youtu.be/${id}`,
    completedAt,
  };
}

describe('with several runs', () => {
  const sixRuns = [
    run('curiosity', 'aaaaaaaaaaa', '2026-08-06T10:00:00Z'),
    run('yard-b', 'bbbbbbbbbbb', '2026-08-05T10:00:00Z'),
    run('yard-c', 'ccccccccccc', '2026-08-04T10:00:00Z'),
    run('yard-d', 'ddddddddddd', '2026-08-03T10:00:00Z'),
    run('yard-e', 'eeeeeeeeeee', '2026-08-02T10:00:00Z'),
    run('yard-f', 'fffffffffff', '2026-08-01T10:00:00Z'),
  ];

  it('renders every run plus the simulation', () => {
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    render(<RunStrip runs={options} selectedId={options[0].id} onSelect={() => {}} />);

    // Six rovers and one simulation, all present rather than behind a control.
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });

  it('says how many there are, so the count is known before scrolling', () => {
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    render(<RunStrip runs={options} selectedId={options[0].id} onSelect={() => {}} />);

    expect(screen.getByText('6 rover runs · simulation')).toBeInTheDocument();
  });

  it('orders newest first, so the latest run leads', () => {
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    expect(options[0].label).toBe('Cape Town');
    expect(options[options.length - 1].kind).toBe('sim');
  });

  it('tells unnamed yards apart by date rather than repeating itself', () => {
    // Two cards both reading "Real rover / Real rover" say nothing about
    // which is which, and read as a bug.
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    const unnamed = options.filter((o) => o.kind === 'real' && o.label !== 'Cape Town');

    expect(unnamed.length).toBeGreaterThan(1);
    expect(new Set(unnamed.map((o) => o.label)).size).toBe(unnamed.length);
    expect(unnamed.every((o) => o.label !== o.sublabel)).toBe(true);
  });

  it('shows a poster frame for each real run', () => {
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    render(<RunStrip runs={options} selectedId={options[0].id} onSelect={() => {}} />);

    // The thing text cannot do: a child sees a rover on dirt and understands
    // it ran somewhere real before reading a label.
    expect(screen.getAllByTestId('thumb')).toHaveLength(6);
  });

  it('selects the run that was clicked', () => {
    const options = buildRunOptions({ yardId: 'curiosity' }, sixRuns);
    const onSelect = jest.fn();
    render(<RunStrip runs={options} selectedId={options[0].id} onSelect={onSelect} />);

    fireEvent.click(screen.getAllByRole('tab')[2]);

    expect(onSelect).toHaveBeenCalledWith(options[2].id);
  });
});

describe('with nothing to choose between', () => {
  it('renders nothing when only the simulation exists', () => {
    // A strip of one is a control that implies a choice nobody has.
    const options = buildRunOptions({ yardId: 'curiosity' }, []);
    const { container } = render(
      <RunStrip runs={options} selectedId="sim" onSelect={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('runs without video', () => {
  it('leaves out a yard whose attempt produced nothing to watch', () => {
    // A failed run is simply absent, which is also how "a learner never sees
    // Failed" survives per-yard runs.
    const options = buildRunOptions({ yardId: 'curiosity' }, [
      run('curiosity', 'aaaaaaaaaaa', '2026-08-06T10:00:00Z'),
      { yardId: 'yard-b', status: 'failed' },
    ]);

    expect(options.filter((o) => o.kind === 'real')).toHaveLength(1);
  });
});
