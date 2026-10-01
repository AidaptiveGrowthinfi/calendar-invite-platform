# Schema slice 8: audit and traces

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.

This slice covers ADR 0032's audit obligation as narrowed by ADR 0064: an
append-only, hash-chained record of evidence, and the traces that connect it to
the work the system did.

## The decision this slice rested on

Slice 7 left one question open: whether the audit log is a record of decisions
people made, or a stream of everything the system does. Answered 2026-09-08,
and as with slice 6 the answer rejects the framing — **both, joined by a
trace**. ADR 0064.

Eleven of ADR 0032's thirteen listed events are evidence. Two are work, and
those two carry all the volume: a 50,000-contact campaign is 50,000 send events
under ADR 0045, 150,000 if rescheduled twice, and under ADR 0061 nothing is
deleted. The deciding cost is not storage but tamper-evidence — a small
append-only table can be hash-chained cheaply, and one with tens of millions of
rows per organisation cannot in practice, so logging every send would trade
away the property that makes an audit log an audit log.

The trace is what makes the narrow log sufficient. Work stays in the tables
that already record it; every one of those rows carries the identifier of the
decision that caused it. Investigating becomes "show me what this approval set
in motion" rather than a scan at a timestamp.

ADR 0045 decision 4 had already settled most of this: the send plan is
designated audit evidence for sending, and it is immutable and versioned. An
audit row per send would duplicate a decision taken three slices ago.

## audit_trace

One row per decision. Cheap, because decisions are made by people at human
rates.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    kind                  trace_kind not null

    actor_type            actor_type not null
    actor_user_id         text null                    -- Better Auth user

    campaign_id           uuid null -> campaign
    parent_trace_id       uuid null -> audit_trace
    request_id            text null                    -- ADR 0035

    started_at            timestamptz not null default now()

    index (organisation_id, started_at desc)
    index (organisation_id, campaign_id, started_at desc)
        where campaign_id is not null
    index (organisation_id, parent_trace_id)
        where parent_trace_id is not null
    check ((actor_type = 'user') = (actor_user_id is not null))

    trace_kind:  campaign_approval | campaign_reschedule | campaign_cancel
               | audience_import | connection_change | domain_verification
               | attendance_sync | billing_change | access_change
               | recipient_action

    actor_type:  user | system | recipient | billing_provider

RLS: enabled, forced.

`kind` is stored rather than derived from the trace's first event, because the
common query is "show me every approval this quarter" and deriving it would
mean reading one event to filter a trace.

`campaign_id` is a denormalisation and is admitted as one. Most traces concern
a campaign, and "everything that ever happened to this campaign" is the second
most common investigation after "what did this decision cause". Without it that
question is a join through every subject type. It is nullable because a mailbox
connection or a role change belongs to no campaign.

`parent_trace_id` is one hop, deliberately. It answers "this reschedule came
from that failed send" without anyone writing a recursive query. Arbitrary
depth was considered and rejected: a tree that can be ten deep is a tree nobody
reads, and the causal chains this product actually has are one or two long.

`actor_type` has an explicit `system` value and the check constraint ties
`actor_user_id` to it. A null actor must never mean "the system did it",
because that is indistinguishable from having lost track of who did — which is
the failure an audit log exists to prevent.

`recipient` and `billing_provider` traces have no user and are opened by the
event itself: someone following an unsubscribe link, or a Razorpay webhook
arriving. They are single-event traces. Giving them a trace anyway costs one
row each — hundreds per campaign, not tens of thousands — and buys the property
that "search by trace" is universally true rather than true except in two
cases.

`request_id` is the seam to ADR 0035 and the whole of the relationship between
the two identifiers. A request identifier covers one HTTP call; this trace
outlives it by days and spans thousands of jobs. Recording which request opened
the trace lets an investigator cross from the audit record to the log line, and
nothing more is shared between them.

## audit_event

The evidence. Append-only: no update, no delete, enforced by a trigger.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    trace_id              uuid not null -> audit_trace
    org_seq               bigint not null

    action                audit_action not null
    actor_type            actor_type not null
    actor_user_id         text null

    subject_type          audit_subject not null
    subject_id            uuid null

    detail                jsonb not null default '{}'::jsonb

    occurred_at           timestamptz not null default now()
    prev_hash             bytea
    hash                  bytea not null

    unique (organisation_id, org_seq)
    index  (organisation_id, trace_id, org_seq)
    index  (organisation_id, subject_type, subject_id, occurred_at desc)
    index  (organisation_id, action, occurred_at desc)
    check  ((actor_type = 'user') = (actor_user_id is not null))

    audit_subject: user | mailbox | meeting_host_account | sending_domain
                 | audience | audience_import | campaign | send_plan
                 | suppression | subscription | api_key | organisation

RLS: enabled, forced.

`audit_action` is a closed enum covering ADR 0032's eleven evidence events at
the granularity a reader needs — `role_granted`, `role_revoked`,
`mailbox_connected`, `mailbox_disconnected`, `domain_verified`,
`audience_imported`, `campaign_approved`, `campaign_paused`, `campaign_resumed`,
`plan_approved`, `contact_unsubscribed`, `suppression_added`,
`suppression_removed`, `subscription_changed`, `attendance_synced`,
`api_key_created`, `api_key_revoked`. It is an enum rather than free text for
the reason every other enum in this schema is one: an action nobody can spell
two ways is an action a report can count.

Ordering within a trace is by `org_seq`, not by `occurred_at`. Two events in
the same transaction share a timestamp, and an audit trail whose order depends
on clock resolution is one that reorders itself under load.

### detail is jsonb, and this is the one place that is right

