# Schema slice 3: campaigns, revisions, frozen membership

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.
This slice has one exception to them, and it is the one slice 1 anticipated:
the event time is stored as local time plus zone rather than as an instant
(ADR 0044).

## What this slice owns, and what it does not

It owns the campaign itself, the versioned event details, and the frozen set of
contacts a campaign will invite.

It does not own the send plan, the mailbox assignment, or the per-operation
Invitation Attempt - those are slice 4 - and it does not own sending domains,
the deliverability gate, or campaign health, which are slice 5. Where a column
here is written by a later slice, it says so.

## campaign

One webinar (ADR 0057). Its event details are NOT here; they are versioned and
live on `campaign_revision`.

    id                        uuid pk
    organisation_id           uuid not null -> organisation
    name                      text not null
    status                    campaign_status not null default 'draft'
    send_mode                 send_mode not null

    source_audience_id        uuid null -> audience          -- 0057, provenance
    current_revision_seq      integer not null default 0
    member_count              integer not null default 0
    membership_frozen_at      timestamptz                    -- 0057

    sending_domain_id         uuid null                      -- slice 5
    meeting_provider          meeting_provider not null default 'custom'
    meeting_url               text
    meeting_reference         text                           -- 0026
    attendance_host_account_id uuid null -> meeting_host_account  -- 0027, 0062
    attendance_state          attendance_state not null default 'not_configured'

    created_by_user_id        text not null
    created_at                timestamptz not null default now()
    updated_at                timestamptz not null

    index (organisation_id, status)
    index (organisation_id, created_at desc)

    campaign_status:  draft | planning | pending_approval | scheduled
                    | sending | paused | cancelling | cancelled
                    | completed | failed
    send_mode:        native_calendar | calendar_email
    meeting_provider: zoom | teams | google_meet | custom
    attendance_state: not_configured | ready | pending | synced
                    | failed | manual

RLS: enabled, forced.

`source_audience_id` is provenance, not membership. It records which audience
the campaign was built from so the question "where did this list come from"
stays answerable, and it is nullable because an audience may later be deleted
while the campaign that used it must not be. Membership itself is in
`campaign_member` and is frozen. Nothing on the send path reads this column -
that is the whole point of ADR 0057, and it is written here so that a future
reader does not helpfully "fix" the missing join.

`current_revision_seq` is an integer rather than a foreign key to the current
revision. A foreign key would be circular - the revision references the
campaign, the campaign references the revision - and buys nothing, because
`(campaign_id, seq)` is already unique on the revision table.

`meeting_url` and `meeting_reference` are separate because ADR 0028 uses
existing meeting links while ADR 0026 needs a provider-side identifier to fetch
attendance. A pasted Zoom URL is not a meeting id, and deriving one by parsing
the URL is guesswork that breaks whenever a provider changes its link format.

`attendance_host_account_id` carries ADR 0027: a pasted URL alone does not
grant access to attendance data, so automated sync requires the connected
account that hosts the meeting. It is nullable, and null is a supported state -
0027 says such campaigns remain sendable and fall back to manual import, which
is what `attendance_state = 'manual'` records.

Corrected 2026-09-08. This column originally referenced `mailbox`, which cannot
hold a Zoom account - `mailbox_provider` is `google | microsoft` by
construction - so one of ADR 0026's three providers was unreachable. It now
references `meeting_host_account`, defined in slice 7. W26, closed by ADR 0062.

`status` deliberately includes `cancelling` as distinct from `cancelled`. Under
ADR 0045 cancelling is a delivery operation for every contact holding a
successful create, not a flag flip, so there is a real interval during which
cancel operations are still being sent. Collapsing the two states would make
the system claim a campaign is cancelled while withdrawal invitations are still
going out.

## campaign_revision

ADR 0045, decision 1. A reschedule creates a new revision rather than updating
a row. The sequence number here is what the iCalendar `SEQUENCE` property in
ADR 0022 carries, and what a provider event update reflects.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    seq                     integer not null

    title                   text not null
    description             text
    location                text
    start_local             timestamp not null      -- WITHOUT time zone, 0044
    end_local               timestamp not null      -- WITHOUT time zone, 0044
    timezone                text not null           -- IANA identifier

    reason                  revision_reason not null
    created_by_user_id      text not null
    created_at              timestamptz not null default now()

    unique (organisation_id, campaign_id, seq)

    revision_reason: initial | reschedule | detail_change

RLS: enabled, forced.

The five versioned fields are exactly the ones ADR 0045 names: title, times,
timezone, location, description. They exist here and nowhere else. Putting a
convenience copy of `title` on `campaign` would create two answers to what the
event is called, and the wrong one would be the easier to query.

`start_local` and `end_local` are `timestamp` **without** time zone, paired
with an IANA `timezone`, per ADR 0044. Postgres would happily accept
`timestamptz` here and silently convert to UTC, which is precisely the bug 0044
exists to prevent: an event booked for 3pm local must still be 3pm local after
a government changes its daylight-saving rules. Any UTC value needed for
ordering or for "starts in three hours" is derived at query time and never
stored.

