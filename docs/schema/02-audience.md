# Schema slice 2: contacts, audiences, imports, suppression

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged:
uuid keys, `timestamptz` instants, `organisation_id` on every secured table
leading every index, Postgres enums for closed value sets, `bytea` for anything
that must not be logged as a string.

## The decision this slice rested on

Slice 1 left one question open: whether a Contact is deduplicated per
organisation or per audience. It is **per organisation**, with the per-import
values kept separately.

A `contact` is the organisation's canonical record of a person: one row per
normalised address per organisation. Everything the platform learns about that
person over time - that the address bounced, that its domain has no MX, which
provider hosts it - attaches there, because those facts are properties of the
address and do not change because a second spreadsheet was uploaded.

An `audience_member` is one import's view of that person: the display name, the
merge fields, and which row of which file they came from. Those are properties
of the upload, not of the person. Two campaigns may legitimately address the
same person as "Dr Rao" and as "Priya", and a later import must not silently
rewrite an earlier campaign's wording.

The alternative of re-importing contacts per audience was rejected because
ADR 0051's warm-up bar asks whether an address has bounced before, and ADR 0046
suppresses per organisation and permanently. Both are questions about a person
who persists across campaigns. Without a persistent row they have nowhere to be
answered from.

## contact

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    email_normalised        text not null                    -- 0046 rules
    email_display           text not null
    suppression_digest      bytea not null                   -- 0046

    recipient_domain        text not null
    mx_host                 text                             -- 0051
    mx_checked_at           timestamptz
    detected_provider       recipient_provider not null default 'unknown'
    delivery_bucket         text                             -- CONTEXT.md

    verification_state      verification_state not null default 'unverified'
    verification_signals    jsonb not null default '{}'      -- 0025
    verified_at             timestamptz

    bounce_state            bounce_state not null default 'none'   -- 0055
    bounce_count            integer not null default 0
    last_bounce_at          timestamptz
    last_bounce_code        text
    complained_at           timestamptz

    first_seen_at           timestamptz not null default now()
    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, email_normalised)
    index  (organisation_id, suppression_digest)
    index  (organisation_id, delivery_bucket)
    index  (organisation_id, bounce_state) where bounce_state <> 'none'

    recipient_provider:  google | microsoft | other | unknown
    verification_state:  unverified | valid | invalid | risky
                       | disposable | role | undeliverable_domain
    bounce_state:        none | soft | hard

`email_normalised` is produced by ADR 0046's frozen normalisation rules - trim,
NFC, punycode the domain, lowercase the whole address - and it is the
deduplication key. This must be the same function that feeds the suppression
digest, called from one place. If contact identity and suppression identity are
ever computed by two normalisers that drift apart, a re-imported contact stops
matching their own suppression entry and the platform resumes sending to
someone who unsubscribed. That failure is silent, and 0046's freeze means it
cannot be repaired afterwards.

`email_display` keeps the address as the customer typed it, for the UI and for
rejected-row downloads. It is never used for matching.

`suppression_digest` is stored on the contact rather than computed at plan
time. It is a derived column of data the row already holds, so it discloses
nothing new, and it turns the suppression check into an indexed join against
`suppression_entry` instead of an HMAC over every contact on every planning
run. It also displaces the alternative that should be rejected outright: a
cached `is_suppressed` boolean on the contact. A boolean can drift out of date,
and the failure direction of a stale one is mailing an unsubscribed person.

`delivery_bucket` is the pacing group from CONTEXT.md, derived from the MX host
as well as the domain so that separately named Google- or Microsoft-hosted
domains are not treated as independent capacity pools. It is stored rather than
derived at send time because the planner groups by it, and because the MX
lookup that produces it already happens once at import.

`bounce_state` is organisation-scoped per ADR 0055. There is no platform-level
bounce table and none may be added without an ADR superseding 0055. The warm-up
bar in ADR 0051 reads this column together with `mx_host`.

`verification_signals` holds ADR 0025's non-SMTP intelligence output: risk
score, disposable-domain and role-address flags, typo suggestion, provider
detection evidence. It is `jsonb` because the signal set is a vendor detail that
will change, and freezing it into columns would mean a migration each time the
provider adds a check. Anything the planner filters on is promoted to a real
column - `verification_state`, `mx_host`, `bounce_state` - so no query on the
send path reaches into the json.

