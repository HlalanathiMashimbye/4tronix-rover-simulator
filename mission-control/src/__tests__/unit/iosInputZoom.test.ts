/**
 * @jest-environment jsdom
 */

/**
 * The code on a phone is 13px, under the 16px at which iOS Safari zooms the
 * page on every tap into a field. That zoom is stopped on iOS only (AB#455):
 * Android honours maximum-scale as "no pinch-zoom" too, and would lose zoom
 * for the learners who need it.
 */

import { preventIosInputZoom } from '@/infrastructure/browser/iosInputZoom';

const ORIGINAL = 'width=device-width, initial-scale=1';

function onDevice(userAgent: string, platform = 'iPhone', maxTouchPoints = 5) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

const viewport = () => document.querySelector('meta[name="viewport"]')!.getAttribute('content');

beforeEach(() => {
  document.head.innerHTML = `<meta name="viewport" content="${ORIGINAL}">`;
});

it('stops the tap-zoom on an iPhone, and puts the page back on leaving', () => {
  onDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  const undo = preventIosInputZoom();
  expect(viewport()).toContain('maximum-scale=1');
  undo();
  expect(viewport()).toBe(ORIGINAL);
});

it('recognises an iPad, which reports itself as a Mac', () => {
  onDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5);
  preventIosInputZoom();
  expect(viewport()).toContain('maximum-scale=1');
});

it('leaves Android alone, where it would also disable pinch-zoom', () => {
  onDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5);
  preventIosInputZoom();
  expect(viewport()).toBe(ORIGINAL);
});

it('leaves a real Mac alone', () => {
  onDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0);
  preventIosInputZoom();
  expect(viewport()).toBe(ORIGINAL);
});