Validation, per 0044, enforced before insert: the timezone must resolve in
`pg_timezone_names` and is normalised to its canonical form, so
`Asia/Calcutta` is stored as `Asia/Kolkata`; a local time that does not exist
in its zone - 02:30 on a spring-forward day - is rejected as a validation
error rather than silently corrected; a time that occurs twice on a fall-back
day resolves to the first occurrence.

`reason` distinguishes a reschedule, which moves the event and forces a new
send cycle at full cost under 0045, from a detail change that does not. Both
advance the sequence, because both change what the recipient's calendar should
show, and the organiser is shown the projected operation cost before
confirming either.

Revisions are append-only. There is no `updated_at`, because a revision is
never updated; the next change is the next revision.

## campaign_member

The frozen set, ADR 0057. Written once when the campaign's first send plan is
approved, and extended only by a later plan version.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    contact_id              uuid not null -> contact

    display_name            text
    merge_fields            jsonb not null default '{}'

    calendar_uid            text not null                   -- 0022
    provider_event_id       text                            -- 0045, slice 4
    provider_mailbox_id     uuid null -> mailbox            -- slice 4

    added_in_plan_version   integer not null default 1
    frozen_at               timestamptz not null default now()

    unique (organisation_id, campaign_id, contact_id)
    unique (organisation_id, campaign_id, calendar_uid)
    index  (organisation_id, campaign_id, added_in_plan_version)
    index  (organisation_id, contact_id)

RLS: enabled, forced.

`display_name` and `merge_fields` are snapshotted from `audience_member` at
freeze rather than joined live. **This goes one step beyond what ADR 0057
decided**, which was membership only, and the reason is the same reason: a
re-import that changes a contact's job title would otherwise change the content
of an already-approved campaign mid-send, so half the audience gets one wording
and half gets another. The plan is meant to be reproducible evidence of what
was approved, and the copy costs one text column and one jsonb per member.

`calendar_uid` is the stable private UID ADR 0022 requires per contact. It is
generated once at freeze, not at send, because updates and cancellations must
reuse it and advancing the sequence against a changed UID would appear in the
recipient's client as a second unrelated event rather than an update. It is
unique within a campaign.

`provider_event_id` carries ADR 0045 decision 7: the provider's own identifier,
stored on the first successful create, because update and cancel are impossible
without it. It is null until then, and null is meaningful - a contact with no
provider event has never been successfully sent to, so a reschedule owes them a
`create` rather than an `update`. Where a create ended in ADR 0014's `unknown`
outcome the column stays null and dependent operations for that contact block
until reconciliation resolves it. They do not proceed on the assumption that
nothing was created.

`provider_mailbox_id` records which mailbox actually created the event. Update
and cancel must go through the same mailbox, because the event lives in that
mailbox's calendar and no other mailbox can patch it. It is written by slice 4
on the first successful create, not by the planner, since a plan can be
re-versioned before it ever sends.

`added_in_plan_version` is how a later plan version's additions stay
distinguishable from the original frozen set, which ADR 0057 requires when
contacts are added to an approved campaign. Slice 4 owns the plan version
table; this column is a plain integer so that this slice does not depend on it.

## What is frozen, and what is not

Frozen at approval: who is in the campaign, and the field values used to render
their invitation.

Not frozen, and deliberately: **suppression**. ADR 0057 says so explicitly and
it is worth restating beside the schema, because the frozen roster makes it
tempting to treat membership as a licence to send. A contact who unsubscribes
on Tuesday must not receive an invitation on Thursday, so the suppression join
from slice 2 runs again immediately before the provider call, per ADR 0039 and
0015. Membership decides who was planned. Suppression keeps a veto until the
last moment.

Also not frozen: a contact's bounce state and the mailbox capacity itself. A
mailbox that throttles or drops to `needs_reauth` reduces capacity already
committed under ADR 0058, and the affected plans are re-evaluated rather than
discovering the shortfall at send time.

## Deriving the operation for a contact

ADR 0045 decision 2 derives the operation - `create`, `update`, or `cancel` -
by comparing the highest revision a contact has successfully received against
`campaign.current_revision_seq`. That comparison reads Invitation Attempt rows,
which are slice 4, so the authoritative answer is an aggregate over attempts
and is not cached here.

It is worth saying why not, because a cached `highest_revision_delivered` on
`campaign_member` is the obvious optimisation and would be wrong in the same
way the rejected `is_suppressed` boolean of slice 2 was wrong: the failure
direction of a stale value is sending a `create` to someone who already holds
the event, or skipping an `update` for someone holding the wrong time. If
measurement shows the aggregate is too slow at 50,000 contacts, the fix is a
column maintained inside the same transaction that writes the attempt's
terminal state - never a lazily refreshed cache, and never a nightly rebuild.

## Resolved: the slice 4 question

Whether ADR 0058's capacity commitments are a running balance per mailbox per
day or summed from the plan rows. Answered 2026-09-07: **a balance**, written in
the same transaction as the plan rows it counts, so it cannot drift at any point
a reader could observe. Its invariant is checked by a scheduled job rather than
assumed. See `04-send-plan.md`.
