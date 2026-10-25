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
import { Mission, type MissionRecord, type MissionStatus } from '@/core/domain/entities/Mission';

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

// The server's view of the same mission, with the operator's run at this yard.
const server = (status: MissionStatus) =>
  Mission.restore({ id: 'm1', status } as MissionRecord, [{ runId: 'r1', yardId: 'curiosity', status }]);

it.each(ALL)('a %s mission offers Mark complete and Cancel only when the server accepts them', (status) => {
  mount(status);

  expect(screen.queryByRole('button', { name: /mark complete/i }) !== null).toBe(server(status).complete('curiosity').ok);
  expect(screen.queryByRole('button', { name: /^cancel$/i }) !== null).toBe(server(status).cancel('curiosity').ok);
});

it.each(ALL)('a %s mission offers a note for the learner only when the server accepts one', (status) => {
  mount(status);

  expect(screen.queryByLabelText(/leave a note for the learner/i) !== null).toBe(server(status).leaveFeedback('curiosity').ok);
});
