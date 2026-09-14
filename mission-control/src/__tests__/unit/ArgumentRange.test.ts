/**
 * The value object every numeric rover limit is checked through.
 *
 * Both sides of each boundary are asserted together - the last value in and the
 * first value out - because asserting only one of them is what let a ceiling of
 * 1000 pass the whole suite.
 */

import { ArgumentRange } from '@/core/domain/safety/ArgumentRange';

describe('ArgumentRange', () => {
  const speed = new ArgumentRange(0, 100, 'speed');

  it('accepts both ends of the range', () => {
    expect(speed.check(0)).toEqual({ ok: true });
    expect(speed.check(100)).toEqual({ ok: true });
  });

  it('refuses the first value past the top, and says which way it is wrong', () => {
    expect(speed.check(101)).toEqual({ ok: false, side: 'above', nearest: 100 });
  });

  it('refuses the first value below the bottom, and says which way it is wrong', () => {
    expect(speed.check(-1)).toEqual({ ok: false, side: 'below', nearest: 0 });
  });

  it('refuses a fraction just past the top', () => {
    expect(speed.check(100.5).ok).toBe(false);
  });

  it('cannot be built to accept nothing', () => {
    expect(() => new ArgumentRange(10, 0, 'speed')).toThrow(RangeError);
    expect(() => new ArgumentRange(0, Number.NaN, 'speed')).toThrow(RangeError);
  });

  it('cannot be changed after it is built', () => {
    expect(() => {
      (speed as { max: number }).max = 1000;
    }).toThrow(TypeError);
    expect(speed.check(101).ok).toBe(false);
  });
});
