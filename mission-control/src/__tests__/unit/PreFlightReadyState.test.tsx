/**
 * @jest-environment jsdom
 */

/**
 * "Ready to send" and the green button are one state, shown twice.
 *
 * The badge, the button's colour and the button's disabled attribute are three
 * separate expressions of preFlight.ready living in two files. Nothing makes
 * them agree except that each reads the same flag, so the failure to guard
 * against is one of them drifting: a green button that cannot be pressed, or a
 * dark one that can.
 *
 * Asserted on the disabled attribute and the gradient class rather than on the
 * words, because the wording is copy and a rewrite of it should not fail a
 * test. The one string checked is the badge's presence/absence, which is the
 * behaviour - that it says "send" rather than "fly" is not.
 */

import { render, screen } from '@testing-library/react';
import { PreFlightChecklist } from '@/components/mission/PreFlightChecklist';
import { MissionSubmitBar } from '@/components/mission/MissionSubmitBar';
import type { PreFlightResult } from '@/core/domain/safety/preFlightChecks';

/** A result with every check in the given state - the shape the UI reads. */
function result(passed: boolean): PreFlightResult {
  return {
    ready: passed,
    duration: 10,
    checks: [
      { id: 'simulation-run', passed },
      { id: 'rover-moves', passed },
      { id: 'runs-long-enough', passed },
      { id: 'within-time-limit', passed },
    ],
  };
}

/**
 * The bar computes its own checks from the code, so the two cases differ by
 * the CODE, not by a flag. Both drive the rover; only one pauses long enough
 * to clear the duration floor, which is the check that separates them.
 */
const PASSES = `rover.forward(60)
time.sleep(3)
rover.stop()`;

const TOO_SHORT = `rover.forward(60)
rover.stop()`;

function submitBar(ready: boolean) {
  return render(
    <MissionSubmitBar
      missionName="Curious Rock Seeker"
      onMissionNameChange={() => {}}
      onSubmit={() => {}}
      submitting={false}
      submitSuccess={false}
      currentCode={ready ? PASSES : TOO_SHORT}
      hasRunSimulation
    />
  );
}

describe('the ready state', () => {
  it('shows the badge only once every check passes', () => {
    const { rerender } = render(<PreFlightChecklist result={result(false)} />);
    expect(screen.queryByText(/ready to/i)).toBeNull();

    rerender(<PreFlightChecklist result={result(true)} />);
    expect(screen.getByText(/ready to/i)).toBeInTheDocument();
  });

  it('paints the Send button green exactly when it can be pressed', () => {
    const { unmount } = submitBar(false);
    const notReady = screen.getByRole('button', { name: /send to mission control/i });
    expect(notReady).toBeDisabled();
    expect(notReady.className).toContain('bg-gradient-mars');
    expect(notReady.className).not.toContain('bg-gradient-buzz');
    unmount();

    submitBar(true);
    const ready = screen.getByRole('button', { name: /send to mission control/i });
    expect(ready).toBeEnabled();
    expect(ready.className).toContain('bg-gradient-buzz');
    expect(ready.className).not.toContain('bg-gradient-mars');
  });
});
