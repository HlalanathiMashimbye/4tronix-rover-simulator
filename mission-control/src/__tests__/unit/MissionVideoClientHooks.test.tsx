/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import MissionVideoClient from '@/app/missions/[missionId]/MissionVideoClient';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import type { Mission } from '@/core/domain/entities/Mission';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/infrastructure/container.browser', () => ({
  browserMissionRepository: jest.fn(),
}));

jest.mock('@/hooks/useFavorites', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: jest.fn() }),
}));

jest.mock('@/hooks/useYardLayout', () => ({ useYardLayout: () => ({ layout: null }) }));
jest.mock('@/hooks/useMissionTrajectory', () => ({ useMissionTrajectory: () => null }));
jest.mock('@/lib/missionRuns', () => ({ buildRunOptions: () => [{ id: 'run-1' }] }));
jest.mock('@/lib/missionDuration', () => ({ durationLabel: () => '1s' }));
jest.mock('@/components/mission/RunStackCarousel', () => ({ RunStackCarousel: () => null }));
jest.mock('@/components/mission/OperatorFeedback', () => ({ OperatorFeedback: () => null }));
jest.mock('@/components/mission/BlocklyViewer', () => ({ BlocklyViewer: () => null }));
jest.mock('@/components/mission/CodeLines', () => ({ CodeLines: () => null }));

const mission = {
  id: 'mission-1',
  yardId: 'curiosity',
  learnerRef: 'learner-1',
  sessionId: 'session-1',
  code: 'print("hello")',
  status: 'completed',
  submittedAt: '2026-10-06T00:00:00.000Z',
} as Mission;

it('keeps the hook order stable when a mission finishes loading', async () => {
  (browserMissionRepository as jest.Mock).mockReturnValue({
    findById: jest.fn().mockResolvedValue(mission),
    findRuns: jest.fn().mockResolvedValue([]),
  });

  render(<MissionVideoClient missionId="mission-1" yards={[]} />);

  expect(await screen.findByRole('button', { name: /remix/i })).toBeInTheDocument();
});