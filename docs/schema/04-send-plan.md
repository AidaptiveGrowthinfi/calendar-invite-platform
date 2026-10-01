# Schema slice 4: send plans, capacity, invitation attempts

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.

This is the safety-critical slice. ADR 0014 identifies the send path as the
component whose failure duplicates invitations in a recipient's calendar, and
ADR 0052 turns that into a list of tests that are the definition of done. Every
table here is shaped by one of those two.

## The decision this slice rested on

Slice 3 left one question open: whether ADR 0058's capacity commitments are a
running balance per mailbox per day, or summed from the plan rows that claim
them. It is a **balance**, written in the same transaction as the plan rows.

That transaction is the whole of the answer. A balance maintained separately
from the plan is a denormalisation that drifts; a balance written in the same
transaction as the rows it counts cannot disagree with them at any point a
reader could observe, which is what ADR 0058 requires of the planner and the
dispatcher. The cost is that the invariant is now an invariant rather than a
definition, so it is stated and checked rather than assumed - see the
reconciliation section below.

## send_plan

ADR 0045 decision 4: plans are immutable and versioned. A reschedule produces a
new version with its own capacity computation and its own approval, rather than
mutating an approved plan.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    version                 integer not null
    revision_seq            integer not null        -- campaign_revision.seq
    status                  plan_status not null default 'draft'

    window_start_date       date not null
    window_end_date         date not null
    operation_count         integer not null default 0
    member_count            integer not null default 0

    admission_shortfall     jsonb                   -- 0058, when refused
    computed_at             timestamptz not null default now()
    approved_at             timestamptz
    approved_by_user_id     text
    superseded_by_plan_id   uuid null -> send_plan
    created_at              timestamptz not null default now()

    unique (organisation_id, campaign_id, version)
    index  (organisation_id, campaign_id, status)

    plan_status: draft | pending_approval | approved | refused
               | superseded | cancelled | completed

RLS: enabled, forced.

`revision_seq` records which campaign revision this plan delivers. It is an
integer rather than a foreign key for the same reason
`campaign.current_revision_seq` is, and it is what makes a plan self-describing
in the audit record ADR 0032 requires: the plan says which version of the event
it was going to send.

`admission_shortfall` holds the evidence for a refusal under ADR 0058 - how
many operations did not fit, and on which days. It exists because "your
campaign was refused" is not an actionable message. The organiser needs to see
that Thursday is short by 1,400 before choosing between connecting a mailbox,
cutting the audience, and moving the event.

`refused` is a terminal status and the plan is kept, not deleted. A refused
plan is the record of an admission decision, and the next attempt is a new
version. Deleting it would destroy the only evidence of why the campaign did
not start.

There is no `updated_at`. A plan is never edited; `status` transitions and the
approval timestamps are the only writes after creation, and each is a state
transition rather than a revision of content.

## send_plan_item

One planned operation: this contact, from this mailbox, on this day. These are
the rows that claim capacity.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    send_plan_id            uuid not null -> send_plan
    campaign_id             uuid not null -> campaign
    campaign_member_id      uuid not null -> campaign_member
    contact_id              uuid not null -> contact

    mailbox_id              uuid null -> mailbox     -- native mode
    scheduled_date          date not null
    operation               invitation_operation not null
    revision_seq            integer not null

    created_at              timestamptz not null default now()

    unique (organisation_id, send_plan_id, campaign_member_id, operation)
    index  (organisation_id, mailbox_id, scheduled_date)
    index  (organisation_id, send_plan_id, scheduled_date)

    invitation_operation: create | update | cancel

RLS: enabled, forced.

**Plan items carry no execution state.** There is no `sent` flag, no
`attempted_at`, no status. This is deliberate and it is the point of ADR 0045
decision 4: the plan is audit evidence of what was going to happen, and writing
outcomes onto it destroys that record by overwriting the intention with the
result. Execution state lives on `invitation_attempt`, which is a separate row
per operation and can hold a failure without erasing the plan that produced it.

`mailbox_id` is nullable because calendar email mode sends through a sending
domain and a provider rather than a connected mailbox. Which of the two applies
is determined by `campaign.send_mode`; a check constraint requires
`mailbox_id` to be present exactly when the campaign is in native mode.

## mailbox_capacity_day

The balance. One row per mailbox per day, holding what is committed and what
has been consumed.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    mailbox_id              uuid not null -> mailbox
    day                     date not null

    committed               integer not null default 0
    consumed                integer not null default 0
    capacity_at_commit      integer not null

    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, mailbox_id, day)
    check  (committed >= 0)
    check  (consumed >= 0 and consumed <= committed)

RLS: enabled, forced. Written by `app_worker` on the dispatcher path.

