/**
 * Public reference to a learner, for use on world-readable documents.
 *
 * Mission documents used to carry the raw `learnerId`, and the feed even
 * printed it on every card. That made the id public, which had two
 * consequences:
 *
 *   1. Anyone could collect ids from the feed and fetch learner documents by
 *      exact id. That is how addresses were harvestable before they moved to a
 *      private subcollection.
 *   2. More fundamentally, possession of an id proved nothing, so nothing that
 *      accepts a learner id (POST /api/learners/[id]/email) could authenticate
 *      its caller. Anyone could write an address onto anyone's record.
 *
 * Missions now carry this one-way hash instead. The raw id never leaves
 * localStorage, so holding one is meaningful again, while a feed reader sees
 * only an opaque 64-character string.
 *
 * UNLIKE the email hash in learnerEmailHash.ts, this is genuine
 * pseudonymisation rather than damage limitation. Email addresses are low
 * entropy and a hash of one can be confirmed by guessing; a learner id is a
 * 21-character nanoid (~124 bits), so its hash cannot be reversed or
 * brute-forced.
 *
 * Uses Web Crypto, present in browsers and Node 18+, so the same function runs
 * client-side (querying your own history) and server-side (writing a mission,
 * resolving a learner to notify).
 */

export async function hashLearnerId(learnerId: string): Promise<string> {
  const normalized = learnerId.trim();

  if (!normalized) {
    throw new Error('Cannot hash an empty learner id');
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
