/**
 * @jest-environment jsdom
 */

/**
 * The YouTube linker went a week without reading the channel on staging, and
 * nothing on the site said so. The console now does, cheaply.
 */

import { act, render, renderHook, screen } from '@testing-library/react';

import { YouTubeLinkStatus, clockTime } from '@/components/operator/YouTubeLinkStatus';
import { AFTER_CHECK_MS, forgetSharedReading, useYouTubeLinkStatus } from '@/hooks/useYouTubeLinkStatus';

const answer = (lastCheckedAt: string | null, intervalMinutes = 15) => ({
  ok: true,
  json: async () => ({ success: true, lastCheckedAt, intervalMinutes }),
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {});
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  forgetSharedReading();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the status line', () => {
  it('is short grey text naming the next check, with the last one a hover away', () => {
    const last = new Date('2026-09-17T13:00:10Z');
    const next = new Date('2026-09-17T13:15:00Z');
    render(<YouTubeLinkStatus status={{ state: 'on-schedule', lastCheckedAt: last, nextCheckAt: next }} />);

    const line = screen.getByText(`Next check ${clockTime(next)}`);
    expect(line).toHaveAttribute('title', `Uploads last checked ${clockTime(last)}`);
    expect(line).toHaveTextContent(`Uploads last checked ${clockTime(last)}`);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns, and says where to look, when the channel has never been read', () => {
    render(<YouTubeLinkStatus status={{ state: 'never' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Not checked yet');
    expect(screen.getByRole('status')).toHaveTextContent(/API key and channel in Settings/);
  });

  it('warns with the time a missed check was due', () => {
    const last = new Date('2026-09-17T13:00:10Z');
    const expected = new Date('2026-09-17T13:15:00Z');
    render(<YouTubeLinkStatus status={{ state: 'overdue', lastCheckedAt: last, expectedAt: expected }} />);

    expect(screen.getByRole('status')).toHaveTextContent(`Check missed ${clockTime(expected)}`);
    expect(screen.getByRole('status')).toHaveTextContent(`last checked at ${clockTime(last)}`);
  });
});

describe('reading it', () => {
  it('judges the linker against the time of the read', async () => {
    jest.setSystemTime(new Date('2026-09-17T13:40:00Z'));
    global.fetch = jest.fn().mockResolvedValue(answer('2026-09-17T13:00:10Z')) as unknown as typeof fetch;

    const { result } = renderHook(() => useYouTubeLinkStatus());
    await settle();

    expect(global.fetch).toHaveBeenCalledWith('/api/operator/youtube-link', expect.anything());
    expect(result.current?.state).toBe('overdue');
  });

  it('shares one read between the toolbar and the phone menu', async () => {
    jest.setSystemTime(new Date('2026-09-17T13:05:00Z'));
    global.fetch = jest.fn().mockResolvedValue(answer('2026-09-17T13:00:10Z')) as unknown as typeof fetch;

    renderHook(() => useYouTubeLinkStatus());
    renderHook(() => useYouTubeLinkStatus());
    await settle();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reads again shortly after the next check, and not before', async () => {
    jest.setSystemTime(new Date('2026-09-17T13:05:00Z'));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(answer('2026-09-17T13:00:10Z'))
      .mockResolvedValue(answer('2026-09-17T13:15:09Z'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useYouTubeLinkStatus());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 13:15 is the next check; nothing is read until two minutes after it.
    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000 + AFTER_CHECK_MS - 1_000);
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ state: 'on-schedule', nextCheckAt: new Date('2026-09-17T13:30:00Z') });
  });

  it('shows nothing rather than guessing when the read fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch;

    const { result } = renderHook(() => useYouTubeLinkStatus());
    await settle();

    expect(result.current).toBeNull();
  });
});
