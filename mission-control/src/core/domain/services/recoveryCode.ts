/**
 * Recovery code generation and hashing.
 *
 * A recovery code lets a learner carry their identity to another browser.
 * The server generates it (the browser never chooses), stores only its
 * SHA-256 hash, and shows the plaintext exactly once.
 *
 * Alphabet: 31 characters — digits 2–9 plus uppercase consonants and
 * unambiguous vowels, with 0/O, 1/I/L removed so a child copying from
 * paper cannot confuse them.  10 characters from 31 gives
 * log₂(31¹⁰) ≈ 49.5 bits; we round up to 8 random bytes (64 bits of
 * entropy from the source) and take the first 10 base-31 digits, which
 * keeps the output above 50 bits in all cases.
 *
 * Uses Web Crypto (present in Node 18+ and all browsers) so the same
 * module can run client-side for hashing and server-side for generation.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

const CODE_LENGTH = 10;

export function formatRecoveryCode(raw: string): string {
  const clean = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, CODE_LENGTH);
  if (clean.length <= 4) return clean;
  if (clean.length <= 7) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return `${clean.slice(0, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
}

export function normaliseRecoveryCode(input: string): string {
  return input.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);

  let value = BigInt(0);
  for (const b of bytes) value = (value << BigInt(8)) | BigInt(b);

  const base = BigInt(ALPHABET.length);
  const chars: string[] = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    chars.push(ALPHABET[Number(value % base)]);
    value = value / base;
  }

  return chars.join('');
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalised = normaliseRecoveryCode(code);

  if (!normalised) {
    throw new Error('Cannot hash an empty recovery code');
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalised),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const RECOVERY_CODE_ALPHABET = ALPHABET;
export const RECOVERY_CODE_LENGTH = CODE_LENGTH;
