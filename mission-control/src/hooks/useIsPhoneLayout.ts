'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Tailwind's `md` breakpoint, as a media query. The phone layout is whatever
 * `md:` utilities are not, so JS and CSS must agree on the line between them:
 * a component that thought it was on a phone while its classes laid out a
 * tablet would render the phone's controls in the tablet's grid.
 */
export const PHONE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  // Every browser we support has it; jsdom and some embedded webviews do
  // not, and a layout hint is no reason to take the editor down.
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/** The server cannot see the screen. */
function getServerSnapshot(): null {
  return null;
}

/**
 * Whether to render the phone layout of a page (AB#455), or null while that
 * cannot be known yet: on the server, and while the browser hydrates what the
 * server sent.
 *
 * THE ONE PLACE this is decided in JavaScript. Pure styling differences stay
 * in `md:` classes; this is for what CSS cannot express, like rendering a
 * different component tree or passing Blockly different inject options.
 *
 * WHY null AND NOT false. This used to start as false and correct itself in
 * an effect. The server therefore rendered the desktop layout, and a phone
 * painted that HTML before any JavaScript ran: two stacked panels flashed up,
 * then the phone layout replaced them. A page that renders different trees
 * per layout should render neither until this is known (MissionWorkspace
 * shows a loading frame). useSyncExternalStore gives the server's null to
 * hydration, then re-renders with the real answer before the browser paints,
 * and a component mounted after hydration gets the real answer on its first
 * render, so nothing mounts twice.
 */
export function usePhoneLayout(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The same, for components that are only ever rendered once the layout is
 * known (inside MissionWorkspace's real tree), where null cannot happen in
 * practice and false is the safe reading if it ever did.
 */
export function useIsPhoneLayout(): boolean {
  return usePhoneLayout() ?? false;
}

/** Below this many pixels of hidden screen it is browser chrome, not a keyboard. */
const KEYBOARD_MIN_PX = 150;

export interface OnScreenKeyboard {
  /** Whether a software keyboard is covering part of the page. */
  open: boolean;
  /**
   * How many pixels of the LAYOUT the keyboard covers, which the page must
   * give up to stay above it. 0 where the browser already shrank the layout
   * for the keyboard (some Android browsers do), since giving it up twice
   * would leave a gap.
   */
  inset: number;
}

const CLOSED: OnScreenKeyboard = { open: false, inset: 0 };

/**
 * The on-screen keyboard, measured (AB#455).
 *
 * iOS Safari, and Chrome on Android by default, open the keyboard OVER the
 * page without resizing it, so 100dvh still means the whole screen and the
 * bottom of a full-height layout sits behind the keys. visualViewport is the
 * only thing that reports the part still visible.
 *
 * Pinch-zoom also shrinks visualViewport, so a zoomed-in page is not taken
 * for a keyboard. Where the browser resizes the layout itself, innerHeight
 * falls with it, which is why "open" compares against the tallest the window
 * has been at this width rather than against innerHeight.
 */
export function useOnScreenKeyboard(): OnScreenKeyboard {
  const [keyboard, setKeyboard] = useState<OnScreenKeyboard>(CLOSED);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let tallest = window.innerHeight;
    let width = window.innerWidth;

    const update = () => {
      // A rotation is a new screen, not a keyboard.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = window.innerHeight;
      }
      tallest = Math.max(tallest, window.innerHeight);

      const zoomed = viewport.scale > 1.01;
      const hidden = tallest - viewport.height;
      const open = !zoomed && hidden > KEYBOARD_MIN_PX;
      const inset = open ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;

      setKeyboard((previous) =>
        previous.open === open && previous.inset === inset ? previous : { open, inset },
      );
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return keyboard;
}
