/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import MissionVideoClient from '@/app/missions/[missionId]/MissionVideoClient';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import type { Mission } from '@/core/domain/entities/Mission';
import { missionSlug } from '@/core/domain/services/missionSlug';
import { allGeneratedMissionNames } from '@/core/domain/services/missionNameGenerator';

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
describe('opened from a name link', () => {
  const named = { ...mission, id: 'jLSLqPhCp1RuUo2CpfQUA', name: allGeneratedMissionNames()[0] } as Mission;
  const slug = missionSlug(named);

  it('finds the mission by its ID prefix and loads its runs by its real ID', async () => {
    const findByIdPrefix = jest.fn().mockResolvedValue([named]);
    const findById = jest.fn();
    const findRuns = jest.fn().mockResolvedValue([]);
    (browserMissionRepository as jest.Mock).mockReturnValue({ findById, findByIdPrefix, findRuns });

    render(<MissionVideoClient missionId={slug} yards={[]} />);

    expect(await screen.findByRole('button', { name: /remix/i })).toBeInTheDocument();
    expect(findByIdPrefix).toHaveBeenCalledWith('jLSLqP', expect.any(Number));
    expect(findById).not.toHaveBeenCalled();
    expect(findRuns).toHaveBeenCalledWith('jLSLqPhCp1RuUo2CpfQUA');
  });

  it('says not found rather than guessing when no mission has the prefix', async () => {
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(), findByIdPrefix: jest.fn().mockResolvedValue([]), findRuns: jest.fn(),
    });
    render(<MissionVideoClient missionId={slug} yards={[]} />);
    expect(await screen.findByRole('heading', { name: /mission not found/i })).toBeInTheDocument();
  });

  it('turns an old full-ID link into the name link in the address bar', async () => {
    window.history.replaceState(null, '', `/missions/${named.id}?run=x`);
    (browserMissionRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue(named), findByIdPrefix: jest.fn(), findRuns: jest.fn().mockResolvedValue([]),
    });
    render(<MissionVideoClient missionId={named.id} yards={[]} />);
    await screen.findByRole('button', { name: /remix/i });
    expect(window.location.pathname).toBe(`/missions/${slug}`);
    expect(window.location.search).toBe('?run=x');
  });
});
