/**
 * Idempotency key generation and management.
 *
 * Prevents duplicate runs when the same start action is submitted multiple
 * times (double-click, network retry, etc.). Uses a stable key based on the
 * mission, yard, and operator identity plus a time bucket to allow intentional
 * reruns while rejecting accidental duplicates.
 *
 * Time bucket window: 10 seconds. Requests for the same mission at the same
 * yard within 10 seconds are treated as duplicates. Resubmitting after that
 * window is treated as a new attempt.
 */

import crypto from 'crypto';

export const IDEMPOTENCY_WINDOW_SECONDS = 10;

/**
 * Generate a stable idempotency key for a mission start action.
 *
 * @param missionId - The mission being run
 * @param yardId - The yard running it
 * @param operatorId - Who initiated the action (optional; for future use)
 * @param now - Current timestamp (for testing)
 * @returns Stable key string
 */
export function generateIdempotencyKey(
  missionId: string,
  yardId: string,
  operatorId?: string,
  now: Date = new Date(),
): string {
  // Time bucket in seconds (divide by window size and floor)
  const timeBucket = Math.floor(now.getTime() / 1000 / IDEMPOTENCY_WINDOW_SECONDS);

  // Include operatorId if provided, otherwise use empty string
  const components = [missionId, yardId, operatorId || '', timeBucket.toString()];
  const hash = crypto
    .createHash('sha256')
    .update(components.join('|'))
    .digest('hex');

  return hash;
}

/**
 * Whether two keys represent the same user action (same mission, yard, and
 * within the same time bucket).
 */
export function isSameIdempotencyKey(keyA: string, keyB: string): boolean {
  return keyA === keyB;
}
