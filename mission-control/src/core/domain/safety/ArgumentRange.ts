/**
 * The range a rover command's argument must fall inside, as a value.
 *
 * WHY A CLASS AND NOT THREE NUMBERS. The speed ceiling used to be written as
 * the literal 100 seven times in ROVER_ARGUMENT_LIMITS, once more as
 * MAX_ROVER_SPEED, and the check itself was an inline `value >= min && value
 * <= max` in the analyser. Raising any one of those to 1000 left every test in
 * the repository green, because no test pinned both sides of the boundary. The
 * range is now built once from MAX_ROVER_SPEED, and the question "is this value
 * allowed, and if not, which way is it wrong" has exactly one answer.
 *
 * Which way matters. The learner-facing message told a child that -50 was "too
 * big for speed", because the caller only knew the value was out of range.
 */

export type RangeVerdict =
  | { ok: true }
  | { ok: false; side: 'below' | 'above'; nearest: number };

export class ArgumentRange {
  constructor(
    readonly min: number,
    readonly max: number,
    /** What the argument means to a learner: "speed", "number of seconds". */
    readonly label: string,
  ) {
    // Refused at construction, so a range that can accept nothing cannot be
    // written by accident and then reject every mission.
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new RangeError(`An argument range needs min <= max, got ${min} to ${max}`);
    }
    Object.freeze(this);
  }

  check(value: number): RangeVerdict {
    if (value < this.min) return { ok: false, side: 'below', nearest: this.min };
    if (value > this.max) return { ok: false, side: 'above', nearest: this.max };
    return { ok: true };
  }
}
