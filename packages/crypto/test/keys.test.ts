import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyMaterialError, validateKeyMaterial, type KeyMaterial } from '../src/keys';

const valid = (over: Partial<KeyMaterial> = {}): KeyMaterial => ({
  suppressionPepper: randomBytes(32),
  tokenEncryptionKey: randomBytes(32),
  activeSigningKey: { id: 'k1', secret: randomBytes(32) },
  retiredSigningKeys: [],
  ...over,
});

describe('validateKeyMaterial - ADR 0049 fails at boot, not at first use', () => {
  it('accepts well-formed material', () => {
    expect(() => validateKeyMaterial(valid())).not.toThrow();
  });

  it('rejects a short pepper', () => {
    expect(() => validateKeyMaterial(valid({ suppressionPepper: randomBytes(16) }))).toThrow(
      KeyMaterialError,
    );
  });

  it('rejects an all-zero key, which is what a missing secret decodes to', () => {
    expect(() => validateKeyMaterial(valid({ tokenEncryptionKey: Buffer.alloc(32) }))).toThrow(
      /all zero/u,
    );
  });

  /**
   * `spec/01-modules.md`: "Must not use the suppression pepper for anything
   * else." ADR 0046 makes the pepper permanently unrotatable, so any second use
   * inherits that property - and then rotating the other thing means either
   * rotating the pepper, which destroys every suppression record, or not
   * rotating at all.
   */
  it('refuses to reuse the suppression pepper as the token encryption key', () => {
    const pepper = randomBytes(32);
    expect(() =>
      validateKeyMaterial(valid({ suppressionPepper: pepper, tokenEncryptionKey: pepper })),
    ).toThrow(/must not be the same key/u);
  });

  it('refuses to reuse the suppression pepper as a signing key', () => {
    const pepper = randomBytes(32);
    expect(() =>
      validateKeyMaterial(
        valid({ suppressionPepper: pepper, activeSigningKey: { id: 'k1', secret: pepper } }),
      ),
    ).toThrow(/ADR 0046 reserves it/u);
  });

  it('rejects duplicate signing key ids, which would make verification ambiguous', () => {
    expect(() =>
      validateKeyMaterial(
        valid({
          activeSigningKey: { id: 'k1', secret: randomBytes(32) },
          retiredSigningKeys: [{ id: 'k1', secret: randomBytes(32) }],
        }),
      ),
    ).toThrow(/duplicate signing key id/u);
  });
});
