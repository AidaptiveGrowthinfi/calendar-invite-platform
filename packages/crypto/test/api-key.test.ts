import { describe, expect, it } from 'vitest';
import { asOrganisationId } from '@platform/shared';
import {
  apiKeyDigest,
  apiKeyDigestMatches,
  base62DecodeUuid,
  base62EncodeUuid,
  generateApiKey,
  InvalidApiKeyError,
  parseApiKey,
} from '../src/api-key';

const ORG_A = asOrganisationId('11111111-1111-4111-8111-111111111111');
const ORG_B = asOrganisationId('22222222-2222-4222-8222-222222222222');

describe('base62 organisation segment', () => {
  it('round-trips a uuid', () => {
    expect(base62DecodeUuid(base62EncodeUuid(ORG_A))).toBe(ORG_A);
  });

  it('round-trips a uuid with leading zero bytes', () => {
    const leadingZeros = asOrganisationId('00000000-0000-4000-8000-000000000001');
    expect(base62DecodeUuid(base62EncodeUuid(leadingZeros))).toBe(leadingZeros);
  });

  it('rejects a non-base62 segment', () => {
    expect(() => base62DecodeUuid('not-base62!')).toThrow(InvalidApiKeyError);
  });
});

describe('generateApiKey - slice 1', () => {
  it('produces the gi_<org>_<secret> shape', () => {
    const key = generateApiKey(ORG_A);
    expect(key.presentedKey.startsWith(`gi_${base62EncodeUuid(ORG_A)}_`)).toBe(true);
    expect(parseApiKey(key.presentedKey).organisationId).toBe(ORG_A);
  });

  /**
   * The secret is base64url, whose alphabet includes '_'. A parser that split
   * on every underscore would shred roughly half of all generated keys, and it
   * would do so intermittently - which is the worst way to find out.
   */
  it('parses a key whose secret contains the separator character', () => {
    const secretWithSeparator = 'aa_bb_cc';
    const presented = `gi_${base62EncodeUuid(ORG_A)}_${secretWithSeparator}`;
    expect(parseApiKey(presented).organisationId).toBe(ORG_A);
  });

  it('parses every key it generates', () => {
    for (let i = 0; i < 200; i += 1) {
      const key = generateApiKey(ORG_A);
      expect(parseApiKey(key.presentedKey).organisationId).toBe(ORG_A);
      expect(apiKeyDigestMatches(parseApiKey(key.presentedKey).digest, key.keyDigest)).toBe(true);
    }
  });

  it('keeps only a display prefix and a digest - the key itself is never stored', () => {
    const key = generateApiKey(ORG_A);

    // What persists, per slice 1, is exactly these two fields.
    const persisted = { key_prefix: key.keyPrefix, key_digest: key.keyDigest };

    expect(persisted.key_digest).toHaveLength(32);
    expect(key.presentedKey.startsWith(persisted.key_prefix)).toBe(true);
    expect(persisted.key_prefix.length).toBeLessThan(key.presentedKey.length);
    expect(JSON.stringify(persisted)).not.toContain(key.presentedKey);
  });

  it('does not repeat a secret', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiKey(ORG_A).presentedKey));
    expect(seen.size).toBe(200);
  });
});

describe('the digest covers the whole presented key', () => {
  /**
   * `spec/05-invariants-and-tests.md`, slice 1: "Present a valid secret under
   * another organisation's prefix; assert zero rows." Prevents cross-tenant
   * authentication through a forged prefix.
   *
   * The database half of that test belongs to E1-2. This is the half that makes
   * it work: because the digest covers the prefix, re-prefixing a valid secret
   * changes the digest, so the lookup inside organisation B's RLS scope finds
   * nothing.
   */
  it('a valid secret re-prefixed to another organisation produces a different digest', () => {
    const issued = generateApiKey(ORG_A);
    const secret = issued.presentedKey.slice(`gi_${base62EncodeUuid(ORG_A)}_`.length);
    const forged = `gi_${base62EncodeUuid(ORG_B)}_${secret}`;

    expect(parseApiKey(forged).organisationId).toBe(ORG_B);
    expect(apiKeyDigest(forged).equals(issued.keyDigest)).toBe(false);
  });

  it('authenticates the genuine key', () => {
    const issued = generateApiKey(ORG_A);
    const parsed = parseApiKey(issued.presentedKey);

    expect(parsed.organisationId).toBe(ORG_A);
    expect(apiKeyDigestMatches(parsed.digest, issued.keyDigest)).toBe(true);
  });

  it('rejects a malformed key before it reaches the database', () => {
    const malformed = [
      ['empty', ''],
      ['no separator', 'giabcdef'],
      ['no second separator', 'gi_abc'],
      ['wrong prefix', 'xx_abc_def'],
      ['empty organisation segment', 'gi__secret'],
      ['empty secret', 'gi_abc_'],
      ['organisation segment is not base62', 'gi_!!!_secret'],
    ] as const;

    for (const [name, bad] of malformed) {
      expect(() => parseApiKey(bad), name).toThrow(InvalidApiKeyError);
    }
  });

  /**
   * A well-formed key for an organisation that does not exist parses fine.
   * That is the design, not a hole: `parseApiKey` returns a CLAIM, and the
   * digest read inside that organisation's RLS scope is what authenticates.
   * Rejecting here would mean the parser needed database access.
   */
  it('parses a well-formed key without asserting the organisation exists', () => {
    expect(() => parseApiKey('gi_abc_def_ghi')).not.toThrow();
  });
});
