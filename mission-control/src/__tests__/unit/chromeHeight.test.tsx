/**
 * @jest-environment jsdom
 */

/**
 * --app-chrome follows the chrome above the page when it changes without a
 * reload (ChromeHeight).
 *
 * On a phone the navbar hides on the build page and a mission's own page.
 * Tapping through to one changed the size of nothing ChromeHeight watched, so
 * it kept the navbar's 64px: every full-height page came out 64px short, with
 * the editors stopping above a band of nothing, until a refresh measured again.
 *
 * jsdom has no layout, so the page area's offset is set by hand and the one
 * element whose size the browser would report changing is the one resized.
 */

import { render } from '@testing-library/react';

import { ChromeHeight, PAGE_AREA_ID } from '@/components/layout/ChromeHeight';

const watchers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];

beforeAll(() => {
  global.ResizeObserver = class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) {
      watchers.push(this);
    }
    observe(element: Element) {
      this.targets.add(element);
    }
    unobserve(element: Element) {
      this.targets.delete(element);
    }
    disconnect() {
      this.targets.clear();
    }
  } as unknown as typeof ResizeObserver;
});

/** What the browser does when one element changes size: tells whoever watches it. */
function resized(element: Element) {
  for (const watcher of watchers) {
    if (watcher.targets.has(element)) watcher.callback([], watcher as unknown as ResizeObserver);
  }
}

it('drops the navbar from --app-chrome when the navbar hides, without a reload', () => {
  let pageTop = 93; // banner 29 + navbar 64
  const { getByTestId } = render(
    <>
      <div data-testid="banner" />
      <nav data-testid="navbar" />
      <div id={PAGE_AREA_ID} />
      <ChromeHeight />
    </>,
  );
  Object.defineProperty(document.getElementById(PAGE_AREA_ID)!, 'offsetTop', { get: () => pageTop });
  resized(document.documentElement);
  expect(document.documentElement.style.getPropertyValue('--app-chrome')).toBe('93px');

  // A tap through to a mission: the navbar goes display:none and reports a
  // zero size. Nothing else above or around the page changes size.
  pageTop = 29;
  resized(getByTestId('navbar'));
  expect(document.documentElement.style.getPropertyValue('--app-chrome')).toBe('29px');
});
