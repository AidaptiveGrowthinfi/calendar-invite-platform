# Schema slice 7: attendance and analytics

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.

This slice covers the connected meeting host account (ADR 0027), the sync that
fetches attendance and its manual fallback (0026), the raw attendee rows and
how they are matched back to invited contacts, and the segments the organiser
actually reads (0063). ADR 0028 bounds it: the platform reads a meeting it did
not create.

## The decision this slice rested on

Slice 6 left open whether retention deletes the rows it expires or aggregates
before deleting. The question turned out to be void rather than answered:
**nothing is ever deleted**, on any plan, internal or paid. ADR 0061.

That decides this slice's largest structural question before it is asked.
Analytics is **derived on read**. There is no sealed roll-up, no materialised
segment table, and no nightly aggregation job, because the rows the segments
are computed from are always present and ADR 0059 rules out a cache. A stored
segment would be a denormalisation with no reader that a later re-sync could
silently invalidate — the one shape this project has repeatedly refused.

The cost is a three-table join on the results screen, and ADR 0042 already
flagged that Drizzle's lack of a relational `include` will be felt on exactly
these read paths. It is a known cost on a screen loaded once per campaign per
viewer, not on the send path.

## What this slice corrects

Slice 3 gave `campaign` an `attendance_host_mailbox_id` referencing `mailbox`.
That column cannot hold a Zoom account — `mailbox_provider` is
`google | microsoft` by construction, because a Mailbox is defined in
`CONTEXT.md` as a connected Google Workspace or Microsoft 365 account used to
send invitations — so one of ADR 0026's three providers was unreachable.

The column is now `attendance_host_account_id`, referencing
`meeting_host_account` below. W26, closed by ADR 0062. Slice 3 has been updated
rather than left to disagree with this one.

## meeting_host_account

ADR 0027. The account that owns or can read the meeting's attendance.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    provider              meeting_provider not null
    provider_account_id   text not null
    email                 text not null
    display_name          text

    status                host_account_status not null default 'active'

    scopes                text[] not null
    access_token_enc      bytea                          -- 0033, 0049
    refresh_token_enc     bytea
    token_expires_at      timestamptz

    connected_at          timestamptz not null default now()
    created_at            timestamptz not null default now()
    updated_at            timestamptz not null

    unique (organisation_id, provider, provider_account_id)
    index  (organisation_id, status)
    check  (provider <> 'custom')

    host_account_status: active | needs_reauth | revoked | disconnected

RLS: enabled, forced.

The `meeting_provider` enum from slice 3 is reused rather than a narrower one
being introduced, with a check excluding `custom`. This is the same choice
slice 6 made for flow dimensions, for the same reason: two overlapping enums
are two lists to keep in agreement, and `CONTEXT.md` exists to stop one concept
acquiring two spellings. A `custom` meeting link has no host account by
definition — that is what makes it custom.

This is not a `mailbox` and does not reuse that table. ADR 0062 gives the full
argument; the short form is that every capacity and throttle column on
`mailbox` is meaningless for an account that sends nothing, the two statuses
fail at different times for different reasons, and Google Meet attendance
requires a Workspace admin-level grant that must not end up attached to every
account connected merely to send from.

The accepted consequence is that an organisation using Google for both connects
the same Google account twice, under two consent flows. Recorded here so it is
not later "fixed" by merging the tables.

`status` distinguishes `revoked` from `disconnected`: the first is the provider
or an administrator withdrawing access, the second is the customer doing it
deliberately. They need different messages, and a single `inactive` would make
the product guess which had happened.

## attendance_sync_run

One row per attempt to obtain attendance for a campaign, automated or manual.
ADRs 0026, 0027, 0035.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    campaign_id           uuid not null -> campaign

    source                attendance_source not null
    host_account_id       uuid null -> meeting_host_account
    uploaded_by_user_id   text null

    status                sync_run_status not null default 'pending'
    started_at            timestamptz not null default now()
    finished_at           timestamptz

    attendee_row_count    integer not null default 0
    matched_count         integer not null default 0
    unmatched_count       integer not null default 0
    rejected_row_count    integer not null default 0

    error_code            text
    error_detail          text
    metered               boolean not null default false

    index (organisation_id, campaign_id, started_at desc)
    check (source = 'manual_import' or host_account_id is not null)
    check (source = 'automated'     or uploaded_by_user_id is not null)

    attendance_source: automated | manual_import
    sync_run_status:   pending | running | succeeded | partial | failed

RLS: enabled, forced. Written by `app_worker` on the sync path.

