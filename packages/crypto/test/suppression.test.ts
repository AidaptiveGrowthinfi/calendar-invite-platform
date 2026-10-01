import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { asOrganisationId } from '@platform/shared';
import { normaliseEmailAddress } from '../src/email';
import {
  digestOfNormalised,
  suppressionDigestMatches,
  suppressionEntryFor,
} from '../src/suppression';

const PEPPER = randomBytes(32);
const ORG_A = asOrganisationId('11111111-1111-4111-8111-111111111111');
const ORG_B = asOrganisationId('22222222-2222-4222-8222-222222222222');

/**
 * Adversarial addresses. `spec/05-invariants-and-tests.md` asks for a property
 * test over unicode, punycode, case and whitespace, and pairs it with the
 * failure it prevents: a re-imported contact silently stopping matching their
 * own suppression entry.
 */
const ADVERSARIAL: readonly string[] = [
  'jo@example.com',
  '  Jo@Example.COM  ',
  `${String.fromCodePoint(0xfeff)}JO@EXAMPLE.COM`,
  `jo@example.com${String.fromCodePoint(0x200b)}`,
  `jos${String.fromCodePoint(0x00e9)}@example.com`,
  `jose${String.fromCodePoint(0x0301)}@example.com`,
  `jo@b${String.fromCodePoint(0x00fc)}cher.de`,
  'jo@XN--BCHER-KVA.DE',
  'jo+webinar@example.com',
  'j.o@example.com',
  '"a@b"@example.com',
  `  ${String.fromCodePoint(0x00fc)}ser@Example.de\t`,
];

describe('the agreement invariant - contact identity and the suppression digest', () => {
  /**
   * THE test for this module. Contact identity (slice 2) is the normalised
   * address; the suppression digest (ADR 0046) is an HMAC over the normalised
   * address. Both must come from the same normaliser call.
   *
   * If this fails, the platform sends to people who unsubscribed, reports no
   * error, and cannot be repaired afterwards - ADR 0046's rules are frozen, so
   * the old digests cannot be recomputed.
   */
  it('both paths agree for every adversarial address', () => {
    for (const raw of ADVERSARIAL) {
      const identity = normaliseEmailAddress(raw); // what slice 2 stores
      const viaEntry = suppressionEntryFor(PEPPER, ORG_A, raw).digest; // what ADR 0046 stores
      const viaIdentity = digestOfNormalised(PEPPER, ORG_A, identity);

      expect(viaEntry.equals(viaIdentity)).toBe(true);
    }
  });

  it('a re-import in a different spelling still matches the suppression entry', () => {
    const unsubscribed = suppressionEntryFor(PEPPER, ORG_A, 'Jo.Smith@Example.COM');
    const reimported = `  jo.smith@example.com${String.fromCodePoint(0x200b)}`;

    expect(suppressionDigestMatches(PEPPER, ORG_A, reimported, unsubscribed.digest)).toBe(true);
  });
});

describe('suppression digest construction - ADR 0046', () => {
  it('is 32 bytes', () => {
    expect(suppressionEntryFor(PEPPER, ORG_A, 'jo@example.com').digest).toHaveLength(32);
  });

  it('does not correlate across organisations', () => {
    const a = suppressionEntryFor(PEPPER, ORG_A, 'jo@example.com').digest;
    const b = suppressionEntryFor(PEPPER, ORG_B, 'jo@example.com').digest;
    expect(a.equals(b)).toBe(false);
  });

  it('is not reproducible without the pepper', () => {
    const a = suppressionEntryFor(PEPPER, ORG_A, 'jo@example.com').digest;
    const b = suppressionEntryFor(randomBytes(32), ORG_A, 'jo@example.com').digest;
    expect(a.equals(b)).toBe(false);
  });

  it('carries the masked form, and never the address', () => {
    const entry = suppressionEntryFor(PEPPER, ORG_A, 'JoSmith@Example.com');
    expect(entry.maskedAddress).toBe('jo***@example.com');
    expect(JSON.stringify(entry)).not.toContain('josmith@example.com');
  });

  it('rejects an unnormalisable address rather than digesting garbage', () => {
    expect(() => suppressionEntryFor(PEPPER, ORG_A, 'not-an-address')).toThrow();
  });
});
