/**
 * @jest-environment jsdom
 */

/**
 * The operator card offers what the server will accept, for every status.
 *
 * The card had its own idea of "settled" (completed or cancelled) while the
 * server's was every status but queued and processing. A run that did not
 * finish offered Mark complete and Cancel, which the server always refused,
 * and hid the note box, which the server accepts. A cancelled mission showed
 * the note box, which the server refuses.
 */

import { render, screen } from '@testing-library/react';

import { MissionActions } from '@/components/operator/MissionActions';
import type { MissionStatus } from '@/core/domain/entities/Mission';
import { decideCancel, decideComplete, decideFeedback } from '@/core/domain/services/missionBookkeeping';

const ALL: MissionStatus[] = ['queued', 'processing', 'completed', 'failed', 'not_completed', 'cancelled'];

function mount(status: MissionStatus) {
  render(
    <MissionActions
      mission={{ id: 'm1', name: 'Rock Lover', code: 'rover.forward(60)', status }}
      yardId="curiosity"
      isAdmin={false}
      mode="manual"
      onResult={jest.fn()}
    />,
  );
}

const snapshot = (status: MissionStatus) => ({ runStatus: status, missionStatus: status, needsReview: false });

it.each(ALL)('a %s mission offers Mark complete and Cancel only when the server accepts them', (status) => {
  mount(status);

  expect(screen.queryByRole('button', { name: /mark complete/i }) !== null).toBe(decideComplete(snapshot(status)).ok);
  expect(screen.queryByRole('button', { name: /^cancel$/i }) !== null).toBe(decideCancel(snapshot(status)).ok);
});

it.each(ALL)('a %s mission offers a note for the learner only when the server accepts one', (status) => {
  mount(status);

  expect(screen.queryByLabelText(/leave a note for the learner/i) !== null).toBe(decideFeedback(snapshot(status)).ok);
});