`day` is a date in the organisation's timezone, and it is the platform's own
accounting unit rather than the provider's. Google's documented limits are over
an undefined "short period" and are not calendar-day windows (ADR 0047), so
this bucket is how the platform budgets, while the adaptive throttle in ADR
0019 handles the rolling reality with smoothing and back-off. Treating the day
bucket as if it were the provider's limit would be exactly the mistake 0047
warns against.

`capacity_at_commit` records the effective ceiling - the lower of
`daily_capacity_target` and `observed_capacity_ceiling` - at the moment
capacity was committed. It is evidence, not the check. Admission always
evaluates against the mailbox's *current* effective ceiling, because a ceiling
discovered since approval is the more truthful number, and 0047 requires a
discovered limit be reused rather than rediscovered by breaching it again.

### How capacity is claimed and released

Claiming, on approval, in one transaction:

    select * from mailbox_capacity_day
      where organisation_id = $org and mailbox_id = any($mailboxes)
        and day between $start and $end
      for update;                         -- serialise concurrent admissions

    -- admission test against current effective ceiling per mailbox-day
    -- insert send_plan_item rows
    -- increment committed by the number of items on each mailbox-day
    -- set send_plan.status = 'approved'

    commit;

The `FOR UPDATE` is what makes two campaigns approved at the same moment
mutually exclusive on the mailbox-days they share, which is ADR 0058's
requirement and ADR 0052's "reservation under concurrency" test. Without it,
two admissions each read 200 remaining and each commit 200.

Consuming, on a settled send: `consumed` is incremented in the same transaction
that writes the attempt's terminal state. Releasing, on cancel or completion:
`committed` is decremented by the operations that will now never be sent, which
is what returns capacity to the next campaign under 0058.

A mailbox whose ceiling drops below what is already committed does not
retroactively invalidate the commitment. The affected plans are re-evaluated
and the organiser is told, per 0058 and 0019. The row records the overcommit
rather than hiding it, because a silent shortfall discovered at send time is
the failure both ADRs exist to prevent.

### Reconciliation, which is the price of the balance

The balance is a denormalisation. Its invariant is:

    committed = count of send_plan_item rows for that mailbox and day
                belonging to plans in status 'approved'
              - operations released by cancellation

That is true by construction inside every transaction that writes both. It is
checked anyway, by a scheduled job and by a test under ADR 0052, because
"true by construction" is a claim about code that will be edited by people who
have not read this document. A divergence is an alert, not a silent
self-correction: a balance that quietly repairs itself hides the bug that
caused it.

## invitation_attempt

ADR 0045 decision 3 and ADR 0014. One row per operation, not one row per
contact, and retried in place rather than re-inserted.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    campaign_member_id      uuid not null -> campaign_member
    contact_id              uuid not null -> contact

    operation               invitation_operation not null
    revision_seq            integer not null

    send_plan_id            uuid not null -> send_plan
    send_plan_item_id       uuid not null -> send_plan_item
    mailbox_id              uuid null -> mailbox

    state                   attempt_state not null default 'reserved'
    try_count               integer not null default 0
    next_retry_at           timestamptz

    provider_event_id       text                    -- native, on success
    provider_message_id     text                    -- calendar email mode
    error_class             provider_error_class
    error_code              text
    error_detail            text

    reserved_at             timestamptz not null default now()
    dispatched_at           timestamptz
    settled_at              timestamptz
    reconciled_at           timestamptz

    unique (organisation_id, campaign_id, campaign_member_id,
            operation, revision_seq)
    index  (organisation_id, state, next_retry_at)
        where state in ('reserved', 'unknown')
    index  (organisation_id, campaign_id, campaign_member_id,
            revision_seq desc)
        where state = 'succeeded'

    attempt_state:        reserved | dispatched | succeeded | failed
                        | unknown | abandoned
    provider_error_class: rate_limited | backend_error | transient_network
                        | auth_failure | permanent_rejection

RLS: enabled, forced.

**The unique constraint is the idempotency key.** ADR 0014 requires a stable
key based on campaign, contact, and operation identity rather than timestamps,
and ADR 0045 decision 3 names the same four fields. Putting it in the database
as a constraint rather than in the worker as a check is the difference between
a guarantee and an intention: a duplicate submission fails to insert, whatever
the worker believed.

**Retries increment `try_count` on this row.** They never insert a second row.
ADR 0014 says workers retry only through the same stable identity, and a retry
that inserts is a retry that can create a second calendar event.

`state` distinguishes `failed` from `unknown`, and that distinction is the most
important one in this slice. ADR 0014: a timeout is an `unknown` outcome, not
permission to create a new invitation. A create that ended `unknown` may have
succeeded at the provider, so `campaign_member.provider_event_id` stays null,
dependent operations for that contact block, and reconciliation - not a retry -
resolves it. ADR 0052 requires this branch be tested directly, because it is
the branch that produces duplicate events when it is wrong.

`abandoned` is terminal after retries are exhausted or the campaign is
cancelled. It is distinct from `failed` so that "we stopped trying" is not
recorded as "the provider rejected it", which is the difference between a
platform problem and a recipient problem when someone asks later.