**Response history is deliberately absent.** A contact's accept, decline, or
tentative is a response to one campaign revision (ADR 0045), not a property of
the person, and the authoritative record is the Invitation Attempt in slice 4.
A denormalised `last_response` on the contact would be a cache with no correct
value for a person invited to three campaigns, and it would go stale exactly
when a reschedule makes it matter.

**Erasure.** An erasure request deletes the contact row and its
`audience_member` rows. The suppression entry survives, holding only the digest
and the masked form, which is the whole point of ADR 0046. Bounce state dies
with the contact, and that is acceptable: it is the customer's own record of
their own list, not a platform asset.

## audience

A set of contacts imported for a campaign (CONTEXT.md). An audience is a
durable named set, not a file; it may be built by more than one import.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    name                    text not null
    status                  audience_status not null default 'draft'
    member_count            integer not null default 0
    created_by_user_id      text not null                  -- Better Auth user
    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, name)
    index  (organisation_id, status)

    audience_status: draft | importing | ready | failed

RLS: enabled, forced.

`member_count` is a maintained counter, not a source of truth. It exists so the
audience list screen does not count 50,000 rows per card. It is recomputed at
the end of every import rather than incremented per row, so a crashed import
cannot leave it permanently wrong.

## audience_import

One upload. Holds ADR 0024's column mapping and summary, and the evidence
needed to explain a rejection to the customer afterwards.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    audience_id             uuid not null -> audience
    filename                text not null
    file_format             import_format not null
    byte_size               bigint not null
    checksum_sha256         bytea not null
    column_mapping          jsonb not null
    status                  import_status not null default 'pending'
    failure_reason          text

    rows_total              integer not null default 0
    rows_imported           integer not null default 0
    rows_duplicate          integer not null default 0
    rows_rejected           integer not null default 0
    rows_held               integer not null default 0

    started_at              timestamptz
    finished_at             timestamptz
    created_by_user_id      text not null
    created_at              timestamptz not null default now()

    index (organisation_id, audience_id, created_at desc)

    import_format: csv | xlsx
    import_status: pending | mapping | validating | importing
                 | completed | completed_with_rejections | failed

RLS: enabled, forced.

The five counters are the import summary ADR 0024 requires, and they have to
add up: `rows_total = rows_imported + rows_duplicate + rows_rejected`. A check
constraint enforces that identity, because a summary that does not reconcile
becomes a support burden months later, when the file is gone and nobody can
say which number was wrong. `rows_held` is a subset of `rows_imported` -
contacts that landed but need borderline review before they may be planned -
and is not part of the sum.

`checksum_sha256` catches the same file being uploaded twice, which is reported
to the customer rather than blocked. Blocking is the wrong response:
re-uploading a corrected file under the same name is normal, and a genuine
re-upload of an identical file is idempotent anyway once deduplication runs.

The uploaded file itself is not stored in the database. It is held in object
storage under a lifecycle rule and referenced by checksum, with the same
retention window as the rejections below.

## audience_import_rejection

Rejected rows, retained so ADR 0024's rejected-row download works.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    audience_import_id      uuid not null -> audience_import
    source_row_number       integer not null
    reason                  rejection_reason not null
    reason_detail           text
    raw_row                 jsonb not null
    created_at              timestamptz not null default now()

    index (organisation_id, audience_import_id, source_row_number)

    rejection_reason: missing_email | malformed_email | duplicate_in_file
                    | duplicate_in_audience | disposable_domain
                    | undeliverable_domain | role_address
                    | suppressed | previously_bounced | row_unparseable

RLS: enabled, forced.

`raw_row` is the customer's original row, personal data included, kept so the
download can show them what was wrong with the line they actually wrote. It is
the one place in this slice holding personal data the platform has no sending
use for, so it carries a retention window: deleted with its import after a
fixed period, by a scheduled job rather than by intent.

