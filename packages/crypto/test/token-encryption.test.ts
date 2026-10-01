import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, TokenDecryptionError } from '../src/token-encryption';

const KEY = randomBytes(32);

describe('provider token encryption - ADR 0033', () => {
  it('round-trips', () => {
    const token = 'ya29.a0AfH6SM' + 'x'.repeat(180);
    expect(decryptToken(KEY, encryptToken(KEY, token))).toBe(token);
  });

  it('round-trips a token with non-ascii content', () => {
    const token = `refresh-${String.fromCodePoint(0x00fc)}-${String.fromCodePoint(0x4e2d)}`;
    expect(decryptToken(KEY, encryptToken(KEY, token))).toBe(token);
  });

  it('produces a different envelope each time, so equal tokens are not equal ciphertexts', () => {
    const a = encryptToken(KEY, 'same-token');
    const b = encryptToken(KEY, 'same-token');
    expect(a.equals(b)).toBe(false);
  });

  it('returns a Buffer, so the column is bytea and not text', () => {
    // spec/00-overview.md: encrypted material is bytea, never text, so it
    // cannot be logged as a string by accident.
    expect(Buffer.isBuffer(encryptToken(KEY, 'tok'))).toBe(true);
  });

  it('fails on the wrong key rather than returning garbage', () => {
    const envelope = encryptToken(KEY, 'tok');
    expect(() => decryptToken(randomBytes(32), envelope)).toThrow(TokenDecryptionError);
  });

  it('fails on a tampered ciphertext', () => {
    const envelope = encryptToken(KEY, 'tok');
    envelope[envelope.length - 1] ^= 0xff;
    expect(() => decryptToken(KEY, envelope)).toThrow(TokenDecryptionError);
  });

  it('fails on a tampered auth tag', () => {
    const envelope = encryptToken(KEY, 'tok');
    envelope[14] ^= 0xff;
    expect(() => decryptToken(KEY, envelope)).toThrow(TokenDecryptionError);
  });

  it('fails on a truncated envelope', () => {
    const envelope = encryptToken(KEY, 'tok');
    expect(() => decryptToken(KEY, envelope.subarray(0, 10))).toThrow(TokenDecryptionError);
  });

  it('fails on an unknown version byte, so a future format is not misread', () => {
    const envelope = encryptToken(KEY, 'tok');
    envelope[0] = 0x02;
    expect(() => decryptToken(KEY, envelope)).toThrow(/unknown envelope version/u);
  });

  it('never puts the plaintext in the error message', () => {
    const secret = 'super-secret-refresh-token';
    const envelope = encryptToken(KEY, secret);
    envelope[envelope.length - 1] ^= 0x01;
    try {
      decryptToken(KEY, envelope);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
