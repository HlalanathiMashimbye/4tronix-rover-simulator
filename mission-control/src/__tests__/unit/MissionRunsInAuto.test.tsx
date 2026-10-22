/**
 * @jest-environment jsdom
 */

/**
 * In auto, every run control was hidden or greyed out on the grounds that the
 * platform attaches videos itself. A wrong link, a run logged twice, or a video
 * the linker never found then had no fix at all. They are exceptions, and
 * exceptions need a person.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MissionRuns } from '@/components/operator/MissionRuns';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

const yards = [
  { id: 'curiosity', name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true },
  { id: 'durban', name: 'Durban Yard', area: 'Umhlanga', city: 'Durban', active: true },
];

function mount(runs: MissionRun[]) {
  const onResult = jest.fn();
  render(<MissionRuns missionId="m1" runs={runs} yards={yards} yardId="curiosity" mode="auto" onResult={onResult} />);
  return onResult;
}

function postedBodies(): Array<Record<string, unknown>> {
  return (global.fetch as jest.Mock).mock.calls
    .filter(([url]) => url === '/api/operator/missions/m1')
    .map(([, init]) => JSON.parse(init.body));
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

it('logs another run', async () => {
  const onResult = mount([]);

  const button = screen.getByRole('button', { name: /log another run/i });
  expect(button).toBeEnabled();
  fireEvent.click(button);

  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(postedBodies()).toEqual([expect.objectContaining({ action: 'another-run', yardId: 'curiosity' })]);
});

it('adds a video link the linker never found', async () => {
  const onResult = mount([{ runId: 'r1', yardId: 'curiosity', status: 'completed' }]);

  fireEvent.click(screen.getByRole('button', { name: /add video/i }));
  fireEvent.change(screen.getByRole('textbox', { name: /youtube link/i }), {
    target: { value: 'https://youtu.be/K74wugp8su8' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(postedBodies()).toEqual([
    expect.objectContaining({ action: 'attach-video', runId: 'r1', url: 'https://youtu.be/K74wugp8su8' }),
  ]);
});

it('replaces and removes a wrong video', async () => {
  const onResult = mount([
    { runId: 'r1', yardId: 'curiosity', status: 'completed', youtubeUrl: 'https://youtu.be/wrongwrong1' },
  ]);

  expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /remove video/i }));

  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(postedBodies()).toEqual([expect.objectContaining({ action: 'remove-video', runId: 'r1' })]);
});

it('shows automatic upload status separately while keeping manual link controls', async () => {
  global.fetch = jest.fn().mockImplementation((url: string) => Promise.resolve({
    ok: true,
    json: async () => url.includes('/youtube-upload/status')
      ? {
        success: true,
        uploads: [{
          missionId: 'm1',
          dispatchId: 'rover-dispatch-1',
          yardId: 'curiosity',
          recordingName: 'm1__curiosity__20261011T102030Z.mp4',
          status: 'uploaded',
          attempts: 1,
          url: 'https://www.youtube.com/watch?v=automatic123',
          updatedAt: '2026-10-11T10:30:00.000Z',
        }],
      }
      : { success: true },
  }));

  mount([{
    runId: 'manual-run-1',
    yardId: 'curiosity',
    status: 'completed',
    youtubeUrl: 'https://youtu.be/manual12345',
  }]);

  expect(await screen.findByText('Automatic YouTube uploads')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Watch automatic upload' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=automatic123',
  );
  expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', 'https://youtu.be/manual12345');
  expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
});

it('deletes a run, after asking', async () => {
  const onResult = mount([{ runId: 'r1', yardId: 'curiosity', status: 'completed' }]);

  const remove = screen.getByRole('button', { name: /delete this run/i });
  fireEvent.click(remove);
  expect(postedBodies()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /delete this run/i }));

  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(postedBodies()).toEqual([expect.objectContaining({ action: 'delete-run', runId: 'r1' })]);
});

it("still offers no controls on another yard's run", () => {
  mount([{ runId: 'r2', yardId: 'durban', status: 'completed' }]);

  expect(screen.queryByRole('button', { name: /add video/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /delete this run/i })).not.toBeInTheDocument();
});