`suppressed` and `previously_bounced` are rejection reasons rather than silent
drops. A customer who cannot see that 400 of their 10,000 rows were suppressed
will conclude the import is broken. They see the count and the masked
addresses; ADR 0046's masked display form is what makes that showable at all.

## audience_member

One import's view of one contact. This is the table carrying the values that
differ between uploads.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    audience_id             uuid not null -> audience
    contact_id              uuid not null -> contact
    audience_import_id      uuid not null -> audience_import

    display_name            text
    merge_fields            jsonb not null default '{}'
    source_row_number       integer not null

    review_state            review_state not null default 'not_required'
    reviewed_at             timestamptz
    reviewed_by_user_id     text

    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, audience_id, contact_id)
    index  (organisation_id, audience_id, review_state)
    index  (organisation_id, contact_id)

    review_state: not_required | pending | approved | rejected

RLS: enabled, forced.

The unique constraint is the deduplication guarantee: a person appears at most
once in an audience, however many times they appear in the file or across
successive imports into it. A second import that re-supplies an existing member
updates the snapshot in place and counts the row as `rows_duplicate`, moving
`audience_import_id` to the import that most recently supplied the values, so
"where did this spelling come from" stays answerable.

`review_state` is ADR 0024's borderline review, and it is a decision rather
than a derivation, which is why it is stored. A contact whose
`verification_state` is `risky` enters the audience as `pending`; the planner
excludes `pending` and `rejected`. `not_required` is the default so the common
case writes no review workload and the "needs attention" query stays a small
index scan.

`merge_fields` is `jsonb` because ADR 0024 promises flexible column mapping:
the customer decides what their columns mean, so the shape is per-import by
definition. Templates draw from it (ADR 0022), and a missing key renders empty
rather than failing the send.

## suppression_entry

ADR 0046, implemented as written. It holds no address.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    digest                  bytea not null                 -- HMAC-SHA256
    masked_address          text not null                  -- jo***@gmail.com
    reason                  suppression_reason not null
    source                  suppression_source not null
    source_campaign_id      uuid null
    suppressed_at           timestamptz not null default now()

    unique (organisation_id, digest)

    suppression_reason: unsubscribed | hard_bounce | complaint
                      | manual | invalid_address
    suppression_source: rsvp_page | unsubscribe_link | provider_webhook
                      | import | manual | api

RLS: enabled, forced.

This table has no foreign key to `contact` and must never gain one. It has to
outlive the contact row - that is the entire reason it stores a digest instead
of an address - and a foreign key would either block the erasure it exists to
permit, or cascade away the suppression it exists to preserve.

`source_campaign_id` is nullable and deliberately not a cascading foreign key.
It records where an unsubscribe came from, for support, and is allowed to point
at a campaign that has since been removed.

The unique constraint on `(organisation_id, digest)` makes re-suppression
idempotent, which matters because provider webhooks retry.

## What the planner asks of this slice

The send planner in slice 4 needs one question answered: which members of this
audience may be sent to. Against these tables that is

    audience_member
      join contact on contact.id = audience_member.contact_id
      left join suppression_entry
             on suppression_entry.digest = contact.suppression_digest
    where audience_member.audience_id = $1
      and audience_member.review_state in ('not_required', 'approved')
      and suppression_entry.id is null
      and contact.bounce_state <> 'hard'
      and contact.verification_state not in
            ('invalid', 'disposable', 'undeliverable_domain')

with two further predicates while the sending domain is in warm-up, per ADRs
0051 and 0055: `contact.mx_host is not null` and `contact.bounce_state =
'none'`. Every column in that query is indexed under `organisation_id`, and RLS
supplies the tenant predicate rather than the query author remembering to.

The suppression check is a left join and an `is null` test rather than a
boolean column, and that is the point of storing the digest on the contact. A
dropped join is visible in review; a dropped `and not suppressed` predicate
looks like nothing at all.

## Resolved: the slice 3 question

Whether a campaign references an audience or copies its membership at approval.
Answered 2026-09-07: **copied and frozen at approval**, so one webinar cannot be
enlarged by an import intended for the next one. ADR 0057. The audience
reference is retained on the campaign for provenance only. See `03-campaign.md`.
