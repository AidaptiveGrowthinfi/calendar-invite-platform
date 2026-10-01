# Specification: state machines

Every enum in the schema, its legal transitions, and which module writes them.
Enums are Postgres enums so an invalid *value* cannot be written; an invalid
*transition* is application logic, and this document is what that logic
implements.

Where a pair of states looks redundant, the note says why both exist. Each of
those pairs was a deliberate refusal to collapse two facts into one, and each
would be collapsed again by someone tidying up.

## `campaign_status` — slice 3

    draft ──► planning ──► pending_approval ──► scheduled ──► sending
                 ▲               │                              │
                 └───── refused ─┘                              ├──► paused ──► sending
                                                                ├──► completed
                                                                └──► cancelling ──► cancelled

    draft            Created; revision seq 1 exists.
    planning         A plan is being computed.
    pending_approval A plan awaits the organiser.
    scheduled        A plan is approved; the send window has not opened.
    sending          The dispatcher is working the plan.
    paused           By the organiser, or by the gate.
    cancelling       Cancel operations are being delivered.
    cancelled        Every cancel has settled.
    completed        Every operation has settled.
    failed           Terminal, unrecoverable.

Writers: `campaign` for organiser actions, `planning` at approval, `sending` on
completion, `deliverability` for the gate's pause.

**`cancelling` is not `cancelled`.** Under ADR 0045 cancelling is a delivery
operation for every contact holding a successful create, not a flag flip. There
is a real interval during which withdrawal invitations are still going out, and
collapsing the two would make the system claim a campaign is cancelled while it
is still sending.

A refused plan does not fail the campaign. It returns to `planning` so the
organiser can connect a mailbox, cut the audience, or move the event.

`paused` by the gate is not resumable by calling `resume`: ADR 0016's
hysteresis reads the `campaign_health` series, and a campaign does not resume
merely because a worker was retried.

## `plan_status` — slice 4

    draft ──► pending_approval ──► approved ──► completed
                    │                  │
                    ├──► refused       ├──► superseded
                    │   (terminal)     └──► cancelled
                    └──► cancelled

Writers: `planning` only.

Plans are immutable and versioned (ADR 0045 decision 4). A reschedule produces
a new version with its own capacity computation and its own approval; nothing
mutates an approved plan.

`refused` is terminal **and the plan is kept**, carrying `admission_shortfall`.
It is the record of an admission decision, and deleting it would destroy the
only evidence of why the campaign did not start.

`superseded` sets `superseded_by_plan_id` and releases the committed capacity
the new version does not reuse.

## `attempt_state` — slice 4

    reserved ──► dispatched ──► succeeded
        ▲            │
        │            ├──► failed        (terminal)
        │            ├──► unknown  ──► succeeded | failed   (reconciliation only)
        └────────────┤
                     └──► abandoned     (terminal)

Writers: `sending` only.

    reserved    Written before any provider call. This row is the outbox.
    dispatched  Claimed by a worker; try_count incremented.
    succeeded   Terminal.
    failed      The provider rejected it. Terminal.
    unknown     No answer. NOT a failure. Resolvable only by reconciliation.
    abandoned   Retries exhausted, or the campaign was cancelled. Terminal.

Three rules that are the whole of ADR 0052's send-path requirement:

1. **A retry never inserts a row.** It increments `try_count` on this one. The
   unique constraint on `(organisation_id, campaign_id, campaign_member_id,
   operation, revision_seq)` is the idempotency key, and it is a database
   constraint rather than a check in the worker because that is the difference
   between a guarantee and an intention.

2. **`unknown` never transitions to `reserved`.** A timeout is not permission
   to try again. The provider may hold a created event; retrying creates a
   second one in the recipient's calendar. Only `reconcile-unknown`, which asks
   the provider what exists, may move it.

3. **A `create` that ended `unknown` blocks its contact.** No `update`, no
   `cancel`, no second `create`, until reconciliation resolves it.
   `campaign_member.provider_event_id` stays null, and null means "has never
   been successfully sent to", which is a meaningful answer rather than a
   missing one.

## `invitation_operation` — slices 3 and 4

Derived, not stored as a state: compare the highest `revision_seq` the contact
has successfully received against `campaign.current_revision_seq`.

    null      -> create      never successfully sent
    <  current-> update      holds an older revision
    == current-> no-op       already has this revision
    cancelling-> cancel      only where provider_event_id is present
    unknown   -> blocked     produces no operation

The aggregate is authoritative and is not cached on `campaign_member`. If it is
too slow at 50,000 contacts the fix is a column written inside the transaction
that writes the attempt's terminal state — never a lazily refreshed cache, and
never a nightly rebuild. The failure direction of a stale value is sending a
`create` to someone who already holds the event.

## `gate_state` — slice 5

    blocked ──► warming ──► eligible ⇄ slowed
                                │  ▲
                                └──► paused ──┘

    blocked   Authentication or configuration is not satisfied. No sending.
    warming   Sending under the stricter early-reputation bar.
    eligible  Sending normally.
    slowed    Sending at a reduced rate on a degrading signal.
    paused    Stopped on a hard signal.

