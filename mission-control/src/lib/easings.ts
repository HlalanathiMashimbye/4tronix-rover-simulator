/**
 * Named easing curves shared across the app's hand-written CSS and any
 * Motion-driven animation. Motion's `transition` prop takes a JS array, not
 * a CSS custom property, so it can't read `--ease-out` from globals.css at
 * runtime - this is the same curve, kept in sync by hand rather than by
 * reference. If one changes, change the other.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const; // reserved for a future sheet/drawer
