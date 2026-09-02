/**
 * Teaching the learner who writes Python instead of dragging blocks (AB#413).
 *
 * Comments on generated code only help somebody who generated it. A child
 * typing Python got `rover.reverse(60)` from the palette with no hint that
 * reverse means backwards, or that 60 is a speed rather than a distance, a
 * duration, or a number of centimetres. That learner was taught nothing at all,
 * which is the whole point of the story.
 */

import {
  ROVER_COMMAND_HELP,
  commandAt,
  helpAsMarkdown,
} from '@/lib/roverCommandHelp';
import { ROVER_COMMAND_ALLOWLIST } from '@/core/domain/safety/rover-command-allowlist';

describe('the command a learner is pointing at', () => {
  it('finds the whole dotted name, not the half under the cursor', () => {
    // Hovering the "rev" of rover.reverse has to explain rover.reverse.
    expect(commandAt('rover.reverse(60)', 9)).toBe('rover.reverse');
    expect(commandAt('rover.reverse(60)', 1)).toBe('rover.reverse');
    expect(commandAt('rover.reverse(60)', 13)).toBe('rover.reverse');
  });

  it('finds a command indented inside a loop', () => {
    expect(commandAt('    rover.spinLeft(60)', 12)).toBe('rover.spinLeft');
  });

  it('says nothing about a word it does not know', () => {
    expect(commandAt('rover.teleport(60)', 8)).toBeNull();
    expect(commandAt('x = 5', 2)).toBeNull();
  });
});

describe('what the learner is told', () => {
  it('explains what reverse actually means', () => {
    // The example in the story: a kid has no idea what reverse(60) does.
    const help = ROVER_COMMAND_HELP['rover.reverse'];

    expect(help.summary).toContain('backwards');
    expect(help.argument).toContain('speed');
  });

  it('says what the number is, wherever a command takes one', () => {
    // "60" is meaningless on its own. Every command with an argument has to
    // say what it measures.
    const withArguments = ['rover.forward', 'rover.reverse', 'rover.spinLeft', 'time.sleep'];

    for (const name of withArguments) {
      expect(ROVER_COMMAND_HELP[name].argument).toBeTruthy();
    }
  });

  it('gives an example the learner could type as-is', () => {
    for (const [name, help] of Object.entries(ROVER_COMMAND_HELP)) {
      expect(help.example).toContain(name.split('.').pop() as string);
    }
  });

  it('renders as markdown with the name, the meaning and an example', () => {
    const markdown = helpAsMarkdown('rover.reverse');

    expect(markdown).toContain('**rover.reverse**');
    expect(markdown).toContain('Drive backwards');
    expect(markdown).toContain('```python');
  });

  it('returns nothing for a command it has no words for', () => {
    expect(helpAsMarkdown('rover.teleport')).toBeNull();
  });
});

describe('coverage of the commands a learner can actually use', () => {
  it('explains every command the allowlist permits', () => {
    // A command the platform allows but cannot explain is one a child will
    // meet with no help at the moment they need it. Five were missing when
    // this was first written, including rover.turn_left and rover.wait.
    const unexplained = ROVER_COMMAND_ALLOWLIST.filter((c) => !ROVER_COMMAND_HELP[c]);

    expect(unexplained).toEqual([]);
  });
});