`error_class` reproduces the taxonomy learned in v1 production - rate limiting,
backend errors, transient network failures, authorisation failures - which
ADR 0052 requires as fixtures precisely so it is not relearned. The class
drives retry policy; `error_code` and `error_detail` are the provider's own
words, kept for support.

### The attempt row is the outbox

ADR 0014 requires a reservation and a transactional outbox before work is
enqueued. A separate outbox table is not needed, because a row in state
`reserved` is exactly that: written in the transaction that claims the work,
before any provider call, and enqueued to BullMQ only after that transaction
commits.

If the enqueue is lost - Redis restarted, the process died between commit and
enqueue - the row is still `reserved`, and a sweeper re-enqueues it from the
partial index above. This is what makes ADR 0013 true in the direction that
matters: Redis may be flushed without losing the platform's truth about what
was to be sent.

The reservation itself takes the shape recovered from v1 in W18b, which is the
technique that extraction existed to recover:

    update invitation_attempt
       set state = 'dispatched', dispatched_at = now(),
           try_count = try_count + 1
     where id in (
       select id from invitation_attempt
        where organisation_id = $org
          and state = 'reserved'
          and (next_retry_at is null or next_retry_at <= now())
        order by reserved_at
        limit $batch
        for update skip locked
     )
    returning *;

`FOR UPDATE SKIP LOCKED` in a subquery, with the state transition and
`RETURNING` in a single statement, is what makes two workers reserve disjoint
sets. ADR 0052 requires this be tested against a real PostgreSQL instance
rather than a mock, because the guarantee belongs to the database and a mock
would assert only that the code called it.

### Deriving the operation

ADR 0045 decision 2 derives the operation by comparing the highest revision a
contact has successfully received against `campaign.current_revision_seq`. That
aggregate is served by the partial index above:

    select max(revision_seq)
      from invitation_attempt
     where organisation_id = $org and campaign_id = $c
       and campaign_member_id = $m and state = 'succeeded'

Null means never successfully sent, so the contact needs a `create`. Less than
current means `update`. Equal means no operation. A contact whose latest create
is `unknown` produces neither, and blocks pending reconciliation.

Slice 3 declined to cache this on `campaign_member`, and that stands. If
measurement shows the aggregate too slow across 50,000 contacts, the fix is a
column written inside this same transaction, never a refreshed cache.

## invitation_response

ADR 0041 for native mode, ADR 0011 for calendar email mode. One row per
campaign member.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    campaign_member_id      uuid not null -> campaign_member

    response                response_state not null default 'no_response'
    source                  response_source not null
    responded_to_revision   integer
    first_responded_at      timestamptz
    last_response_at        timestamptz
    last_synced_at          timestamptz not null default now()

    unique (organisation_id, campaign_member_id)
    index  (organisation_id, campaign_id, response)

    response_state:  no_response | accepted | declined | tentative
    response_source: provider_attendee | hosted_rsvp

RLS: enabled, forced.

The vocabulary is ADR 0041's mapping, applied on ingestion: `needsAction` to
`no_response`, `accepted` to `accepted`, `declined` to `declined`, and both
`tentative` and `tentativelyAccepted` to `tentative`. The mapping happens at
the boundary so no provider's spelling reaches the schema.

This is a separate table rather than columns on `campaign_member`, for a
concrete reason: response ingestion is a different worker running on a
different schedule from the dispatcher, and both would otherwise write the same
rows. Separating them keeps the response sync from contending for row locks
with the send path, which is the path that must not be delayed.

It holds current state rather than an append-only log because that is what the
provider reports. ADR 0041's ingestion is incremental via a stored sync token
per mailbox and returns the attendee's *current* status, not a history of
changes. Upserting on `(organisation_id, campaign_member_id)` is therefore
idempotent by construction, which 0041 requires, and out-of-order arrivals are
resolved by not overwriting a newer `last_response_at` with an older one. The
history of changes is in the audit log under ADR 0032, where it belongs.

`last_synced_at` exists because 0041 requires response data be shown as
provider-reported with a last-synced timestamp, and because it is the only
thing that distinguishes "nobody has responded" from "we have not been able to
ask since the mailbox needed reauthorisation".

`responded_to_revision` records which version of the event the person was
answering. After a reschedule, an acceptance of revision 1 is not an acceptance
of revision 2, and reporting it as one would tell the organiser that people
have confirmed a time they were never offered.

## Resolved: the slice 5 question

Whether Campaign Health is a current state with a history table or an
append-only series. Answered 2026-09-07: **an append-only series**, latest row
current. ADR 0016's recovery hysteresis is a function of prior states, so the
history is an input to the decision rather than an archive of it. The cost is
smaller than stated when the question was raised - with a covering index the
current state is one index descent, not a scan. See `05-deliverability.md`.
