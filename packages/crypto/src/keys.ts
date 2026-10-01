/**
 * Key material for `platform/crypto`.
 *
 * Keys arrive from `platform/config`, which decrypts them with SOPS and age
 * (ADR 0049) and validates them at boot. Nothing here reads the environment:
 * this module is a pure function of the keys it is handed, so a test can
 * construct it with fixed keys and a caller cannot accidentally get a
 * half-configured instance.
 *
 * The four keys are separate on purpose and are NOT interchangeable.
 */

export const SUPPRESSION_PEPPER_BYTES = 32;
export const TOKEN_ENCRYPTION_KEY_BYTES = 32; // AES-256-GCM
export const SIGNING_KEY_BYTES = 32; // HMAC-SHA256

export interface SigningKey {
  /** Identifies which key signed a token, so rotation can verify old ones. */
  readonly id: string;
  readonly secret: Buffer;
}

export interface KeyMaterial {
  /**
   * ADR 0046. Used for the suppression HMAC and NOTHING ELSE.
   *
   * It can never be rotated: rotation would require recomputing digests from
   * addresses the platform has deliberately not kept. Losing it destroys every
   * suppression record irrecoverably and silently - the platform does not
   * error, it resumes sending to people who unsubscribed.
   *
   * ADR 0049 puts it in backup and restore procedures, and ADR 0036's restore
   * test must assert it comes back working. A restore that silently returns
   * without a working pepper is a correctness failure, not an availability one.
   */
  readonly suppressionPepper: Buffer;

  /** ADR 0033. AES-256-GCM for provider OAuth tokens at rest. Rotatable. */
  readonly tokenEncryptionKey: Buffer;

  /**
   * Slice 5. Signs RSVP and unsubscribe tokens. A separate key from the
   * pepper, and rotatable - revocation is by key rotation.
   *
   * The rotation POLICY is OPEN-S5 and is not decided. The format supports
   * rotation (see `id`), which is what lets the policy be decided later
   * without a migration.
   */
  readonly activeSigningKey: SigningKey;

  /**
   * Previously active signing keys, still accepted on verify. Empty until a
   * rotation policy exists (OPEN-S5).
   */
  readonly retiredSigningKeys: readonly SigningKey[];
}

export class KeyMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyMaterialError';
  }
}

function requireLength(name: string, key: Buffer, bytes: number): void {
  if (!Buffer.isBuffer(key)) {
    throw new KeyMaterialError(`${name} is not a Buffer`);
  }
  if (key.length !== bytes) {
    throw new KeyMaterialError(`${name} must be exactly ${bytes} bytes, got ${key.length}`);
  }
  if (key.every((b) => b === 0)) {
    throw new KeyMaterialError(`${name} is all zero bytes, which is never a real key`);
  }
}

/**
 * Validates key material at construction. ADR 0049 requires a missing or
 * undecryptable secret to fail at boot rather than at first use; a wrong-length
 * key is the same class of failure and fails here for the same reason.
 */
export function validateKeyMaterial(keys: KeyMaterial): KeyMaterial {
  requireLength('suppressionPepper', keys.suppressionPepper, SUPPRESSION_PEPPER_BYTES);
  requireLength('tokenEncryptionKey', keys.tokenEncryptionKey, TOKEN_ENCRYPTION_KEY_BYTES);
  requireLength('activeSigningKey.secret', keys.activeSigningKey.secret, SIGNING_KEY_BYTES);

  if (keys.activeSigningKey.id.length === 0) {
    throw new KeyMaterialError('activeSigningKey.id must not be empty');
  }

  if (keys.suppressionPepper.equals(keys.tokenEncryptionKey)) {
    throw new KeyMaterialError('suppressionPepper and tokenEncryptionKey must not be the same key');
  }
  if (keys.suppressionPepper.equals(keys.activeSigningKey.secret)) {
    throw new KeyMaterialError(
      'suppressionPepper must not be reused as a signing key - ADR 0046 reserves it',
    );
  }

  const ids = new Set<string>([keys.activeSigningKey.id]);
  for (const retired of keys.retiredSigningKeys) {
    requireLength(`retiredSigningKeys[${retired.id}].secret`, retired.secret, SIGNING_KEY_BYTES);
    if (ids.has(retired.id)) {
      throw new KeyMaterialError(`duplicate signing key id: ${retired.id}`);
    }
    ids.add(retired.id);
  }

  return keys;
}
