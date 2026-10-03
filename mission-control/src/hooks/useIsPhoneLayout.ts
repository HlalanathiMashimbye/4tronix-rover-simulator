'use client';

import { useEffect, useState } from 'react';

/**
 * Tailwind's `md` breakpoint, as a media query. The phone layout is whatever
 * `md:` utilities are not, so JS and CSS must agree on the line between them:
 * a component that thought it was on a phone while its classes laid out a
 * tablet would render the phone's controls in the tablet's grid.
 */
export const PHONE_QUERY = '(max-width: 767px)';

/**
 * Whether to render the phone layout of a page (AB#455).
 *
 * THE ONE PLACE this is decided in JavaScript. Pure styling differences stay
 * in `md:` classes; this is for the cases CSS cannot express, like rendering a
 * different component tree or passing Blockly different inject options.
 *
 * False on the server and on the first client render, then the real answer
 * after mount. The server cannot know the screen, and rendering the phone tree
 * there would fail hydration on every desktop load - the same trap the mission
 * name generator hit (see MissionWorkspace).
 */
export function useIsPhoneLayout(): boolean {
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isPhone;
}
