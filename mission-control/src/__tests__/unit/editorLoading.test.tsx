/**
 * @jest-environment jsdom
 */

/**
 * How the mission editors arrive.
 *
 * Opening Blocks or Python took about 3.7s on a good connection, because each
 * editor started downloading from a third-party CDN only once its tab was
 * clicked. Blockly now comes from our own bundle and is fetched while the page
 * is idle; Monaco is warmed the moment the Python tab is pointed at. These
 * pin both halves, and that Blockly never goes back to a CDN <script>, which
 * also ran a version (13.2.0) nothing in this repo was tested against.
 */

import { act } from '@testing-library/react';

const fakeBlockly = { VERSION: '12.5.1' };

jest.mock('blockly', () => ({ __esModule: true, default: fakeBlockly }));

const loaderInit = jest.fn();
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => null,
  loader: { init: (...a: unknown[]) => loaderInit(...a) },
}));

beforeEach(() => {
  jest.resetModules();
  loaderInit.mockReset();
  delete (window as { Blockly?: unknown }).Blockly;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('loadBlockly', () => {
  it('loads the bundled package and publishes it where the editor reads it', async () => {
    const { loadBlockly } = await import('@/infrastructure/browser/loadBlockly');

    const Blockly = await loadBlockly();

    expect(Blockly).toBe(fakeBlockly);
    expect(window.Blockly).toBe(fakeBlockly);
  });

  it('never fetches Blockly from a CDN script', async () => {
    const { loadBlockly } = await import('@/infrastructure/browser/loadBlockly');

    await loadBlockly();

    expect(document.querySelector('script[src]')).toBeNull();
  });

  it('shares one load between the editor, the viewer and the prefetch', async () => {
    const { loadBlockly } = await import('@/infrastructure/browser/loadBlockly');

    const [a, b] = [loadBlockly(), loadBlockly()];

    expect(a).toBe(b);
    await a;
  });

  it('can try again after a failed load, since a school connection can drop and come back', async () => {
    jest.doMock('blockly', () => {
      throw new Error('chunk failed');
    });
    const { loadBlockly } = await import('@/infrastructure/browser/loadBlockly');

    await expect(loadBlockly()).rejects.toThrow();

    jest.doMock('blockly', () => ({ __esModule: true, default: fakeBlockly }));
    await expect(loadBlockly()).resolves.toBe(fakeBlockly);
  });
});

describe('prefetchMonaco', () => {
  it('warms the editor once, however many times the tab is pointed at', async () => {
    loaderInit.mockResolvedValue({});
    const { prefetchMonaco } = await import('@/infrastructure/browser/prefetchMonaco');

    prefetchMonaco();
    prefetchMonaco();

    expect(loaderInit).toHaveBeenCalledTimes(1);
  });

  it('tries again later if the warm-up failed', async () => {
    loaderInit.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const { prefetchMonaco } = await import('@/infrastructure/browser/prefetchMonaco');

    prefetchMonaco();
    await act(async () => {});
    prefetchMonaco();

    expect(loaderInit).toHaveBeenCalledTimes(2);
  });
});
