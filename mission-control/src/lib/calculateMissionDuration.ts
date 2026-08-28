/**
 * Calculate total mission duration from Blockly workspace, accounting for loops.
 * Returns the total seconds the mission will execute.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calculateBlocklyDuration(workspace: any): number {
  let totalSeconds = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function blockDuration(block: any, multiplier: number = 1): number {
    if (!block) return 0;

    let duration = 0;
    const type = block.type;

    switch (type) {
      case 'rover_on_receive': {
        const innerBlock = block.getInputTargetBlock('DO');
        duration = blockDuration(innerBlock, multiplier);
        break;
      }
      // Blocks with 'TIME' field that contribute to duration
      case 'rover_forward':
      case 'rover_backward':
      case 'rover_spin_left':
      case 'rover_spin_right':
      case 'rover_steer_left':
      case 'rover_steer_right':
      case 'rover_wait': {
        const t = block.getFieldValue('TIME');
        duration = (Number(t) || 0) * multiplier;
        break;
      }
      // Repeat block multiplies inner duration
      case 'rover_repeat': {
        const times = Number(block.getFieldValue('TIMES')) || 1;
        const innerBlock = block.getInputTargetBlock('DO');
        duration = blockDuration(innerBlock, multiplier * times);
        break;
      }
      // Blocks without duration
      default:
        break;
    }

    // Process next block in chain
    const nextBlock = block.getNextBlock?.();
    if (nextBlock) {
      duration += blockDuration(nextBlock, multiplier);
    }

    return duration;
  }

  // Process all top-level uplink hats
  if (workspace && workspace.getTopBlocks && typeof workspace.getTopBlocks === 'function') {
    workspace
      .getTopBlocks(true)
      .filter((b: any) => b.type === 'rover_on_receive')
      .forEach((b: any) => {
        totalSeconds += blockDuration(b);
      });
  }

  return totalSeconds;
}

/**
 * Calculate total mission duration from Python code string.
 * Looks for 'time.sleep(N)' patterns and sums them, accounting for loops.
 */
export function calculatePythonDuration(code: string): number {
  let totalSeconds = 0;
  let inLoop = false;
  let loopDepth = 0;
  const loopMultipliers: number[] = [];

  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Track loop entry
    if (trimmed.match(/^for\s+\w+\s+in\s+range\s*\(\s*(\d+)\s*\)/)) {
      const match = trimmed.match(/^for\s+\w+\s+in\s+range\s*\(\s*(\d+)\s*\)/);
      if (match) {
        const times = Number(match[1]) || 1;
        loopMultipliers.push(times);
        loopDepth++;
        inLoop = true;
      }
    }

    // Detect time.sleep calls
    const sleepMatch = trimmed.match(/time\.sleep\s*\(\s*([\d.]+)\s*\)/);
    if (sleepMatch) {
      const sleepTime = Number(sleepMatch[1]) || 0;
      let multiplier = 1;
      // Multiply by all active loop depths
      for (const loopTimes of loopMultipliers) {
        multiplier *= loopTimes;
      }
      totalSeconds += sleepTime * multiplier;
    }

    // Track loop exit (simplistic - counts ':' dedent)
    // This is a heuristic that works for standard indentation
    if (inLoop && loopDepth > 0 && trimmed.length > 0) {
      const indent = line.length - line.trimLeft().length;
      // If line indent is <= loop indent, exit loop
      // We assume 4 spaces per indent level
      const expectedLoopIndent = (loopDepth - 1) * 4;
      if (indent <= expectedLoopIndent && !trimmed.startsWith('for')) {
        loopDepth--;
        loopMultipliers.pop();
        inLoop = loopDepth > 0;
      }
    }
  }

  return totalSeconds;
}

/**
 * Find all speed values in Python code and return the maximum.
 * Returns 0 if no speed values found (no speed limit check needed).
 */
export function findMaxSpeedInPython(code: string): number {
  let maxSpeed = 0;

  // Match rover.forward(N), rover.reverse(N), rover.spinLeft(N), rover.spinRight(N)
  const speedPattern = /rover\.(forward|reverse|spinLeft|spinRight|steerLeft|steerRight)\s*\(\s*(\d+)\s*\)/g;

  let match;
  while ((match = speedPattern.exec(code)) !== null) {
    const speed = Number(match[2]) || 0;
    maxSpeed = Math.max(maxSpeed, speed);
  }

  return maxSpeed;
}
