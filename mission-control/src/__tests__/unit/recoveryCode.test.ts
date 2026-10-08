import { createHash } from 'node:crypto';
import {
  generateRecoveryCode,
  hashRecoveryCode,
  formatRecoveryCode,
  normaliseRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
} from '@/core/domain/services/recoveryCode';

describe('recovery code alphabet', () => {
  it('excludes confusable characters', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(RECOVERY_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it('provides at least 50 bits of entropy over CODE_LENGTH characters', () => {
    const bits = RECOVERY_CODE_LENGTH * Math.log2(RECOVERY_CODE_ALPHABET.length);
    expect(bits).toBeGreaterThanOrEqual(49);
  });

  it('contains only uppercase letters and digits', () => {
    expect(RECOVERY_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });
});

describe('generateRecoveryCode', () => {
  it('returns a string of exactly CODE_LENGTH characters', () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
  });

  it('uses only characters from the alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRecoveryCode();
      for (const ch of code) {
        expect(RECOVERY_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('produces different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(20);
  });
});

describe('formatRecoveryCode', () => {
  it('inserts dashes in the XXXX-XXX-XXX pattern', () => {
    expect(formatRecoveryCode('ABCDEFGHJK')).toBe('ABCD-EFG-HJK');
  });

  it('handles partial input', () => {
    expect(formatRecoveryCode('ABCD')).toBe('ABCD');
    expect(formatRecoveryCode('ABCDE')).toBe('ABCD-E');
    expect(formatRecoveryCode('ABCDEFG')).toBe('ABCD-EFG');
  });

  it('strips non-alphanumeric characters first', () => {
    expect(formatRecoveryCode('AB-CD-EFG-HJK')).toBe('ABCD-EFG-HJK');
  });

  it('uppercases', () => {
    expect(formatRecoveryCode('abcdefghjk')).toBe('ABCD-EFG-HJK');
  });
});

describe('normaliseRecoveryCode', () => {
  it('strips dashes and uppercases', () => {
    expect(normaliseRecoveryCode('abcd-efg-hjk')).toBe('ABCDEFGHJK');
  });

  it('strips spaces', () => {
    expect(normaliseRecoveryCode('ABCD EFG HJK')).toBe('ABCDEFGHJK');
  });
});

describe('hashRecoveryCode', () => {
  it('produces a 64-character hex sha-256 digest', async () => {
    const hash = await hashRecoveryCode('ABCDEFGHJK');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable', async () => {
    const a = await hashRecoveryCode('ABCDEFGHJK');
    const b = await hashRecoveryCode('ABCDEFGHJK');
    expect(a).toBe(b);
  });

  it('normalises before hashing, so dashes and case do not matter', async () => {
    const withDashes = await hashRecoveryCode('abcd-efg-hjk');
    const plain = await hashRecoveryCode('ABCDEFGHJK');
    expect(withDashes).toBe(plain);
  });

  it('separates different codes', async () => {
    expect(await hashRecoveryCode('ABCDEFGHJK')).not.toBe(
      await hashRecoveryCode('KBCDEFGHJA')
    );
  });

  it('rejects an empty code', async () => {
    await expect(hashRecoveryCode('')).rejects.toThrow('Cannot hash an empty recovery code');
    await expect(hashRecoveryCode('---')).rejects.toThrow('Cannot hash an empty recovery code');
  });

  it('matches the node:crypto digest', async () => {
    const code = 'ABCDEFGHJK';
    const fromNode = createHash('sha256').update(code).digest('hex');
    expect(await hashRecoveryCode(code)).toBe(fromNode);
  });
});

describe('round trip', () => {
  it('a generated code can be formatted, normalised, and hashed consistently', async () => {
    const raw = generateRecoveryCode();
    const formatted = formatRecoveryCode(raw);
    const normalised = normaliseRecoveryCode(formatted);
    expect(normalised).toBe(raw);

    const hashFromRaw = await hashRecoveryCode(raw);
    const hashFromFormatted = await hashRecoveryCode(formatted);
    expect(hashFromRaw).toBe(hashFromFormatted);
  });
});