Retries insert a new row rather than mutating the last one. The history is what
ADR 0035 asks for when it requires admin visibility into attendance sync
issues, and it is the difference between "this campaign has no attendance" and
"we have tried four times and Zoom returns 403".

`partial` is a real terminal state, not a variant of failure. A provider that
returns a truncated participant list, or a manual file where some rows parse
and some do not, has produced usable data that must not be presented as
complete. The results screen says so.

The two check constraints keep the two sources honest: an automated run without
a host account is the state ADR 0027 says cannot happen, and a manual import
with no uploader is an audit gap under ADR 0032.

### What one metered attendance sync is

`attendance_sync` is a flow dimension in slice 6, so this slice has to say what
the unit is, and the obvious readings are both wrong.

Metering per run charges the customer for the platform's own retries and for a
provider's 500s. Metering per attendee makes a large webinar arbitrarily
expensive to measure, which is the opposite of what a limit called "attendance
syncs" suggests.

**One unit per campaign**, charged on the first run for that campaign that
reaches `succeeded` or `partial`. The `metered` boolean records which run
carried the charge, so the seal in slice 6 is reconstructable and a second
charge is impossible. Re-syncs are free, failures are free, and manual imports
are metered identically to automated ones, because the entitlement a customer
bought is attendance measurement, not the mechanism.

This is the reading a customer takes from a pricing page that says "500
attendance syncs per month", and where a metering rule and a pricing page
disagree, the pricing page is the specification.

## meeting_attendee

The raw participant rows, as the provider or the uploaded file gave them,
before and after matching.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    sync_run_id             uuid not null -> attendance_sync_run

    provider_participant_id text                      -- null for manual import
    raw_email               text
    raw_display_name        text

    joined_at               timestamptz
    left_at                 timestamptz
    duration_seconds        integer

    match_state             match_state not null default 'unmatched'
    match_method            match_method not null default 'none'
    campaign_member_id      uuid null -> campaign_member

    created_at              timestamptz not null default now()

    index (organisation_id, campaign_id, match_state)
    index (organisation_id, campaign_member_id)
    check (raw_email is not null or raw_display_name is not null)
    check ((match_state = 'matched') = (campaign_member_id is not null))

    match_state:  matched | unmatched | ambiguous
    match_method: email_exact | name_exact | manual | none

RLS: enabled, forced.

These rows are kept rather than being folded into the member fact below,
because the organiser has two questions that only the raw rows answer: which
attendees the platform could not match, and who attended who was never invited.
Both are ordinary — people forward webinar links — and a design that discards
unmatched rows answers "how many attended" with a number smaller than the
provider's own.

`match_state = 'ambiguous'` exists because name matching is not a decision the
platform should take silently. An exact email match is confident. A display
name matching two members, or matching one member weakly, is surfaced for the
organiser to resolve, and resolving it sets `match_method = 'manual'`. The
alternative — guessing and being right most of the time — puts a wrong person
in an attendance record that feeds follow-up.

The check constraint tying `match_state` to `campaign_member_id` is written as
an equality of booleans so the two cannot drift apart. A matched row without a
member, or a member on an unmatched row, is not representable.

The one row that is not stored is the unparseable one. A manual import line
with neither an email nor a display name carries nothing worth keeping, so it
is counted in `rejected_row_count` on the run and discarded. This is a
deliberate departure from slice 2, which stores `audience_import_rejection`
rows: there, a rejected row is a contact the customer intended to import and
will want to fix and retry. Here it is a blank line in a spreadsheet.

### Erasure reaches these rows

`raw_email` and `raw_display_name` are personal data, and some of it belongs to
people who are not contacts — the uninvited attendees above. ADRs 0046 and 0055
make erasure the one path that deletes, and slice 6 restated that indefinite
retention is not an exemption from it.

An erasure request for a contact therefore deletes the matched
`meeting_attendee` rows along with the contact row, and the `attendance_state`
on the member fact reverts to `unknown` rather than to `absent`. Recording an
erased person as a no-show would be a wrong fact created by an erasure.

Uninvited attendees have no contact row to erase through, which means an
erasure request naming one arrives without a handle the current schema can
find. It is findable by `raw_email`, and this is stated as a limitation rather
than solved here: it is a support-assisted operation, and pretending otherwise
would be the kind of unexamined claim this ledger exists to prevent.

## campaign_member_attendance

