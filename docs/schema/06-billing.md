# Schema slice 6: plans, entitlements and metering

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.

This slice covers the plan catalogue and its prices (ADRs 0029, 0031), the
entitlements the application owns rather than the billing provider (0030), the
limit dimensions (0040), and the meter that enforces and evidences them (0031,
0045, 0060).

## The decision this slice rested on

Slice 5 left one question open: whether metered usage is read from
`invitation_attempt` or accumulated into its own usage ledger. Answered
2026-09-08, and the answer rejects the question's framing: **a running counter
for enforcement and a sealed period for evidence**, with `invitation_attempt`
remaining the underlying truth while a period is open. ADR 0060.

The framing failed because usage is two requirements wearing one word.
Enforcement is asked on the hot path and tolerates being slightly stale.
Evidence is asked rarely and must remain answerable years later under the plan
and prices in force at the time. A per-operation ledger row buys the second at
the cost of doubling writes on the send path — roughly 300,000 rows instead of
150,000 for a 50,000-contact campaign rescheduled twice — to purchase an
immutability that is only needed once a month, at period close.

This is not inconsistent with slice 4's capacity balance, and the difference is
worth naming because it is the whole reason the two are shaped differently.
Capacity is consumed and released continuously and has no afterlife: last
month's mailbox capacity is not a fact anyone will ever query. Billing usage
has an afterlife measured in years. So capacity gets a balance and nothing
else; usage gets the same balance plus a seal at the boundary where its
afterlife begins.

One leg of that argument was removed the same day it was written. ADR 0060 also
justified the seal on billing evidence outliving attempt retention, and ADR
0061 then established that nothing is ever deleted, which makes that leg
vacuous. The seal stands on the two that remain, and both are load-bearing
alone: `subscription` holds only the current plan version and is updated in
place, so which version priced a past period is not otherwise reconstructable;
and a bill must not silently restate itself when attempts are corrected or
backfilled. Recorded rather than quietly dropped, because a conclusion that
survives the loss of an argument should be seen to survive it.

## plan

The catalogue. Small, global, and rarely written.

    id            uuid pk
    code          text not null unique       -- stable identifier, e.g. 'growth'
    name          text not null              -- display, changeable
    sort_order    integer not null default 0
    status        plan_status not null default 'draft'
    created_at    timestamptz not null default now()
    updated_at    timestamptz not null

    plan_status: draft | active | retired

Not organisation-scoped, and therefore not part of the set ADR 0043 governs.
This is the same position as `organisation` in slice 1 rather than a fourth
exemption: 0043's rule and its exhaustive exemption list are about tables that
carry `organisation_id`, and this one does not. It is readable by every tenant
because a plan catalogue is public product information, and writable only by
migrations and platform administration.

`code` is what the application references; `name` is what a customer reads.
Separating them means renaming a plan for marketing does not touch a foreign
key. ADR 0031 and 0040 both leave the actual names and tiers to the product
owner, and this table is why that decision can still be outstanding without
blocking anything.

`retired` means no new subscription may reference it. Existing subscriptions on
a retired plan continue, which is why the status lives here and not as a
deletion.

## plan_version

A plan's price and interval at a point in time. Immutable once written.

    id                    uuid pk
    plan_id               uuid not null -> plan
    version               integer not null
    currency              char(3) not null            -- 'INR' at launch, ADR 0029
    price_minor           bigint not null             -- minor units, never a float
    interval              billing_interval not null
    provider              billing_provider not null
    provider_plan_ref     text                        -- Razorpay plan id
    effective_from        timestamptz not null
    created_at            timestamptz not null default now()

    unique (plan_id, version)
    unique (provider, provider_plan_ref)
    check  (price_minor >= 0)

    billing_interval:  month | year
    billing_provider:  razorpay

Rows are immutable, enforced by a trigger that rejects `UPDATE` and `DELETE`,
and they are never pruned. This is a mechanism rather than a convention for the
reason ADR 0043 gives about conventions: a rule that lives only in code review
is a rule that eventually does not run, and this one is what makes a sealed
billing period answerable years later. Repricing inserts a new version.

`price_minor` is an integer in the currency's minor units. Money is never a
floating point number here, and the currency column exists from the first
migration rather than being assumed to be INR, because ADR 0029 explicitly
anticipates a second provider for international expansion and a currency column
added later is a data migration over billing history.

