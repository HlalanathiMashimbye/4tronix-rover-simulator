/**
 * @jest-environment jsdom
 */

import type React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('motion/react', () => ({
  motion: {
    article: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <article {...props}>{children}</article>
    ),
  },
  useReducedMotion: () => false,
}));

jest.mock('@/components/mission/RoverSimulator', () => ({
  RoverSimulator: () => <div data-testid="simulator" />,
}));

jest.mock('@/components/mission/YouTubeEmbed', () => ({
  YouTubeEmbed: ({ youtubeId }: { youtubeId: string }) => (
    <div data-testid="youtube-player">{youtubeId}</div>
  ),
}));

import { RunStackCarousel } from '@/components/mission/RunStackCarousel';
import { buildRunOptions } from '@/lib/missionRuns';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { nanoid } from 'nanoid';

function run(yardId: string, id: string, completedAt: string): MissionRun {
  return {
    runId: nanoid(),
    yardId: yardId,
    status: 'completed',
    youtubeUrl: `https://youtu.be/${id}`,
    completedAt: completedAt,
  } as MissionRun;
}

function renderCarousel(
  runs = buildRunOptions({ yardId: 'curiosity' }, [
    run('curiosity', 'aaaaaaaaaaa', '2026-08-06T10:00:00Z'),
    run('yard-b', 'bbbbbbbbbbb', '2026-08-05T10:00:00Z'),
  ]),
) {
  const onSelect = jest.fn();
  render(
    <RunStackCarousel
      runs={runs}
      selectedId={runs[0].id}
      onSelect={onSelect}
      missionName="Sand Observer"
      trajectory={[]}
    />,
  );
  return { runs, onSelect };
}

describe('RunStackCarousel', () => {
  it('renders the active run as the platform viewing surface with count context', () => {
    renderCarousel();

    expect(screen.getByRole('region', { name: /rover run videos/i })).toBeInTheDocument();
    expect(screen.getByText('2 rover runs · simulation')).toBeInTheDocument();
    expect(screen.getByText(/Cape Town · Real rover · 1 \/ 3/i)).toBeInTheDocument();
    expect(screen.getByTestId('youtube-player')).toHaveTextContent('aaaaaaaaaaa');
  });

  it('moves between runs with arrow buttons', () => {
    const { runs, onSelect } = renderCarousel();

    fireEvent.click(screen.getByRole('button', { name: /show next rover run/i }));

    expect(onSelect).toHaveBeenCalledWith(runs[1].id);
  });

  it('moves between runs with keyboard arrows when focused', () => {
    const { runs, onSelect } = renderCarousel();

    fireEvent.keyDown(screen.getByRole('region', { name: /rover run videos/i }), {
      key: 'ArrowLeft',
    });

    expect(onSelect).toHaveBeenCalledWith(runs[runs.length - 1].id);
  });

  it('selects a run from the position controls', () => {
    const { runs, onSelect } = renderCarousel();

    fireEvent.click(screen.getByRole('tab', { name: /show simulation/i }));

    expect(onSelect).toHaveBeenCalledWith(runs[2].id);
  });

  it('uses a hosted video as the primary player when available', () => {
    const runs = buildRunOptions(
      {
        yardId: 'curiosity',
        videoUrl: 'https://storage.example.test/mission.mp4',
        youtubeUrl: 'https://youtu.be/aaaaaaaaaaa',
      },
      [],
    );

    renderCarousel(runs);

    expect(screen.getByLabelText(/Cape Town rover run video/i)).toBeInTheDocument();
    expect(screen.queryByTestId('youtube-player')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /youtube fallback/i })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    );
  });

  it('disables navigation when there is only one run', () => {
    renderCarousel(buildRunOptions({ yardId: 'curiosity' }, []));

    expect(screen.getByRole('button', { name: /show previous rover run/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /show next rover run/i })).toBeDisabled();
    expect(screen.queryByRole('tablist', { name: /choose a rover run/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
  });
});
