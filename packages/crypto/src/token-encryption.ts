/**
 * Provider token encryption at rest. ADR 0033, AES-256-GCM.
 *
 * v1's `lib/crypto.js` is the reference technique; what is taken from it is the
 * construction, not the code. The stored form is a self-describing envelope so
 * that the key can be rotated without a migration and so that a ciphertext
 * written by an older version is still readable.
 *
 * Envelope layout, all binary, stored in a `bytea` column:
 *
 *     byte  0        version (0x01)
 *     bytes 1..12    IV (12 bytes, the GCM standard length)
 *     bytes 13..28   auth tag (16 bytes)
 *     bytes 29..     ciphertext
 *
 * `bytea` and never `text` is a cross-cutting rule in `spec/00-overview.md`,
 * and the reason is stated there: so it cannot be logged as a string by
 * accident.
 *
 * What this does NOT defend against is stated in ADR 0049 and is worth
 * repeating at the point of use: an attacker with root on the VPS reads the
 * decrypted values out of the running process. This protects a database dump,
 * a backup, and a stray log line. It does not protect a compromised host.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenDecryptionError';
  }
}

/**
 * Encrypts a provider token. Returns the envelope to store in `bytea`.
 *
 * The plaintext is a string because that is what every provider hands back.
 * It is never logged, never returned in an API response, and the column it
 * lands in is binary so that an accidental `JSON.stringify` of the row does not
 * produce it.
 */
export function encryptToken(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

/**
 * Decrypts an envelope. Throws on a tampered or truncated value rather than
 * returning a partial result - GCM authenticates, and a failed tag check means
 * the stored bytes are not what was written.
 */
export function decryptToken(key: Buffer, envelope: Buffer): string {
  if (!Buffer.isBuffer(envelope) || envelope.length < HEADER_BYTES + 1) {
    throw new TokenDecryptionError('envelope is too short to be a token');
  }
  const version = envelope[0];
  if (version !== VERSION) {
    throw new TokenDecryptionError(`unknown envelope version ${String(version)}`);
  }

  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = envelope.subarray(HEADER_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately not including the underlying message: it varies by Node
    // version and adds nothing a caller can act on.
    throw new TokenDecryptionError('authentication failed - wrong key or tampered ciphertext');
  }
}