`provider` and `provider_plan_ref` are the adapter seam ADR 0029 requires. They
sit on the version rather than the plan because a Razorpay plan object encodes
a price, so a repricing produces a new object there too.

## plan_entitlement

One row per plan version per dimension. This is the table ADR 0030 is about:
the platform's own answer to what a customer may do, held independently of what
the billing provider says.

    id                  uuid pk
    plan_version_id     uuid not null -> plan_version
    dimension           plan_dimension not null
    limit_value         bigint not null default 0
    is_unlimited        boolean not null default false

    unique (plan_version_id, dimension)
    check  (limit_value >= 0)
    check  (not is_unlimited or limit_value = 0)

    plan_dimension:
      team_seat | connected_mailbox | sending_domain | api_key
      | native_invite | calendar_email_invite | imported_contact
      | attendance_sync | shared_trial_send

The enum is ADR 0040's list as narrowed by ADR 0061, which removed
`retention_days`: nothing is retained for a shorter time on a cheaper plan, so
retention is not a thing a plan buys. Nine dimensions, in the vocabulary of
`CONTEXT.md`, and the enum is closed — a dimension the product invents later is
a migration and a decision, not a string someone writes into a row. That is
deliberate, because 0040's whole purpose was to lock the dimensions before
pricing.

Unlimited is an explicit boolean rather than a null or a sentinel like `-1`.
A null would mean both "unlimited" and "not yet configured", and those two
must not be the same value in a table that gates product behaviour.

Immutable on the same trigger as `plan_version`, and for the same reason: an
entitlement edited in place would silently change what a period already sealed
was measured against.

A test under ADR 0052 asserts that every active plan version has a row for
every value of `plan_dimension`. A missing entitlement must fail at deploy,
never at the moment a customer is refused or wrongly allowed.

### The two kinds of dimension, and why only one is metered

The nine dimensions are two things, and building one mechanism for all of them
would be machinery bought for dimensions that do not need it.

**Flow** — `native_invite`, `calendar_email_invite`, `imported_contact`,
`attendance_sync`, `shared_trial_send`. Accumulated over a billing period.
These are what `usage_counter` counts.

Each needs its unit stated where it is produced, not here. `attendance_sync` is
defined in slice 7 as one unit per campaign, charged on the first run that
succeeds or partially succeeds, so retries and provider failures are free.

**Stock** — `team_seat`, `connected_mailbox`, `sending_domain`, `api_key`. A
ceiling on what currently exists, enforced by counting live rows at the moment
one is created. Connecting a mailbox counts mailboxes. The counts are in the
tens, the events happen a few times per organisation per year, and a counter
here would be a drift risk purchased for nothing.

There was a third kind until ADR 0061. `retention_days` was configuration
rather than a limit - a value a retention job would read - and it is gone along
with the job, because no plan expires anything.

## subscription

What plan an organisation is on, owned locally.

    id                          uuid pk
    organisation_id             uuid not null -> organisation
    plan_version_id             uuid not null -> plan_version
    status                      subscription_status not null
    provider                    billing_provider not null
    provider_subscription_ref   text
    current_period_start        timestamptz not null
    current_period_end          timestamptz not null
    cancel_at_period_end        boolean not null default false
    created_at                  timestamptz not null default now()
    updated_at                  timestamptz not null

    unique (organisation_id)
    unique (provider, provider_subscription_ref)
    index  (organisation_id, current_period_end)
    check  (current_period_end > current_period_start)

    subscription_status: trialing | active | past_due | cancelled | expired

RLS: enabled, forced. Written by `app_worker` on the webhook path.

One row per organisation. History is not kept here; it is in the sealed periods
below, which is where a question about the past can actually be answered with
the numbers that go with it.

This row is the authority on entitlement, and Razorpay is the authority on
payment. ADR 0030 is unambiguous that these are different questions, and the
schema keeps them apart: every gate in the product reads
`plan_entitlement` through `plan_version_id` on this row, and nothing in the
send path ever asks the provider anything. A webhook delay, a provider outage,
or a change of provider under 0029's adapter therefore cannot change what a
customer can do — it can only change when this row is updated.

