/**
 * The Challenges surface palette clears WCAG AA contrast, computed from
 * globals.css itself.
 *
 * The palette is the kind of thing that gets "brightened" by eye, and the
 * failure is invisible to whoever does it on a good monitor: white on Scratch
 * blue looks fine and is 2.93:1. Reading the hex values out of the stylesheet
 * means a swap that drops any pair under 4.5:1 fails here rather than in a
 * classroom.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, hex] of body.matchAll(/--(kid-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[name] = hex;
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = block('[data-surface="challenges"]');
const light = { ...dark, ...block('[data-theme="light"] [data-surface="challenges"]') };

describe('the Challenges surface palette', () => {
  it('sanity: the contrast maths matches a known pair', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it.each(['kid-blue', 'kid-orange', 'kid-green'])('ink on %s fill is at least 4.5:1', (fill) => {
    expect(contrast(dark['kid-ink'], dark[fill])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('coloured and muted text on the %s panel is at least 4.5:1', (_, theme) => {
    for (const text of ['kid-blue-text', 'kid-orange-text', 'kid-green-text', 'kid-muted-text']) {
      expect(contrast(theme[text], theme['kid-panel'])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
