/**
 * What each rover command means, in words a nine-year-old can use (AB#413).
 *
 * THE GAP THIS FILLS. A learner who builds blocks now gets commented Python.
 * A learner who writes Python directly got `rover.reverse(60)` from the palette
 * and nothing else: no clue that reverse means backwards, or that 60 is a speed
 * rather than a distance, a duration, or a number of centimetres. The story is
 * about teaching what the commands mean, and that learner was taught nothing.
 *
 * ONE SOURCE OF WORDS, used by the hover, the autocomplete, and the snippets
 * the palette inserts. Blocks and Python then explain a command the same way,
 * which matters most for the child who moves between them and needs to see that
 * they are the same thing.
 *
 * Kept deliberately plain. "Drive backwards" rather than "actuate the drive
 * train in reverse", and no jargon a learner would have to look up in turn. The
 * older end of the 9-17 range is not patronised by a short true sentence; they
 * are patronised by being told what a number is.
 */

export interface CommandHelp {
  /** What it does, one sentence. */
  summary: string;
  /** What the number in the brackets means, when there is one. */
  argument?: string;
  /** A line the learner could type as-is. */
  example: string;
}

export const ROVER_COMMAND_HELP: Record<string, CommandHelp> = {
  'rover.forward': {
    summary: 'Drive forward.',
    argument: 'The number is speed, from 0 (stopped) to 100 (fastest).',
    example: 'rover.forward(60)',
  },
  'rover.reverse': {
    summary: 'Drive backwards.',
    argument: 'The number is speed, from 0 (stopped) to 100 (fastest).',
    example: 'rover.reverse(60)',
  },
  'rover.backward': {
    summary: 'Drive backwards. Another name for rover.reverse.',
    argument: 'The number is speed, from 0 (stopped) to 100 (fastest).',
    example: 'rover.backward(60)',
  },
  'rover.spinLeft': {
    summary: 'Spin left on the spot, without driving anywhere.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.spinLeft(60)',
  },
  'rover.spinRight': {
    summary: 'Spin right on the spot, without driving anywhere.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.spinRight(60)',
  },
  'rover.steerLeft': {
    summary: 'Drive forward while curving to the left.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.steerLeft(60)',
  },
  'rover.steerRight': {
    summary: 'Drive forward while curving to the right.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.steerRight(60)',
  },
  'rover.stop': {
    summary: 'Stop moving. The rover keeps going until you tell it to stop.',
    example: 'rover.stop()',
  },
  'rover.setServo': {
    summary:
      'Turn one wheel or the camera mast to an angle. Wheels are 9, 11, 13 and 15; the mast is 0.',
    argument: 'The second number is the angle. 0 points a wheel straight ahead.',
    example: 'rover.setServo(9, 0)',
  },
  'rover.getDistance': {
    summary: 'Measure how far away the nearest thing is, in centimetres.',
    example: 'print(rover.getDistance())',
  },
  'rover.setColor': {
    summary: 'Set every LED on the rover to one colour. Call rover.show() afterwards.',
    example: 'rover.setColor(rover.fromRGB(255, 0, 0))',
  },
  'rover.setPixel': {
    summary: 'Set one LED to a colour. Call rover.show() afterwards.',
    argument: 'The first number is which LED, starting at 0.',
    example: 'rover.setPixel(0, rover.fromRGB(0, 255, 0))',
  },
  'rover.fromRGB': {
    summary: 'Make a colour out of red, green and blue amounts, each 0 to 255.',
    example: 'rover.fromRGB(255, 0, 0)',
  },
  'rover.show': {
    summary: 'Actually light up the LEDs you have set. Nothing changes until you call this.',
    example: 'rover.show()',
  },
  'rover.turn_left': {
    summary: 'Turn left. Another name for rover.spinLeft.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.turn_left(60)',
  },
  'rover.turn_right': {
    summary: 'Turn right. Another name for rover.spinRight.',
    argument: 'The number is speed, from 0 to 100.',
    example: 'rover.turn_right(60)',
  },
  'rover.wait': {
    summary: 'Wait before running the next line. time.sleep does the same thing.',
    argument: 'The number is seconds.',
    example: 'rover.wait(1)',
  },
  'rover.get_distance': {
    summary: 'Measure how far away the nearest thing is, in centimetres.',
    example: 'print(rover.get_distance())',
  },
  'rover.get_heading': {
    summary: 'Ask which way the rover is facing, in degrees.',
    example: 'print(rover.get_heading())',
  },
  'time.sleep': {
    summary: 'Wait before running the next line. This is how long a move lasts.',
    argument: 'The number is seconds, and it can have a decimal point.',
    example: 'time.sleep(1.5)',
  },
  'take_photo': {
    summary: 'Take a photo with the rover camera.',
    example: 'take_photo()',
  },
  print: {
    summary: 'Show a message, so you can see what the rover found.',
    example: "print('hello')",
  },
};

/** The help text as Markdown, for a Monaco hover or completion. */
export function helpAsMarkdown(name: string): string | null {
  const help = ROVER_COMMAND_HELP[name];
  if (!help) return null;

  const parts = [`**${name}**`, '', help.summary];
  if (help.argument) parts.push('', help.argument);
  parts.push('', '```python', help.example, '```');
  return parts.join('\n');
}

/**
 * The command name at a position in a line, if there is one.
 *
 * Matches the dotted form the rover API uses, so hovering anywhere in
 * `rover.reverse` finds the whole name rather than just the half under the
 * cursor.
 */
export function commandAt(line: string, column: number): string | null {
  const pattern = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const start = match.index + 1;
    const end = start + match[0].length;
    if (column >= start && column <= end && ROVER_COMMAND_HELP[match[0]]) {
      return match[0];
    }
  }
  return null;
}
