/**
 * @jest-environment jsdom
 */

/**
 * The feedback bank in the operator's note panel (AB#471): one click puts a
 * reviewed message in the box, the operator can still change it, and Send is
 * still the only thing that reaches the learner.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MissionActions } from '@/components/operator/MissionActions';
import { FEEDBACK_MESSAGES, fillFeedbackMessage } from '@/core/domain/services/feedbackMessages';
import type { Crash } from '@/core/domain/safety/crashCheck';

const settled = { id: 'm1', name: 'Rock Lover', code: 'rover.forward(60)', status: 'completed' as const };
const wall: Crash = { into: 'wall', atSeconds: 5.3, frame: 53 };

function mount(crash: Crash | null = null, status: 'completed' | 'cancelled' = 'completed') {
  render(
    <MissionActions
      mission={{ ...settled, status }}
      yardId="curiosity"
      isAdmin={false}
      mode="manual"
      onResult={jest.fn()}
      crash={crash}
    />,
  );
  return screen.getByRole('textbox', { name: /leave a note/i }) as HTMLInputElement;
}

const group = () => within(screen.getByRole('group', { name: 'Ready-written notes' }));

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

describe('the feedback bank', () => {
  it('puts a message in the note box in one click, without sending it', () => {
    const input = mount();
    const message = FEEDBACK_MESSAGES.success[0];

    fireEvent.click(screen.getByRole('button', { name: message }));

    expect(input.value).toBe(message);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lets the operator change the message before sending what they changed', async () => {
    const input = mount();
    fireEvent.click(screen.getByRole('button', { name: FEEDBACK_MESSAGES.success[1] }));
    fireEvent.change(input, { target: { value: 'Well done, Sam! Try a turn next time.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({ action: 'feedback', text: 'Well done, Sam! Try a turn next time.' });
  });

  it('opens on the crash group when the preview hits something, and says what and when', () => {
    mount(wall);

    expect(group().getByRole('button', { name: /Hit something/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/The preview hits the wall at 5.3s/)).toBeInTheDocument();
  });

  it('fills in what was hit, so the learner never sees a placeholder', () => {
    const input = mount(wall);
    const filled = fillFeedbackMessage(FEEDBACK_MESSAGES.crash[0], wall);

    fireEvent.click(screen.getByRole('button', { name: filled }));

    expect(input.value).toBe(filled);
    expect(input.value).toContain('the wall');
    expect(input.value).not.toContain('{');
  });

  it('opens on the stopped group for a run that did not finish', () => {
    // Cancelled: the note panel opens once a mission is settled, which a
    // failed one is not.
    mount(null, 'cancelled');
    expect(group().getByRole('button', { name: /Had to stop it/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: FEEDBACK_MESSAGES.stopped[0] })).toBeInTheDocument();
  });

  it('lets the operator open any group, whatever was suggested', () => {
    mount(wall);
    fireEvent.click(group().getByRole('button', { name: /Went well/ }));

    expect(screen.getByRole('button', { name: FEEDBACK_MESSAGES.success[0] })).toBeInTheDocument();
    expect(screen.queryByText(/The preview hits/)).not.toBeInTheDocument();
  });
});