Every other slice avoids jsonb. Audit is the exception, and the reasons are
specific rather than convenient: the payload differs per action, it is written
once and never updated, it is never joined on, and it is read by a person
investigating rather than by a query planner. A role change needs the old and
new role; a subscription change needs the old and new plan version; a mailbox
connection needs the granted scopes. Columns for the union of those would be
mostly null on every row.

**No personal data goes in `detail`.** It holds identifiers. Erasure under ADRs
0046 and 0055 deletes a contact row and leaves the audit event pointing at an
identifier that no longer resolves, which is the correct outcome and costs
nothing. Putting an address in `detail` would mean an erasure request has to
rewrite the audit log, and a log that gets rewritten is not evidence. This is
the same collision 0046 resolved for suppression, resolved the same way, and a
test under ADR 0052 asserts that no `detail` key matches the address-shaped
patterns.

`detail` is serialised canonically — sorted keys, no insignificant whitespace —
before hashing, because a hash over a representation that can vary is a hash
that cannot be verified.

## audit_chain_head

The chain. One row per organisation, holding the tip.

    organisation_id       uuid pk -> organisation
    last_seq              bigint not null default 0
    last_hash             bytea
    updated_at            timestamptz not null

RLS: enabled, forced. Written by `app_worker`.

The same shape as slice 4's `mailbox_capacity_day` and slice 6's
`usage_counter`, and taken for the same reason: a running value that must be
correct at every point a reader could observe it.

Writing an event, in one transaction:

    select * from audit_chain_head
      where organisation_id = $org
      for update;                        -- serialise the chain

    -- seq = last_seq + 1
    -- hash = H(last_hash || org || seq || action || actor || subject
    --          || occurred_at || canonical(detail))
    -- insert audit_event
    -- update audit_chain_head set last_seq = seq, last_hash = hash

    commit;

The `FOR UPDATE` serialises audit writes per organisation. This is a real
serialisation point and it is affordable here for a reason worth stating rather
than assuming: evidence events happen at human rates. A busy organisation
produces a few hundred to a few thousand a year, plus unsubscribes, which are
the largest category and still hundreds per campaign rather than tens of
thousands. If this ever became a bottleneck it would mean work events had crept
into the log, which is the thing ADR 0064 forbids — so the contention is also a
canary.

A Postgres sequence is not used for `org_seq`. Sequences have gaps on rollback,
and in a hash chain a gap is indistinguishable from a deleted row. Gap-free
numbering requires the serialisation above; that is what it buys.

### Verification

The chain is verified by walking an organisation's events in `org_seq` order
and recomputing each hash. A mismatch identifies the first altered or missing
row. This runs as a scheduled job and as a test under ADR 0052, and — like the
reconciliation jobs in slices 4 and 6 — a failure alerts rather than repairing
itself. A chain that silently re-links is a chain that hides the edit it was
built to reveal.

Append-only is enforced by a trigger rejecting `UPDATE` and `DELETE` on
`audit_event`, not by convention. ADR 0043's argument applies with more force
here than anywhere else in the schema: a rule that lives only in code review is
a rule that eventually does not run, and this is the table whose whole value is
that the rule did run.

## Where trace_id is carried

The trace identifier is added to rows that are already written. No table gains
a row because of this slice.

| Table | Slice | Why |
| --- | --- | --- |
| `audience_import` | 2 | The import a person started |
| `campaign_revision` | 3 | A reschedule is a decision |
| `send_plan` | 4 | The approval that authorised the send |
| `attendance_sync_run` | 7 | A sync, automated or uploaded |
| `usage_period` | 6 | The seal, a system trace |

Each is `trace_id uuid null -> audit_trace`, nullable because rows written
before this slice exists have no trace and backfilling a guess would be worse
than a null.

`invitation_attempt` deliberately does **not** carry one. It carries
`send_plan_id`, and a plan has exactly one trace, so the trace is one join
away. Adding the column would put a denormalisation on the largest table in the
schema to save a join on a query a person runs while investigating. An index on
`(organisation_id, send_plan_id)` is added instead, which that table wanted
anyway for "show me this plan's attempts".

Reconstructing a trace is therefore a handful of indexed reads — the trace row,
its events, and the work rows in the five tables above — merged in the
application. All of them lead with `organisation_id` per ADR 0043.

## What this slice does not build

**No audit event per invitation send.** ADR 0064, and ADR 0045 decision 4
before it. The plan says what was to be sent to whom by which mailbox;
`invitation_attempt` says what happened to each operation; ADR 0035's logs hold
per-try detail. Recorded here explicitly so that a future reader comparing this
slice against ADR 0032's wording finds the decision rather than an omission.

**No audit UI.** A hash-chain verification tool and a trace view are product
surface, not schema.

**No cross-organisation audit.** The chain is per organisation and the table is
RLS-forced like any other. Platform administration acting inside a tenant is a
`system` actor in that tenant's chain, which is what makes it visible to the
customer — and that visibility is the point.

**No retention.** ADR 0061. The log is kept, which is what allows the chain to
be verified from its first row.

## The data model is complete

Slices 1 to 8 cover every table the ADRs call for.

The last gap closed on 2026-09-08: `api_key` — a priced dimension under ADR
0040, a stock dimension enforced in slice 6, and an `audit_subject` with two
`audit_action` values in this slice — had been carried since slice 6 with no
table anywhere. It is now defined in slice 1, with tenancy, where it belongs.
The ADR 0052 test that enumerates plan dimensions against enforcement points
now has a table to point at for every dimension.

What follows the schema is specification and tickets, then tests — ADR 0052 is
close to a test plan already.
