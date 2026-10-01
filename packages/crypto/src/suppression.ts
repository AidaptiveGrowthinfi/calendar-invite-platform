/**
 * The suppression digest. ADR 0046.
 *
 *   digest = HMAC-SHA256(key = pepper, message = organisation_id || 0x00 || normalised_address)
 *
 * A plain SHA-256 is not sufficient: the space of email addresses is small and
 * enumerable, so an unkeyed digest is recoverable by brute force and is treated
 * by regulators as pseudonymised personal data, which would leave the erasure
 * conflict exactly where it started.
 *
 * The organisation identifier is part of the HMAC message, not merely a column.
 * The same address suppressed in two organisations produces two unrelated
 * digests, so suppression lists cannot be correlated across tenants even by
 * someone holding the pepper and the database.
 *
 * FROZEN. Every byte of the message construction below is frozen from the first
 * written row, for the same reason the normalisation rules are: digests cannot
 * be recomputed from addresses the platform no longer holds. Changing the
 * separator, the encoding, or the field order silently orphans every existing
 * suppression entry and re-enables sending to people who unsubscribed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrganisationId } from '@platform/shared';
import { maskNormalisedAddress, normaliseEmailAddress } from './email';

/** The separator byte between the organisation id and the address. Frozen. */
const SEPARATOR = Buffer.from([0x00]);

export interface SuppressionEntry {
  /** The keyed digest. 32 bytes. This is what is stored. */
  readonly digest: Buffer;
  /** `jo***@gmail.com`. Stored for the customer-visible list (ADR 0046). */
  readonly maskedAddress: string;
}

/**
 * Computes the digest for a raw address as supplied by an import, an
 * unsubscribe click, or a provider webhook.
 *
 * Takes the raw address, not a normalised one, and normalises it here. That is
 * deliberate: it removes every opportunity for a caller to normalise it
 * themselves, differently. Slice 2 identifies exactly that drift as the silent,
 * unrepairable failure.
 */
export function suppressionEntryFor(
  pepper: Buffer,
  organisationId: OrganisationId,
  rawAddress: string,
): SuppressionEntry {
  const normalised = normaliseEmailAddress(rawAddress);
  return {
    digest: digestOfNormalised(pepper, organisationId, normalised),
    maskedAddress: maskNormalisedAddress(normalised),
  };
}

/**
 * Membership test. The only operation suppression performs (ADR 0046):
 * normalise the incoming address, compute its digest, compare.
 *
 * Constant-time. The digests are keyed so a timing oracle is a weak attack,
 * but the comparison costs nothing to do correctly.
 */
export function suppressionDigestMatches(
  pepper: Buffer,
  organisationId: OrganisationId,
  rawAddress: string,
  storedDigest: Buffer,
): boolean {
  const candidate = digestOfNormalised(pepper, organisationId, normaliseEmailAddress(rawAddress));
  if (candidate.length !== storedDigest.length) {
    return false;
  }
  return timingSafeEqual(candidate, storedDigest);
}

/**
 * The frozen construction. Exported so the digest can be recomputed in a test
 * from a known-normalised string, and for no other reason - product code calls
 * `suppressionEntryFor`, which owns the normalisation.
 */
export function digestOfNormalised(
  pepper: Buffer,
  organisationId: OrganisationId,
  normalisedAddress: string,
): Buffer {
  return createHmac('sha256', pepper)
    .update(Buffer.from(organisationId, 'utf8'))
    .update(SEPARATOR)
    .update(Buffer.from(normalisedAddress, 'utf8'))
    .digest();
}
