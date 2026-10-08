/**
 * @jest-environment jsdom
 */

/**
 * The [CHALLENGE SOLUTION] badge is the one visible sign, in History, that a
 * mission came from a completed Progressive Challenges challenge rather than
 * a freeform submission (see MissionWorkspace's handoff + MissionService's
 * origin/challengeId passthrough). This only checks the badge itself - the
 * rest of the card is exercised by the app already using it.
 */

import { render, screen } from '@testing-library/react';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import type { Mission } from '@/core/domain/entities/Mission';

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    yardId: 'curiosity',
    learnerRef: 'ref-1',
    sessionId: 'session-1',
    code: 'rover.forward(60)',
    status: 'queued',
    submittedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('MissionCard', () => {
  it('shows the challenge solution badge when origin is "challenge"', () => {
    render(<MissionCard mission={makeMission({ origin: 'challenge', challengeId: 'basic-movement' })} />);

    expect(screen.getByText(/challenge solution/i)).toBeInTheDocument();
  });

  it('shows no badge for a freeform mission', () => {
    render(<MissionCard mission={makeMission()} />);

    expect(screen.queryByText(/challenge solution/i)).not.toBeInTheDocument();
  });
});
