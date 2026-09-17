/**
 * @jest-environment jsdom
 */

/**
 * In auto, Mark complete used to be greyed out on the promise that the rover
 * would record it. When that report never came and no video was uploaded, the
 * mission could not be closed at all. It is an override now: it works, and it
 * asks first.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MissionActions } from '@/components/operator/MissionActions';

const mission = { id: 'm1', name: 'Rock Lover', code: 'rover.forward(60)', status: 'queued' as const };

function mount(mode: 'auto' | 'manual' = 'auto') {
  const onResult = jest.fn();
  render(<MissionActions mission={mission} yardId="curiosity" isAdmin={false} mode={mode} onResult={onResult} />);
  return onResult;
}

const operatorPosts = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/operator/missions/m1');

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

describe('Mark complete in auto', () => {
  it('can be pressed, and warns instead of completing straight away', () => {
    mount();

    const button = screen.getByRole('button', { name: /mark complete/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(screen.getByRole('alert')).toHaveTextContent(/normally recorded for you/i);
    expect(operatorPosts(global.fetch as jest.Mock)).toHaveLength(0);
  });

  it('completes the mission once the operator confirms', async () => {
    const onResult = mount();

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark complete anyway/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    const posts = operatorPosts(global.fetch as jest.Mock);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toMatchObject({ action: 'complete', yardId: 'curiosity' });
  });

  it('does nothing when the operator decides to keep waiting', () => {
    mount();

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep waiting/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(operatorPosts(global.fetch as jest.Mock)).toHaveLength(0);
  });
});

it('completes without asking in manual, where the operator is the only record', async () => {
  const onResult = mount('manual');

  fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));

  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
