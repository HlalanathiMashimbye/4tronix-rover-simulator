'use client';

/**
 * Publishes how much fixed chrome sits above the page, as --app-chrome.
 *
 * Eleven pages size themselves with calc(100vh - 64px), 64px being the
 * navbar. That is exact in production and wrong everywhere else: the
 * environment banner renders in dev and staging, pushing the page down about
 * 37px, so every one of those pages ran 37px past the bottom of the viewport
 * with overflow hidden and quietly clipped whatever was last. On the mission
 * view that was the stats row and the remix button.
 *
 * Measured rather than hardcoded, because the banner's height is not a
 * constant: the staging message is a whole sentence and wraps to two lines on
 * a narrow screen, so any number written down here would be wrong at some
 * width. The measurement is the page area's own offset from the top of the
 * document, which is by definition what those pages need to subtract, and it
 * picks up the navbar, the banner and anything else that lands between them.
 *
 * Costs nothing in production: with no banner it measures 64px, which is what
 * the pages were already assuming.
 */

import { useLayoutEffect } from 'react';

export const PAGE_AREA_ID = 'app-page-area';

export function ChromeHeight() {
  useLayoutEffect(() => {
    const area = document.getElementById(PAGE_AREA_ID);
    if (!area) return;

    const publish = () => {
      // offsetTop walks to the offset parent; the page area's ancestors are
      // all static, so this is its distance from the top of the document,
      // which is unaffected by how far the page happens to be scrolled.
      let top = 0;
      for (let el: HTMLElement | null = area; el; el = el.offsetParent as HTMLElement | null) {
        top += el.offsetTop;
      }
      document.documentElement.style.setProperty('--app-chrome', `${Math.round(top)}px`);
    };

    publish();

    // The banner wraps at narrow widths and the navbar has its own responsive
    // shape, so this is not a measure-once value.
    const observer = new ResizeObserver(publish);
    if (area.parentElement) observer.observe(area.parentElement);
    observer.observe(document.documentElement);
    // And the chrome itself. On a phone the navbar hides on the build page and
    // a mission's own page, and arriving there by a tap (no reload) changes
    // the size of nothing watched above: the page area moved up 64px, but its
    // parent and the document stayed the same size. So --app-chrome kept the
    // navbar, every full-height page came out 64px short, and the editors
    // stopped with a band of nothing under them until the page was reloaded.
    // An element that goes display:none reports a zero size, so watching
    // everything above the page area catches it.
    for (let el = area.previousElementSibling; el; el = el.previousElementSibling) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return null;
}
