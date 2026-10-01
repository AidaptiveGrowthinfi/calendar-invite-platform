/**
 * Email normalisation. ADR 0046, frozen rules.
 *
 * ---------------------------------------------------------------------------
 *  THIS FILE CONTAINS THE ONLY EMAIL NORMALISER IN THE SYSTEM.
 *
 *  Contact identity (slice 2) and the suppression digest (ADR 0046) are both
 *  computed from `normaliseEmailAddress`. If a second normaliser appears and
 *  the two drift, a re-imported contact silently stops matching their own
 *  suppression entry and the platform resumes sending to someone who
 *  unsubscribed. There is no error and no way to detect it from the data.
 *
 *  It is unrepairable afterwards: ADR 0046's rules are frozen from the first
 *  written row, because digests cannot be recomputed from addresses the
 *  platform has deliberately not kept.
 *
 *  `test/email.test.ts` asserts the agreement property, and
 *  `scripts/gate-one-normaliser.mjs` fails CI if a second normaliser appears.
 * ---------------------------------------------------------------------------
 *
 * The rules, applied in this order and no other:
 *
 *   1. Trim leading and trailing whitespace.
 *   2. Apply Unicode NFC normalisation.
 *   3. Convert the domain to its A-label form (punycode).
 *   4. Lowercase the entire address, local part included.
 *
 * Deliberately NOT applied, per ADR 0046: Gmail dot collapsing and
 * plus-address stripping. They are provider-specific behaviours that cannot be
 * determined from the domain, because a Google Workspace custom domain
 * collapses dots while looking like any other domain. Guessing wrong is
 * permanent in both directions.
 *
 * If provider-aware matching is ever wanted it is added as a SECOND digest
 * column under its own rules. Never by changing this function.
 */
import { domainToASCII } from 'node:url';

export class InvalidEmailAddressError extends Error {
  constructor(reason: string) {
    super(`invalid email address: ${reason}`);
    this.name = 'InvalidEmailAddressError';
  }
}

/**
 * Zero-width and word-joiner characters. Not whitespace to `String.trim`, and
 * invisible in a spreadsheet cell, which is where these addresses come from
 * (ADR 0024, CSV and XLSX import). Stripped only at the ends, never inside:
 * a zero-width character in the middle of an address makes it a different
 * address, and silently repairing it is a guess.
 */
const INVISIBLE_CODEPOINTS = [
  0x200b, // zero width space
  0x200c, // zero width non-joiner
  0x200d, // zero width joiner
  0x2060, // word joiner
  0xfeff, // zero width no-break space / BOM
] as const;

const INVISIBLES = INVISIBLE_CODEPOINTS.map((c) => String.fromCodePoint(c)).join('');

const EDGE_INVISIBLES = new RegExp(`^[${INVISIBLES}]+|[${INVISIBLES}]+$`, 'gu');

/**
 * The single normaliser. Returns the exact string that is hashed for the
 * suppression digest and stored as contact identity.
 *
 * Throws rather than returning a fallback. A silently-mangled address becomes
 * a suppression entry that can never be matched again.
 */
export function normaliseEmailAddress(input: string): string {
  if (typeof input !== 'string') {
    throw new InvalidEmailAddressError('not a string');
  }

  // 1. Trim.
  const trimmed = input.trim().replace(EDGE_INVISIBLES, '');
  if (trimmed.length === 0) {
    throw new InvalidEmailAddressError('empty');
  }

  // 2. NFC.
  const composed = trimmed.normalize('NFC');

  if (/\s/u.test(composed)) {
    throw new InvalidEmailAddressError('contains whitespace');
  }

  // Split on the LAST '@'. RFC 5321 permits '@' inside a quoted local part;
  // the domain never contains one.
  const at = composed.lastIndexOf('@');
  if (at <= 0 || at === composed.length - 1) {
    throw new InvalidEmailAddressError('missing local part or domain');
  }
  const localPart = composed.slice(0, at);
  const domainPart = composed.slice(at + 1);

  if (!domainPart.includes('.')) {
    throw new InvalidEmailAddressError('domain has no dot');
  }

  // 3. Domain to A-label. `domainToASCII` returns '' when the domain cannot be
  //    encoded, which is a rejection, not a pass-through.
  const asciiDomain = domainToASCII(domainPart);
  if (asciiDomain.length === 0) {
    throw new InvalidEmailAddressError('domain is not encodable as an A-label');
  }

  // 4. Lowercase the whole address, local part included. RFC 5321 permits a
  //    case-sensitive local part; no significant provider treats it that way,
  //    and this direction errs toward suppressing more rather than less.
  return `${localPart}@${asciiDomain}`.toLowerCase();
}

/**
 * The masked display form ADR 0046 stores beside a suppression digest: the
 * first two characters of the local part, then the full domain.
 *
 * A deliberate, accepted weakening of the deidentification. It exists because
 * a suppression list its owner cannot see is a support and trust problem, and
 * it is the reason suppression records stay organisation-scoped under ADR 0043
 * rather than being treated as anonymous.
 *
 * Takes an already-normalised address, so that what is displayed and what was
 * hashed cannot disagree.
 */
export function maskNormalisedAddress(normalised: string): string {
  const at = normalised.lastIndexOf('@');
  if (at <= 0) {
    throw new InvalidEmailAddressError('not a normalised address');
  }
  const local = normalised.slice(0, at);
  const domain = normalised.slice(at);
  return `${local.slice(0, 2)}***${domain}`;
}
