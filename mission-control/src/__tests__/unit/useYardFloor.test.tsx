/**
 * @jest-environment jsdom
 */

/**
 * The yard's floor photo is loaded once for the whole page (AB#464).
 *
 * The home feed draws a dozen mission covers, each wanting the photo. Each
 * starting its own load would fetch and decode the same picture a dozen times,
 * so the load is shared, and every cover gets the photo when it lands.
 *
 * One test, in order, because the shared load is module state and the steps
 * build on it: a failed load, the retry, and a latecomer.
 */

import { renderHook, act } from '@testing-library/react';

class FakeImage {
  static made: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  decoding = '';
  constructor() {
    FakeImage.made.push(this);
  }
}
(global as unknown as { Image: unknown }).Image = FakeImage;

import { useYardFloor, YARD_FLOOR_URL } from '@/hooks/useYardFloor';

it('loads the photo once for every simulator, retries a failure, and serves latecomers', async () => {
  // A load that fails leaves the simulator on plain ground...
  const unlucky = renderHook(() => useYardFloor());
  expect(FakeImage.made).toHaveLength(1);
  expect(FakeImage.made[0].src).toBe(YARD_FLOOR_URL);
  await act(async () => {
    FakeImage.made[0].onerror?.();
  });
  expect(unlucky.result.current).toBeNull();

  // ...and the next simulators to mount try again, together: one new load.
  const first = renderHook(() => useYardFloor());
  const second = renderHook(() => useYardFloor());
  expect(FakeImage.made).toHaveLength(2);
  expect(first.result.current).toBeNull();

  await act(async () => {
    FakeImage.made[1].onload?.();
  });
  expect(first.result.current).toBe(FakeImage.made[1]);
  expect(second.result.current).toBe(FakeImage.made[1]);

  // A simulator mounted afterwards has it straight away, with no load at all.
  const late = renderHook(() => useYardFloor());
  expect(late.result.current).toBe(FakeImage.made[1]);
  expect(FakeImage.made).toHaveLength(2);
});
