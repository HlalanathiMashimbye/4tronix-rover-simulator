/** @jest-environment jsdom */
/**
 * Which links give a mission card YouTube's poster frame.
 *
 * The card used to parse links with its own regexes, which accepted any id
 * length, while the operator's attach command and the mission page used
 * youtubeLinking's getYouTubeId, which requires YouTube's 11 characters. A link
 * the operator could never attach still drew a thumbnail on the card, and it
 * was the broken one.
 */

import { render } from '@testing-library/react';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import type { Mission } from '@/core/domain/entities/Mission';

jest.mock('@/hooks/useYardLayout', () => ({ useYardLayout: () => ({ layout: null }) }));

function mission(youtubeUrl: string): Mission {
  return {
    id: 'm1',
    yardId: 'curiosity',
    learnerRef: 'ref',
    sessionId: 's1',
    name: 'Brave Falcon',
    code: 'rover.forward(60)\ntime.sleep(2)\nrover.stop()',
    status: 'completed',
    submittedAt: '2026-10-01T10:00:00.000Z',
    youtubeUrl,
  };
}

// By tag, not role: the poster frame is decorative (alt=""), so it has none.
function youtubeThumbnail(container: HTMLElement): HTMLImageElement | undefined {
  return Array.from(container.querySelectorAll('img')).find((img) => img.src.includes('img.youtube.com'));
}

it.each([
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ?si=share',
  'https://www.youtube.com/embed/dQw4w9WgXcQ',
])('shows the poster frame for %s', (url) => {
  const { container } = render(<MissionCard mission={mission(url)} />);

  expect(youtubeThumbnail(container)?.src).toContain('/vi/dQw4w9WgXcQ/');
});

it.each([
  'https://www.youtube.com/watch?v=short',
  'https://youtu.be/not-a-video-id-at-all',
])('draws no poster frame for %s, which is not a YouTube id', (url) => {
  const { container } = render(<MissionCard mission={mission(url)} />);

  expect(youtubeThumbnail(container)).toBeUndefined();
});
