/**
 * How long a mission will actually take to run.
 *
 * Used for the safety ceiling (AB#401) in two places: the Blockly editor warns
 * while the learner builds, and validateMission refuses at submit.
 *
 * This is domain logic - how long a mission may run is a rule about missions,
 * not a detail of how they are stored or displayed - which is why it lives in
 * core rather than in lib where it started.
 *
 * The one import below points OUT of core, which the layering rule otherwise
 * forbids. It is deliberate and it is not an infrastructure dependency:
 * roverBlockly is the rover's block language, domain logic by any reading. It
 * sits in src/lib because it is one of five modules compiled into
 * yard/satellite/static/roversim so the yard's offline editor shares exactly
 * this code, and tsconfig.roversim.json pins their paths. Moving it would
 * mean moving the build. See src/lib/README.md.
 */

import { workspaceToCommands } from '@/lib/roverBlockly';

/**
 * Total seconds a Blockly workspace will run for, loops expanded.
 *
 * This deliberately delegates to `workspaceToCommands` rather than walking the
 * blocks again. The first version of this function walked them itself and read
 * `getFieldValue('TIME')` off every motion block, which was true when it was
 * written and stopped being true one commit later: spin blocks now carry
 * DEGREES, so `TIME` came back null and every turn counted as zero. A 656
 * second spin-only mission measured as 0 and sailed past the editor guard, only
 * to be refused at submit - the exact surprise the ceiling exists to prevent.
 *
 * `workspaceToCommands` is where "what will this workspace do" already lives:
 * it expands repeats, converts spin degrees to seconds through the physics
 * model, and is what the simulator itself runs. Summing its durations means
 * this can no longer disagree with the thing it is measuring.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calculateBlocklyDuration(workspace: any): number {
  if (!workspace?.getTopBlocks) return 0;

  return workspaceToCommands(workspace).reduce(
    (total, command) => total + (Number(command.duration) || 0),
    0,
  );
}

/**
 * Total seconds a Python program will sleep for, `for _ in range(n)` loops
 * multiplied out.
 *
 * A parse rather than an execution, so it is a floor and not a guarantee: a
 * `while` loop, or a sleep whose argument is a variable, is invisible here. It
 * catches the case the ceiling is actually for, which is a learner stacking up
 * blocks until the yard is tied up for ten minutes.
 */
export function calculatePythonDuration(code: string): number {
  let totalSeconds = 0;

  // Each entry is a loop we are currently inside: the indent its `for` header
  // sat at, and how many times it runs. Recording the header's own indent is
  // what makes sequential loops work - assuming four spaces per level, as this
  // first did, left `for` number two stacked on top of `for` number one and
  // multiplied two sibling loops together.
  const loops: { indent: number; times: number }[] = [];

  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.length - line.trimStart().length;

    // Anything at or left of a loop header is outside that loop.
    while (loops.length && indent <= loops[loops.length - 1].indent) loops.pop();

    const loopMatch = trimmed.match(/^for\s+\w+\s+in\s+range\s*\(\s*(\d+)\s*\)/);
    if (loopMatch) loops.push({ indent, times: Number(loopMatch[1]) || 1 });

    const sleepMatch = trimmed.match(/time\.sleep\s*\(\s*([\d.]+)\s*\)/);
    if (sleepMatch) {
      const sleepTime = Number(sleepMatch[1]) || 0;
      totalSeconds += sleepTime * loops.reduce((acc, l) => acc * l.times, 1);
    }
  }

  return totalSeconds;
}
