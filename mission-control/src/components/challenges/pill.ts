/**
 * The tactile pill button on the Challenges surface: a full-round face over a
 * darker 4px lip (border-b-4) that compresses to 2px when pressed, so the
 * press reads as the button physically going down.
 *
 * One helper rather than the classes repeated at each call site, because the
 * part that matters most - min-h-11 min-w-11, the 44px touch target - is the
 * part a copy drops first when someone "just tightens up" one button.
 * challengesKidUI.test.tsx asserts every tone keeps it.
 *
 * Text on every filled tone is kid-ink, never white: see the contrast note on
 * the palette in globals.css.
 */
export type PillTone = 'blue' | 'orange' | 'green' | 'plain';

const BASE =
  'inline-flex min-h-11 min-w-11 select-none items-center justify-center gap-2 rounded-full border-b-4 px-5 ' +
  'font-display font-bold transition-[transform,border-bottom-width,filter] duration-100 ' +
  'hover:brightness-105 active:translate-y-0.5 active:border-b-2 ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-kid-blue/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100 ' +
  'disabled:active:translate-y-0 disabled:active:border-b-4';

const TONES: Record<PillTone, string> = {
  blue: 'bg-kid-blue border-kid-blue-edge text-kid-ink',
  orange: 'bg-kid-orange border-kid-orange-edge text-kid-ink',
  green: 'bg-kid-green border-kid-green-edge text-kid-ink',
  plain: 'bg-kid-panel border-x-2 border-t-2 border-kid-panel-edge text-foreground',
};

export function pillClass(tone: PillTone, size: 'md' | 'lg' = 'md'): string {
  const text = size === 'lg' ? 'text-lg px-8 min-h-14' : 'text-sm';
  return `${BASE} ${TONES[tone]} ${text}`;
}