The matched fact. One row per campaign member, per ADR 0063.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    campaign_member_id      uuid not null -> campaign_member

    attendance              attendance_state_value not null default 'unknown'
    first_joined_at         timestamptz
    last_left_at            timestamptz
    total_duration_seconds  integer

    source                  attendance_source
    sync_run_id             uuid null -> attendance_sync_run
    last_synced_at          timestamptz

    updated_at              timestamptz not null

    unique (organisation_id, campaign_member_id)
    index  (organisation_id, campaign_id, attendance)
    check  (attendance <> 'unknown' or sync_run_id is null)

    attendance_state_value: unknown | attended | absent

RLS: enabled, forced. Written by `app_worker` on the sync path.

A separate table rather than columns on `campaign_member` or
`invitation_response`, for the reason slice 4 gives for separating response
from membership: attendance sync is a third worker, running after the event on
its own schedule, and it would otherwise contend for row locks with the
response sync. Three workers, three tables, no shared hot rows.

`attendance` is three-valued and `unknown` is its default. This is the whole
correctness argument of ADR 0063 expressed as a column default: a campaign that
has never synced reports every member as `unknown`, not `absent`. A boolean
here would report a webinar with no host access as a webinar nobody came to.

`total_duration_seconds` sums the member's sessions rather than subtracting
`last_left_at` from `first_joined_at`, because people rejoin. The difference
between the two is the gap, and reporting the gap as attendance time overstates
engagement on exactly the calls where the connection was bad.

`last_synced_at` carries the same meaning it does in slice 4 — it distinguishes
"absent" from "not asked since the host account needed reauthorisation" — and
it is why the results screen can show provider-reported data with a timestamp
rather than implying it is live.

## The segments, which are computed and not stored

ADR 0063. Every campaign member falls into exactly one:

    attendance = unknown                        -> unknown
    attendance = attended                       -> attended
    attendance = absent, response = accepted    -> accepted_but_missed
    attendance = absent, response = tentative   -> tentative_missed
    attendance = absent, response = declined    -> declined_absent
    attendance = absent, response = no_response -> no_response_absent

The six sum to `campaign.member_count`, and a test under ADR 0052 asserts that
identity. It is cheap to assert and it is the thing that breaks first when
someone adds a state to `response_state` without adding a segment.

`no_show` is the union of the last four. It is a rollup the product shows
because organisers use the word, and it is defined in one place precisely so
that it can never appear in a list beside `accepted_but_missed`, which it
contains. ADR 0026's original five segments did exactly that, which is W27.

`attended` ignores the response deliberately. Someone who declined and came
anyway attended, and that is the fact the organiser wants.

Attendees the platform never invited are not in any segment, because the
segments partition the invited membership. They are counted from
`meeting_attendee` where `match_state <> 'matched'` and reported as their own
number. Folding them into `attended` would let attendance exceed the invitation
count, which is the kind of impossible total that destroys trust in a whole
screen.

The read is a join across `campaign_member`, `invitation_response` and
`campaign_member_attendance`, all three keyed by `(organisation_id,
campaign_member_id)` and all three carrying `organisation_id` first in their
indexes per ADR 0043. If this screen ever becomes slow, ADR 0059 names the
escalation path, and it is not to start storing segments.

## What this slice does not build

**No meeting creation.** ADR 0028. The platform reads a meeting that already
exists and holds no scheduling, recording, or waiting-room concerns.

**No follow-up campaigns.** The segments are the input to follow-up, and ADR
0012 anticipates the workflow, but nothing here sends anything. A follow-up is
a campaign, and campaigns are slices 3 and 4.

**No engagement scoring.** `total_duration_seconds` is stored because the
provider reports it; no threshold turns it into "really attended". That would
be a product decision nobody has taken, and encoding a guess as a column is how
a guess becomes permanent.

**No `attendance_import_rejection` table.** Explained above: an unmatched
attendee is a first-class state rather than a rejection, and a blank spreadsheet
line is not worth a row.

## Resolved: the slice 8 question

What an audit event is a record of. Answered 2026-09-08, and as with slice 6
the framing was the problem: **both, joined by a trace**. ADR 0064.

Eleven of ADR 0032's thirteen listed events are evidence and two are work, and
those two carry all the volume. The audit log records the eleven. The work
stays in `send_plan`, `invitation_attempt` and `attendance_sync_run`, where it
already is, and a trace identifier on those rows connects each of them to the
decision that caused it — so the log stays small enough to be hash-chained
without losing the ability to ask what an approval set in motion.

ADR 0045 decision 4 had already designated the send plan as audit evidence for
sending, so an audit row per send would have duplicated a decision taken three
slices earlier. See `08-audit.md`.
