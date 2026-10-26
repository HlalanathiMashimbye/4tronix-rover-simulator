/**
 * @jest-environment jsdom
 */

/**
 * The launch sound plays when finishing a challenge unlocks a level, and at
 * no other time: not on an ordinary finish, and not for a learner who has
 * muted sound - the same switch that mutes rover videos.
 *
 * The instructions panel is stubbed to a bare Finish button, since that is
 * the only thing about it this needs; the sound itself is stubbed because
 * jsdom has no audio, and what matters here is whether it was asked for.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { setMuted } from '@/hooks/soundPreference';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/contexts/SearchContext', () => ({
  useSearch: () => ({ query: '', activeFilter: 'all' }),
}));

const completeChallenge = jest.fn();
jest.mock('@/hooks/useChallengeProgress', () => ({
  useChallengeProgress: () => ({ completeChallenge }),
}));
jest.mock('@/infrastructure/browser/challengeHandoff', () => ({ writeChallengeHandoff: jest.fn() }));
jest.mock('@/infrastructure/browser/platformMilestones', () => ({
  readMilestones: () => ({ visitedRoutes: [], missionCreated: false }),
}));
jest.mock('@/components/challenges/ChallengeCenterPanel', () => ({
  ChallengeCenterPanel: () => null,
}));
jest.mock('@/components/challenges/ChallengeInstructionsPanel', () => ({
  ChallengeInstructionsPanel: ({ onFinish }: { onFinish: () => void }) => (
    <button onClick={onFinish}>Finish</button>
  ),
}));

const playLevelUnlockSound = jest.fn();
jest.mock('@/infrastructure/browser/levelUnlockSound', () => ({
  playLevelUnlockSound: () => playLevelUnlockSound(),
}));

import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

async function finish(unlockedLevelId: number | null) {
  completeChallenge.mockResolvedValue(unlockedLevelId);
  render(<ChallengeWorkspace challenge={CHALLENGES['first-mission']} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  playLevelUnlockSound.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('level unlock sound', () => {
  it('plays once when finishing unlocks a new level', async () => {
    act(() => setMuted(false));
    await finish(2);

    expect(screen.getByText('Level 2 unlocked!')).toBeInTheDocument();
    expect(playLevelUnlockSound).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a finish that unlocks nothing', async () => {
    act(() => setMuted(false));
    await finish(null);

    expect(screen.getByText('Challenge complete!')).toBeInTheDocument();
    expect(playLevelUnlockSound).not.toHaveBeenCalled();
  });

  it('stays silent for a learner who has muted sound', async () => {
    act(() => setMuted(true));
    await finish(2);

    expect(screen.getByText('Level 2 unlocked!')).toBeInTheDocument();
    expect(playLevelUnlockSound).not.toHaveBeenCalled();
  });
});