`past_due` is a status, and what it gates is access, never data. Under ADR 0061
no status on this row causes a row anywhere else to be deleted: an organisation
that stops paying loses the ability to use the product and keeps every campaign,
audience, attempt and response it ever had, and restoring access restores the
history intact. Exactly which capabilities a `past_due` organisation retains -
read-only access, or none - is still a product decision not yet taken, but it is
a decision about a predicate, and the schema needs nothing further to support
either answer.

There is deliberately no archive flag, no cold tier, and no re-onboarding path.
A restoration is a change of `status` and nothing else, because each of those
mechanisms would be a way for the guarantee to fail quietly.

A plan change mid-period closes the current period and seals it, then opens a
new one on the new version. Taken by recommendation rather than confirmed: the
alternative — one period spanning two prices — makes the sealed record
un-priceable without storing a proration rule alongside it, which is a second
pricing system. Reversible; flag it if proration becomes a requirement.

## usage_counter

The running counter. One row per organisation per billing period per flow
dimension. The same shape as `mailbox_capacity_day` in slice 4, taken for the
same reasons.

    id                  uuid pk
    organisation_id     uuid not null -> organisation
    period_start        date not null
    dimension           plan_dimension not null
    used                bigint not null default 0
    updated_at          timestamptz not null

    unique (organisation_id, period_start, dimension)
    check  (used >= 0)
    check  (dimension in ('native_invite', 'calendar_email_invite',
                          'imported_contact', 'attendance_sync',
                          'shared_trial_send'))

RLS: enabled, forced. Written by `app_worker` on the dispatcher and import
paths.

The check constraint, rather than a second enum for flow dimensions, is what
restricts this table to the five. One vocabulary is worth more than the tidiness
of a narrower type: two overlapping enums are two lists to keep in agreement,
and `CONTEXT.md` exists precisely to stop the same concept acquiring two names.

`period_start` is the date of `subscription.current_period_start` in the
organisation's timezone. Billing periods are anchored to the subscription, not
to the calendar month, because Razorpay anchors them to the signup date.

## usage_period and usage_period_line

The seal. Written once at period close and immutable afterwards.

    usage_period
      id                    uuid pk
      organisation_id       uuid not null -> organisation
      period_start          date not null
      period_end            date not null
      plan_version_id       uuid not null -> plan_version
      subscription_status   subscription_status not null
      sealed_at             timestamptz not null
      provider_invoice_ref  text

      unique (organisation_id, period_start)
      index  (organisation_id, period_start desc)
      check  (period_end > period_start)

    usage_period_line
      id                  uuid pk
      organisation_id     uuid not null -> organisation
      usage_period_id     uuid not null -> usage_period
      dimension           plan_dimension not null
      quantity            bigint not null
      limit_value         bigint not null
      is_unlimited        boolean not null

      unique (usage_period_id, dimension)
      check  (quantity >= 0)

RLS: enabled, forced on both.

The lines copy `limit_value` and `is_unlimited` from the entitlement even
though `plan_version_id` on the header could reach them. That copy is not
redundancy of the kind slice 5 refused for RSVP tokens: it records what the
quantity was actually measured against at seal time, which is a different fact
from what the plan version says today, and it is the fact a billing dispute
turns on. The price is not copied, because `plan_version` is immutable by
trigger and is never deleted, so the reference is already durable.

`provider_invoice_ref` is nullable and is filled when Razorpay issues the
invoice for the period. It is the join between the platform's evidence and the
provider's document, and it is on the seal rather than on the subscription
because there is one per period.

### Sealing, which is the price of the seal

Sealing a period, in one transaction:

    -- read usage_counter rows for (organisation, period_start)
    -- read plan_entitlement for the subscription's plan_version at period end
    -- insert usage_period + one usage_period_line per flow dimension
    -- advance subscription.current_period_start / _end

    commit;

Idempotent by the unique constraint on `(organisation_id, period_start)`, so a
retried or late run is safe and a duplicate is a no-op rather than a second
invoice.

The seal is billing-critical, and this is the cost of the design rather than a
footnote to it: a period that is not sealed cannot be invoiced. A closed period
with no `usage_period` row alerts, and it alerts on a schedule that gives a
person time to act before the invoice is due. This is the same obligation shape
as slice 4's reconciliation job, with a sharper consequence — a divergent
capacity balance is a bug, an unsealed period is revenue that does not get
billed.

Counter rows are not deleted after sealing. They are roughly five rows per
organisation per month, and keeping them is what makes a drift investigation
possible after the fact.