Writer: `deliverability`, append-only. Rows are never updated or deleted.

Recovery is hysteretic and reads back over the recent series. That is why the
series exists rather than a mutable row: hysteresis is a function of prior
states, so the history is an input to the decision, not an archive of it.

While `sending_domain.warmup_state = 'warming'`, an early bounce rate is a hard
stop rather than a slow-down (ADRs 0051, 0055), and the planner applies two
extra predicates: `contact.mx_host is not null` and `contact.bounce_state =
'none'`.

Every row carries `sample_size` beside every rate and `thresholds_version`
beside the verdict. Without the first, a rate invites the exact misreading ADR
0016 warns against; without the second, a historical assessment cannot be
interpreted at all, because the numbers it was judged against are gone.

## `mailbox_status` and `throttle_state` — slice 1

    active ⇄ needs_reauth
       │  ⇅ (throttle_state: none ⇄ throttled ⇄ recovering)
       ├──► blocked
       └──► disconnected

`needs_reauth` is a **normal operating state**, not an error. v1 proved it.
A mailbox in `needs_reauth` is skipped by `response-sync` rather than failing
it, and its committed capacity is re-evaluated by `check-capacity-drop`.

`throttle_state` is orthogonal to `status`: an `active` mailbox may be
`throttled`. The residual W4c requirement is here — the owner deferred the
warm-up ramp because mailboxes are pre-warmed, and detection and back-off
remain required, because pre-warming establishes reputation and does not raise
Google's external-invite limit.

## `domain_status` and `warmup_state` — slice 5

    unverified ──► pending ──► verified ──► revoked
                      └──► failed ──┘

    warming ──► established
        └──► suspended ──► warming

`verified` is not permanent. `dns` re-checks on a schedule and a removed DKIM
record moves a domain back to `failed`.

## `subscription_status` — slice 6

    trialing ──► active ⇄ past_due ──► cancelled ──► expired
                    └──► cancelled (cancel_at_period_end)

Writer: `billing`, on the Razorpay webhook path.

**No status here deletes anything, anywhere** (ADR 0061). An organisation that
stops paying loses the ability to use the product and keeps every campaign,
audience, attempt and response it ever had. Restoring access is a change of
`status` and nothing else — there is no archive flag, no cold tier, and no
re-onboarding path, because each would be a way for the guarantee to fail
quietly.

Exactly which capabilities a `past_due` organisation retains is one predicate
and is deferred by the owner. The schema supports either answer.

## `audience_status` and `import_status` — slice 2

    audience:  draft ──► importing ──► ready
                            └──► failed

    import:    pending ──► mapping ──► validating ──► importing ──► completed
                                                          ├──► completed_with_rejections
                                                          └──► failed

`completed_with_rejections` is distinct from `completed` because a customer who
cannot see that 400 of their 10,000 rows were suppressed will conclude the
import is broken. The rejections are shown with masked addresses and a count.

## `sync_run_status` — slice 7

    pending ──► running ──► succeeded
                    ├──► partial
                    └──► failed

`partial` is a **terminal state, not a variant of failure**. A provider that
returns a truncated participant list, or a manual file where some rows parse
and some do not, has produced usable data that must not be presented as
complete, and the results screen says so.

Retries insert a new run rather than mutating the last. The history is what
distinguishes "this campaign has no attendance" from "we have tried four times
and Zoom returns 403".

## `match_state` and `attendance_state_value` — slice 7

    match_state:  unmatched ⇄ ambiguous ──► matched

    attendance:   unknown ──► attended
                      └──► absent

`ambiguous` exists because name matching is not a decision the platform takes
silently. Resolving it is an organiser action that sets `match_method =
'manual'`. Guessing and being right most of the time puts a wrong person in an
attendance record that feeds follow-up.

`attendance` defaults to `unknown` and that default carries the whole
correctness argument of ADR 0063: a campaign that has never synced reports
every member as `unknown`, not `absent`. A boolean here would report a webinar
with no host access as a webinar nobody came to.

Erasure moves a member back to `unknown`, never to `absent`. Recording an
erased person as a no-show would be a wrong fact created by an erasure.

## The segments — computed, never stored

    attendance = unknown                      -> unknown
    attendance = attended                     -> attended
    attendance = absent, response = accepted  -> accepted_but_missed
    attendance = absent, response = tentative -> tentative_missed
    attendance = absent, response = declined  -> declined_absent
    attendance = absent, response = no_response -> no_response_absent

Six, partitioning the invited membership, summing to `campaign.member_count`.

`no_show` is the union of the last four, defined in exactly one place so it can
never appear in a list beside `accepted_but_missed`, which it contains. ADR
0026's original five did exactly that, which is W27.

`attended` ignores the response deliberately: someone who declined and came
anyway attended, and that is the fact the organiser wants.

Attendees the platform never invited are in **no** segment. They are counted
from `meeting_attendee where match_state <> 'matched'` and reported as their
own number. Folding them into `attended` would let attendance exceed the
invitation count — the kind of impossible total that destroys trust in a whole
screen.
