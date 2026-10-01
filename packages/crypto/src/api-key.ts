/**
 * API key generation and digesting. Slice 1, ADR 0034.
 *
 * Format:  gi_<base62(organisation_id)>_<secret>
 *
 * The organisation id is IN THE KEY. Slice 1 does this so that authentication
 * can resolve a tenant before it touches the database - it parses the prefix,
 * opens `withOrg()`, and then reads the digest as `app_user` under RLS. That is
 * how `api_key` avoids becoming a fourth entry on ADR 0043's exemption list,
 * and `spec/00-overview.md` names it as one of the two features that routed
 * around the list rather than extending it.
 *
 * A plain SHA-256 digest, deliberately, not ADR 0046's HMAC. Slice 1 explains
 * why and the reason is worth keeping at the point of use: 0046 refuses a plain
 * digest because email addresses are enumerable. A 256-bit random secret is
 * not. Taking on a second permanent unrotatable pepper for a table that does
 * not need one would buy a permanent liability for the appearance of
 * consistency.
 *
 * The digest covers THE WHOLE PRESENTED STRING, prefix included.
 * `spec/05-invariants-and-tests.md` requires a test that a valid secret
 * presented under another organisation's prefix selects zero rows; that
 * property comes from digesting the whole thing rather than just the secret.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { asOrganisationId, type OrganisationId } from '@platform/shared';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PREFIX = 'gi';
const SECRET_BYTES = 32;

/** How much of the key is kept in `key_prefix` for display (slice 1). */
const DISPLAY_SECRET_CHARS = 6;

export class InvalidApiKeyError extends Error {
  constructor(reason: string) {
    super(`invalid api key: ${reason}`);
    this.name = 'InvalidApiKeyError';
  }
}

export function base62EncodeUuid(uuid: string): string {
  const hex = uuid.replace(/-/gu, '');
  if (!/^[0-9a-f]{32}$/u.test(hex)) {
    throw new InvalidApiKeyError('organisation id is not a uuid');
  }
  let n = BigInt(`0x${hex}`);
  if (n === 0n) {
    return '0';
  }
  const out: string[] = [];
  const base = 62n;
  while (n > 0n) {
    out.push(BASE62[Number(n % base)] as string);
    n /= base;
  }
  return out.reverse().join('');
}

export function base62DecodeUuid(encoded: string): OrganisationId {
  if (encoded.length === 0) {
    throw new InvalidApiKeyError('empty organisation segment');
  }
  let n = 0n;
  for (const ch of encoded) {
    const digit = BASE62.indexOf(ch);
    if (digit === -1) {
      throw new InvalidApiKeyError('organisation segment is not base62');
    }
    n = n * 62n + BigInt(digit);
  }
  const hex = n.toString(16).padStart(32, '0');
  if (hex.length !== 32) {
    throw new InvalidApiKeyError('organisation segment does not decode to a uuid');
  }
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
  return asOrganisationId(uuid);
}

export interface GeneratedApiKey {
  /**
   * The full key. Returned ONCE, at creation, and never again (slice 1).
   * It is never stored, never logged, and never included in an API response
   * after the create call that produced it.
   */
  readonly presentedKey: string;
  /** `key_prefix`. Display only, so a customer can tell two keys apart. */
  readonly keyPrefix: string;
  /** `key_digest`. SHA-256 of the whole presented key. 32 bytes. */
  readonly keyDigest: Buffer;
}

export function generateApiKey(organisationId: OrganisationId): GeneratedApiKey {
  const org = base62EncodeUuid(organisationId);
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const presentedKey = `${PREFIX}_${org}_${secret}`;
  return {
    presentedKey,
    keyPrefix: `${PREFIX}_${org}_${secret.slice(0, DISPLAY_SECRET_CHARS)}`,
    keyDigest: apiKeyDigest(presentedKey),
  };
}

/** SHA-256 over the whole presented string. */
export function apiKeyDigest(presentedKey: string): Buffer {
  return createHash('sha256').update(presentedKey, 'utf8').digest();
}

export interface ParsedApiKey {
  readonly organisationId: OrganisationId;
  readonly digest: Buffer;
}

/**
 * Parses a presented key far enough to open `withOrg()`.
 *
 * This resolves a tenant from an UNAUTHENTICATED string, so what it returns is
 * a claim, not a fact. The claim is only ever used to scope the lookup; the
 * digest comparison inside that scope is what authenticates. A forged prefix
 * therefore scopes the query to an organisation whose `api_key` rows do not
 * contain the digest, and the read returns nothing.
 */
export function parseApiKey(presentedKey: string): ParsedApiKey {
  const { organisationSegment } = splitApiKey(presentedKey);
  return {
    organisationId: base62DecodeUuid(organisationSegment),
    digest: apiKeyDigest(presentedKey),
  };
}

interface ApiKeySegments {
  readonly organisationSegment: string;
  readonly secret: string;
}

/**
 * Splits on the FIRST TWO underscores only.
 *
 * The secret is base64url, whose alphabet includes `_`, so `split('_')` would
 * shred a perfectly valid key into six pieces. The organisation segment is
 * base62 and cannot contain one, so the first two separators are unambiguous
 * and everything after them is the secret.
 */
function splitApiKey(presentedKey: string): ApiKeySegments {
  const firstSeparator = presentedKey.indexOf('_');
  if (firstSeparator === -1) {
    throw new InvalidApiKeyError('missing separator');
  }
  if (presentedKey.slice(0, firstSeparator) !== PREFIX) {
    throw new InvalidApiKeyError('unrecognised prefix');
  }

  const secondSeparator = presentedKey.indexOf('_', firstSeparator + 1);
  if (secondSeparator === -1) {
    throw new InvalidApiKeyError('missing second separator');
  }

  const organisationSegment = presentedKey.slice(firstSeparator + 1, secondSeparator);
  const secret = presentedKey.slice(secondSeparator + 1);

  if (organisationSegment.length === 0) {
    throw new InvalidApiKeyError('empty organisation segment');
  }
  if (secret.length === 0) {
    throw new InvalidApiKeyError('empty secret');
  }

  return { organisationSegment, secret };
}

/** Constant-time digest comparison, for the in-scope authentication read. */
export function apiKeyDigestMatches(presented: Buffer, stored: Buffer): boolean {
  if (presented.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(presented, stored);
}