### Reconciliation, which is the price of the counter

The counter is a denormalisation. Its invariant is:

    used = count of invitation_attempt rows for that organisation, in that
           period, in a terminal successful state, of the operation types
           the dimension covers

Checked by a scheduled job and by a test under ADR 0052, per ADR 0060, and a
divergence alerts rather than self-correcting. A counter that quietly repairs
itself hides the bug that caused it, and here it would also silently restate a
customer's bill.

A drift discovered **after** a seal is not fixed by rewriting the sealed period.
It is corrected by a subsequent adjustment, visibly. That is what immutable
evidence means; a seal that can be edited when it turns out to be inconvenient
is not evidence.

## Where the gates are

Flow dimensions are gated at campaign approval, in the same transaction as ADR
0058's capacity admission, not per send:

    select * from usage_counter
      where organisation_id = $org and period_start = $period
      for update;                          -- serialise concurrent approvals

    -- capacity admission, per slice 4
    -- entitlement test: used + projected operations <= limit_value
    -- insert send_plan_item rows, increment committed
    -- set send_plan.status = 'approved'

    commit;

This follows from ADR 0058 rather than adding to it. A campaign that will
exhaust the plan's monthly invites two thirds of the way through fails in
exactly the way 0058 exists to prevent — several thousand contacts stranded
uninvited on the morning of the webinar — and it should be refused at the same
moment and shown the same kind of shortfall. The remedies differ: upgrade the
plan, reduce the audience, or wait for the period to roll.

A campaign whose window crosses a period boundary is tested against each
period's remaining entitlement for the operations that fall in it, because that
is where they will be counted.

ADR 0045 requires the projected cost of a reschedule be shown before
confirmation. This is the query behind that number, and running the gate at
approval is what lets the projection be truthful rather than optimistic.

Per-send increments are then bookkeeping: `used` is incremented in the same
transaction that writes the attempt's terminal state and increments
`mailbox_capacity_day.consumed`. No new transaction, no second commit on the
send path.

Stock dimensions are gated at creation. Connecting a mailbox counts the
organisation's mailboxes against `connected_mailbox` under `FOR UPDATE` on the
subscription row; verifying a sending domain counts sending domains; inviting a
member counts seats.

Imports are gated at the point slice 2 already rejects rows, so an import that
would exceed `imported_contact` is refused with a count rather than half
applied.

A test under ADR 0052 enumerates `plan_dimension` and fails when a value has no
enforcement point. The failure this prevents is a dimension that is priced,
displayed on a pricing page, and enforced nowhere.

## What this slice does not build

**No usage-based billing and no overage.** ADR 0031 is explicit that the MVP
uses simple tiers. The counter and the seal make usage-based pricing possible
later without a data migration, which is what 0031 asks for, and nothing in
this slice charges for an operation.

**No cache.** ADR 0059. The counter is the fast read.

**No `api_key` table.** It is a priced dimension in ADR 0040 but belongs with
tenancy, not with billing. Defined in slice 1 on 2026-09-08; the stock-limit
enforcement described above is what this slice contributes to it.

**No plan names, prices, or numeric limits.** Still a product-owner decision,
per ADRs 0031 and 0040. Every one of them is a row in `plan_version` and
`plan_entitlement`, which is why the schema does not wait on them.

## Resolved: the slice 7 question

This slice originally left open whether retention deletes the rows it expires
or aggregates before deleting. Answered 2026-09-08, and the question is void
rather than decided: **nothing is ever deleted**, on any plan, internal or
paid. ADR 0061.

That removes the problem instead of solving it. Slice 7's analytics needs no
sealed roll-up, because the rows it derives from do not expire: ADR 0026's
attended, no-show, accepted-but-missed, declined and no-response segments are
computed from `invitation_response` and the attendance sync whenever they are
asked for, and a campaign from three years ago answers the same questions as
one from last week.

The one deletion path that remains is erasure on request, which ADRs 0046 and
0055 already own and which this slice does not touch. It deletes a contact row
and its bounce state; suppression survives as a keyed digest precisely so that
honouring an unsubscribe does not require keeping an address. The two must stay
distinguishable in code. "We never delete" answers a billing question and must
never be the answer to an erasure one.

Slice 6 therefore leaves no open question. Slice 7 covers attendance and
analytics under ADRs 0026 and 0027, and starts unblocked.
