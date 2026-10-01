# Scope bounce history to the organisation

Date: 2026-09-07
Supersedes: ADR 0051 in part
Refs: 0043, 0046, 0051, 0025

ADR 0051 requires, during a sending domain's warm-up, that a contact may only
be planned if there is "no prior bounce recorded for the address anywhere in
the platform's history". ADR 0046 constructs the suppression digest as
`HMAC(pepper, organisation_id || 0x00 || address)` precisely so that the same
address suppressed in two organisations produces two unrelated digests, and
states that suppression lists cannot be correlated across tenants even by
someone holding the key and the database.

The two cannot both hold. A platform-wide bounce check is a cross-tenant
correlation of exactly the kind 0046 was written to prevent: it answers, for
any organisation, whether some other organisation has mailed a given address
and been rejected. Neither ADR acknowledges the other.

Bounce history is scoped to the organisation. ADR 0051's clause is read as
"no prior bounce recorded for the address within this organisation". The rest
of 0051 stands unchanged: the MX requirement, the lower initial send cap, and
the hard-stop treatment of early bounce rate are unaffected.

## Why this direction

A platform-wide bounce ledger is the stronger protection and was the other
serious candidate. It would need a second pepper, not org-keyed, and a table
outside the RLS model - a deliberate cross-tenant channel carved into an
isolation design whose stated property is that no such channel exists. It also
makes one customer's list quality a fact about another customer's sending, and
gives an erasure request an artefact that no single organisation owns.

The protection given up is narrower than it first appears. It applies only
during warm-up, only to addresses this organisation has never mailed, and only
to those which another organisation has already bounced. Every other 0051
control - MX validity, the lower cap, the hard stop on bounce rate - is
unchanged and does not depend on cross-tenant knowledge. A new organisation
importing a bad list is caught by the hard stop within its first campaign,
which is the outcome 0051 was protecting.

## Consequence for the schema

`contact` carries its own bounce state, organisation-scoped like every other
contact attribute, and the warm-up verification bar reads it directly. No
platform-level bounce table exists, and none may be added without an ADR
superseding this one.

Bounce state lives on `contact` rather than in a digest table because, unlike
suppression, it is not subject to the erasure conflict 0046 resolves: an
erasure request deletes the contact row and its bounce state along with it. The
customer is entitled to know that an address on their own list bounced, and
retaining that fact is ordinary processing of their own data. Suppression is
different only because it must outlive the deletion.
