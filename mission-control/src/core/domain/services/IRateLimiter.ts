/**
 * A rate limiter: how the public API routes keep an anonymous caller from
 * flooding them.
 *
 * The learner-facing routes are anonymous by design (a child never signs in),
 * so the only thing to key a limit on is the request's own shape: the client
 * IP, and the learner or mission id when there is one. This port says what a
 * route needs ("may this key act once more in this window?") and nothing about
 * where the count is kept.
 *
 * Fail-open is part of the contract, not an implementation detail: a child
 * submitting a mission must never be blocked because the counter's store is
 * having a bad day. An implementation that cannot reach its store answers
 * `true` (allowed) and logs, rather than throwing or denying.
 */
export interface IRateLimiter {
  /**
   * Whether the action named by `key` may happen once more, counting this one.
   *
   * A fixed window of `windowSeconds`: up to `limit` calls for a key in the
   * current window return true, the rest return false, and the next window
   * starts fresh. Returns true (fails open) if the count cannot be read or
   * written.
   */
  allow(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
