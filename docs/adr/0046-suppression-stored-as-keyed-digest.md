# Store suppression entries as a keyed digest, not an address

Date: 2026-09-03
Closes: W3
Refs: 0039, 0043, W8

ADR 0039 requires that an unsubscribed contact is suppressed permanently.
Erasure rights under GDPR and India's DPDP require that personal data be
deleted on request. Retaining a plaintext address forever in order to honour an
unsubscribe is itself processing, so the two obligations collide directly.

They stop colliding once the retained artefact is not an address. Suppression
never needs to read an address back - it only needs to recognise one. The
suppression entry therefore stores a one-way keyed digest of the address rather
than the address itself. Membership testing, the only operation suppression
performs, is unaffected: normalise the incoming address, compute its digest,
look it up.

## Digest construction

    digest = HMAC-SHA256(key = pepper, message = organisation_id || 0x00 || normalised_address)

A plain SHA-256 digest is not sufficient. The space of email addresses is small
and enumerable, so an unkeyed digest is recoverable by brute force and is
treated by regulators as pseudonymised personal data - which would leave the
erasure conflict exactly where it started. The HMAC key makes the digest
non-reproducible without the key.

The organisation identifier is part of the HMAC message, not merely a column.
Suppression is per organisation under 0039, and including the identifier means
the same address suppressed in two organisations produces two unrelated
digests. Suppression lists cannot be correlated across tenants even by someone
holding the key and the database, which is consistent with the isolation model
in ADR 0043.

## The pepper

The pepper is a single long-lived secret. It can never be rotated, because
rotation would require recomputing digests from addresses the platform has
deliberately not kept. Losing it destroys every suppression record
irrecoverably and silently: the platform would resume sending to people who
unsubscribed, with no error and no way to detect it.

It must therefore be included in backup and restore procedures and verified as
part of restore testing under ADR 0036. This is a direct dependency on W8, and
the threat model that finding asks for must account for the pepper explicitly,
because compromise of the pepper together with the database restores the
ability to enumerate suppressed addresses.

## Normalisation, frozen

The rules below produce the string that is hashed. They are frozen from the
first written row. They can never be changed, because existing digests cannot
be recomputed from data the platform no longer holds, and a later "improvement"
would silently orphan every existing suppression and re-enable sending to
people who unsubscribed.

Applied in order:

1. Trim leading and trailing whitespace.
2. Apply Unicode NFC normalisation.
3. Convert the domain to its A-label form, so internationalised domains are
   stored punycode-encoded.
4. Lowercase the entire address, local part included. RFC 5321 permits a
   case-sensitive local part, but no significant provider treats it that way,
   and this direction errs toward suppressing more rather than less.

Deliberately NOT applied: Gmail dot collapsing and plus-address stripping.
These are provider-specific behaviours and cannot be determined reliably from
the domain, because a Google Workspace custom domain collapses dots while
looking like any other domain. Guessing wrong is permanent in both directions -
too aggressive suppresses people who never unsubscribed, too lax lets a
re-import through. The realistic case these rules would catch is one person
appearing as two spellings across two imports, which is rare enough not to
justify freezing a guess.

If provider-aware matching is ever wanted, it is added as a second digest
column computed under its own rules, never by changing this one. That is the
general escape hatch that makes the freeze survivable: extend by adding a
column, never by redefining an existing one.

## What is stored

The suppression entry holds the organisation-scoped digest, a masked display
form, the suppression timestamp, and the reason and source of suppression. It
does not hold the address.

The masked form retains the first two characters of the local part and the full
domain, for example `jo***@gmail.com`. This exists because a suppression list
its owner cannot see is a support and trust problem: customers need to view
their list, and support needs to answer "why did this person not receive it".
It is a deliberate, accepted weakening of the deidentification - the masked form
plus the domain narrows the candidate space considerably - and it is the reason
suppression records remain organisation-scoped data under 0043 rather than
being treated as anonymous.

Answering "is this specific person suppressed" continues to work exactly as
before, by hashing the candidate address.
