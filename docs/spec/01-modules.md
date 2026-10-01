# Specification: the module map

ADR 0001 makes this one application with clear internal modules. The boundaries
below are the schema slices, because the slices were derived from the ADRs and
each one already declares what it owns and what it refuses to own.

Each module lists the tables it **owns** — meaning it is the only module that
writes them — the ADRs that bind it, and, where it matters, what it must not
do. "Must not" entries are not style advice; each one names a shape some slice
explicitly rejected, so that it is not reintroduced by someone who has not read
the slice.

## Platform modules

These own no product tables and are dependencies of everything else.

### `platform/db`

Drizzle schema, generated migrations, `withOrg()`, the three roles, the
`pgPolicy` declarations. ADRs 0042, 0043.

Must not: expose a raw connection outside the module; offer any way to run a
tenant query without `withOrg()`; ship a `drizzle-kit push` script.

### `platform/config`

Environment loading and SOPS/age secret decryption. ADR 0049. Fails at boot on
a missing secret rather than at first use.

### `platform/crypto`

One home for every keyed operation, because slice 2 identifies drift between
two normalisers as a silent, unrepairable failure.

- Email normalisation, ADR 0046's frozen rules: trim, NFC, punycode the domain,
  lowercase the whole address. **One function, called from one place.** Contact
  identity and the suppression digest are computed from the same call.
- The suppression HMAC and its pepper. The pepper can never be rotated (slice
  1); losing it silently destroys every suppression record.
- Token encryption at rest, AES-256-GCM (ADR 0033). v1's `lib/crypto.js` is the
  reference technique.
- RSVP and unsubscribe token signing (slice 5). A separate key from the
  pepper, and rotatable — see OPEN-S5.
- API key generation, `gi_<base62(organisation_id)>_<secret>`, and its SHA-256
  digest (slice 1). A plain digest here, deliberately, not the pepper.

Must not: hold two email normalisers. Must not use the suppression pepper for
anything else.

### `platform/observability`

Structured logs, request identifiers, campaign and job identifiers on every log
line, stored provider response codes, Sentry for web/API/worker, health checks
for API, worker, Redis and PostgreSQL. ADR 0035.

`request_id` is the seam to `audit_trace.request_id` (slice 8) and is the only
thing shared between a log line and an audit record.

### `platform/audit` — slice 8

Owns `audit_trace`, `audit_event`, `audit_chain_head`. ADRs 0032, 0064.

The only writer of the chain. Exposes two operations: open a trace, and append
an event to one. Appending takes `FOR UPDATE` on the organisation's chain head,
computes `hash = H(prev_hash || org || seq || action || actor || subject ||
occurred_at || canonical(detail))`, inserts, and advances the head — all in the
caller's transaction, so an event and the thing it evidences commit together.

Must not: accept personal data in `detail`; it holds identifiers only, so
erasure never rewrites the log. Must not use a Postgres sequence for `org_seq`
— sequences gap on rollback, and in a hash chain a gap is indistinguishable
from a deleted row. Must not log an invitation send (ADR 0064).

`actor_type` has an explicit `system` value. A null actor never means "the
system did it".

## Product modules

### `identity` — slice 1

Owns `organisation`, `organisation_oauth_client`, `api_key`. ADRs 0009, 0034,
0043.

Better Auth owns `user`, `session`, `account`, `organization`, `member`,
`invitation` — exemption 3, not modelled here. The one-to-one link is
`organisation.auth_organization_id`, resolved once per request; it is this
row's `id` that `withOrg()` puts into `app.organisation_id`.

API key authentication: parse the prefix, open `withOrg()` on that
organisation, read the digest of the whole presented key **under RLS as
`app_user`**. A forged prefix selects zero rows. This is why no fourth RLS
exemption is needed on the authentication path.

Must not: store an API key; only `key_prefix` for display and `key_digest`.
Must not add `revoked_by_user_id` — slice 8 records `api_key_revoked` with a
typed actor, and a nullable column would mean both "the system did it" and "we
lost track".

`last_used_at` is written opportunistically, at most once per key per few
minutes, outside the request transaction.

### `mailbox` — slice 1

Owns `mailbox`. ADRs 0010, 0033, 0041, 0047, 0048, 0049.

Google and Microsoft OAuth, token encryption, refresh, `needs_reauth` as a
normal operating state rather than an error. Holds the calendar sync token per
mailbox (ADR 0041); a `410 GONE` clears it and triggers a full resync rather
than leaving a silent gap.

Effective daily ceiling is the **lower** of `daily_capacity_target` (default
2000, ADR 0047) and `observed_capacity_ceiling` (null until a throttle is
actually seen). A discovered limit is stored and reused, never rediscovered by
breaching it again.

Microsoft mailboxes also belong to a `provider_tenant` (ADR 0066), whose
`daily_budget` caps the sum of all its mailboxes' commitments per day. Connection
collects the tenant's licence count (or its TERRL from the Exchange admin
center) and refuses `onmicrosoft.com` sending addresses.

Must not: match mailboxes on `email`. `provider_account_id` is the uniqueness
key — a renamed Workspace address is the same account, and matching on the
address creates a duplicate mailbox holding a second copy of the same tokens.
Must not be reused to hold a meeting host account (ADR 0062).

Boundary: this module owns the ceiling and the throttle state. `planning` owns
the balance that spends it.

### `audience` — slice 2

Owns `contact`, `audience`, `audience_import`, `audience_import_rejection`,
`audience_member`, `suppression_entry`. ADRs 0024, 0025, 0038, 0039, 0046,
0051, 0055.

The import pipeline: upload, column mapping, validation, MX and provider
detection, delivery-bucket derivation, deduplication, rejection capture,
counter recomputation. `rows_total = rows_imported + rows_duplicate +
rows_rejected` is a check constraint; `rows_held` is a subset of
`rows_imported` and not part of the sum.

Owns the one query the planner asks of it — which members of this audience may
be sent to — written as a left join against `suppression_entry` with an `is
null` test, never a boolean column. A dropped join is visible in review; a
dropped `and not suppressed` predicate looks like nothing at all.

Owns erasure: delete the contact row and its `audience_member` rows; the
suppression entry survives holding only a digest and a masked form. Slice 7
extends erasure to matched `meeting_attendee` rows.

Must not: add `is_suppressed` or `last_response` to `contact`. Must not give
`suppression_entry` a foreign key to `contact` — it has to outlive it. Must not
drop suppressed or previously-bounced rows silently; they are rejection reasons
the customer sees.

### `campaign` — slice 3

Owns `campaign`, `campaign_revision`, `campaign_member`. ADRs 0044, 0045, 0057,
0062.

Revisions are append-only; a reschedule or a detail change is a new revision,
both advancing `seq`, which is what the iCalendar `SEQUENCE` property carries.
Timezone validation happens before insert: the zone must resolve in
`pg_timezone_names` and is normalised to canonical form; a local time that does
not exist in its zone is rejected as a validation error, and one that occurs
twice resolves to the first occurrence.

Freezes membership at approval, snapshotting `display_name` and `merge_fields`
from `audience_member`, and generating `calendar_uid` once per member — at
freeze, not at send, because updates and cancellations must reuse it.

Must not: read `source_audience_id` on the send path. It is provenance. That is
the whole point of ADR 0057, and the missing join is deliberate. Must not cache
`highest_revision_delivered` on `campaign_member`; if the aggregate is too slow
at 50,000 contacts the fix is a column written inside the transaction that
writes the attempt's terminal state, never a lazily refreshed cache. Must not
put a convenience copy of `title` on `campaign`.

`cancelling` is distinct from `cancelled` because cancelling is a delivery
operation for every contact holding a successful create, not a flag flip.

### `planning` — slices 4 and 6

Owns `send_plan`, `send_plan_item`, `mailbox_capacity_day`. ADRs 0013, 0045,
0047, 0048, 0058, 0060, 0066.

Computes a plan; runs admission. **Approval is one transaction** and it carries
both gates, per slice 6:

    FOR UPDATE on the mailbox_capacity_day rows in the window, including every
      mailbox of any Microsoft tenant the plan touches (ADR 0066)
    FOR UPDATE on the usage_counter rows for the period
    capacity admission against each mailbox's *current* effective ceiling
    tenant admission: per day, the tenant's summed committed + projected
      <= provider_tenant.daily_budget (Microsoft only)
    entitlement test: used + projected <= limit_value, per period the window crosses
    freeze membership (campaign module, same transaction)
    insert send_plan_item rows
    increment mailbox_capacity_day.committed
    open an audit trace, append campaign_approved and plan_approved
    send_plan.status = 'approved'

A refusal is a `refused` plan carrying `admission_shortfall` — how many
operations did not fit, on which days, and whether a mailbox or a Microsoft
tenant budget was the limit — because "your campaign was refused"
is not an actionable message. The plan is kept; the next attempt is a new
version.

Must not: put execution state on `send_plan_item`. No `sent` flag, no
`attempted_at`, no status. The plan is evidence of what was going to happen and
writing outcomes onto it overwrites the intention with the result. Must not
admit against `capacity_at_commit`; that column is evidence, and admission
always evaluates the current effective ceiling.

Provider matching, fair-share allocation of the shared Cloud project quota
(ADR 0048), and the day-bucket budget all live here. The day bucket is the
platform's own accounting unit, not the provider's window — treating it as the
provider's limit is the mistake ADR 0047 warns against.

### `sending` — slice 4

Owns `invitation_attempt`. ADRs 0010, 0014, 0019, 0022, 0045, 0052.

The safety-critical module. Its rules are ADR 0052's definition of done.

The attempt row **is** the outbox: written in state `reserved` in the
transaction that claims the work, before any provider call, and enqueued to
BullMQ only after that transaction commits. A lost enqueue leaves the row
`reserved` and a sweeper re-enqueues it from the partial index. This is what
makes ADR 0013 true in the direction that matters — Redis may be flushed
without losing the platform's truth about what was to be sent.

Reservation is the shape recovered from v1 in W18b: `FOR UPDATE SKIP LOCKED` in
a subquery, with the state transition and `RETURNING` in one statement.

Immediately before the provider call, and not only at planning time,
suppression is re-evaluated (ADRs 0015, 0039, slice 3). Membership decides who
was planned; suppression keeps a veto until the last moment.

On a settled send, one transaction writes the terminal state, increments
`mailbox_capacity_day.consumed`, and increments `usage_counter.used`. No second
commit on the send path.

Must not: insert a second attempt row on retry — retries increment `try_count`
on the same row. Must not treat a timeout as a failure: it is `unknown`,
`campaign_member.provider_event_id` stays null, and dependent operations for
that contact **block** pending reconciliation rather than proceeding on the
assumption that nothing was created. Must not record "we stopped trying" as
"the provider rejected it" — that is `abandoned` versus `failed`.

Contains the provider adapters: Google Calendar, Microsoft Graph, and the
calendar-email path through `deliverability`. ADR 0022 puts template and ICS
generation in the application; ADR 0023 keeps them controlled rather than a
builder. v1's `gmail.controller.js` is the reference for OAuth and
account-lifecycle handling, and its error taxonomy is required as fixtures.

**Defects not to inherit from v1**: W17b send-then-record ordering, W19
triple-start duplicate sending, W21 service-role key bypassing RLS, and the
`increment_account_sent_safe` read-then-write race.

### `responses` — slices 4 and 5

Owns `invitation_response`. ADRs 0011, 0041.

Two sources, one table. Native ingestion is incremental via the mailbox's sync
token and reports the attendee's *current* status, so upserting on
`(organisation_id, campaign_member_id)` is idempotent by construction;
out-of-order arrivals do not overwrite a newer `last_response_at` with an older
one. Hosted RSVP writes the same row with `source = 'hosted_rsvp'`.

Provider vocabulary is mapped at the boundary — `needsAction` to `no_response`,
both `tentative` and `tentativelyAccepted` to `tentative` — so no provider's
spelling reaches the schema.

`responded_to_revision` is not optional: after a reschedule, an acceptance of
revision 1 is not an acceptance of revision 2, and reporting it as one tells
the organiser people confirmed a time they were never offered.

Must not: write into the send path's rows. A separate table is what keeps
response sync from contending for row locks with the dispatcher.

### `deliverability` — slice 5

Owns `sending_domain`, `shared_domain_allocation`, `sending_domain_dns_record`,
`email_provider_account`, `campaign_health`, `provider_webhook_event`,
`delivery_bucket_window`. ADRs 0011, 0016, 0017, 0018, 0019, 0021, 0051.

The gate is a state machine with recovery hysteresis over the append-only
`campaign_health` series; the latest row is current and reading back over
recent rows is an input to the decision, not an archive of it. Every rate is
written with its `sample_size`, because two hard bounces out of three delivered
is a 66% rate that means nothing — the same trap ADR 0016 names for low-volume
Postmaster data. Every verdict records `thresholds_version`, without which a
historical assessment cannot be interpreted.

The throttle owns atomic reservations for every dimension; workers implement no
pacing of their own. One table with a `dimension` discriminator carries all six
dimensions, which is what makes that ownership real — a new dimension is an
enum value, not a new code path in a worker. ADR 0018's trial cap is enforced
through the same mechanism as every other limit, deliberately, because an abuse
control in its own code path is one refactor away from not running.

Webhook ingestion verifies the signature **before** insert. An event that does
not verify is rejected at the endpoint and logged, never stored, because
storing unverified provider claims beside verified ones means every downstream
reader must remember to filter and one that forgets is a forged suppression.
An event that cannot be resolved to an organisation is `quarantined`, not
dropped — it is evidence of a correlation bug.

Owns the RSVP and unsubscribe token format. There is no token table: a token is
an HMAC over the campaign member identity, the action, and an expiry, verified
on receipt. The accepted consequence is that an individual token cannot be
revoked; revocation is key rotation plus the checks that run on receipt anyway
— the campaign must still exist, the member must still be in it, and
suppression is re-evaluated.

Must not: derive `tracking_host` or `rsvp_host` from `domain`. Guessing
`track.<domain>` and finding it taken is a support incident on a customer's
live DNS. Must not read provider silence as good news; `last_webhook_at` is a
health input for exactly that reason.

### `billing` — slice 6

Owns `plan`, `plan_version`, `plan_entitlement`, `subscription`,
`usage_counter`, `usage_period`, `usage_period_line`. ADRs 0029, 0030, 0031,
0040, 0060, 0061.

`subscription` is the authority on entitlement; Razorpay is the authority on
payment. Nothing in the send path ever asks the provider anything, so a webhook
delay, a provider outage, or a change of provider cannot change what a customer
may do — only when this row is updated.

`plan_version` and `plan_entitlement` are immutable, enforced by a trigger
rejecting `UPDATE` and `DELETE`, because a rule that lives only in code review
is a rule that eventually does not run.

Nine dimensions in two kinds. **Flow** — `native_invite`,
`calendar_email_invite`, `imported_contact`, `attendance_sync`,
`shared_trial_send` — accumulate into `usage_counter` and are gated at campaign
approval. **Stock** — `team_seat`, `connected_mailbox`, `sending_domain`,
`api_key` — are counted live at creation under `FOR UPDATE` on the subscription
row. There is no third kind; `retention_days` went with ADR 0061.

Sealing is idempotent by the unique constraint on `(organisation_id,
period_start)`, so a retried or late run is a no-op rather than a second
invoice. **A period that is not sealed cannot be invoiced**, so a closed period
with no `usage_period` row alerts on a schedule that leaves time to act before
the invoice is due.

Must not: rewrite a sealed period when drift is found afterwards. It is
corrected by a subsequent, visible adjustment. A seal that can be edited when
it turns out to be inconvenient is not evidence. Must not delete counter rows
after sealing; they are what makes a drift investigation possible.

A plan change mid-period closes and seals the period, then opens a new one on
the new version. Taken by recommendation, reversible — flag it if proration
becomes a requirement.

### `attendance` — slice 7

Owns `meeting_host_account`, `attendance_sync_run`, `meeting_attendee`,
`campaign_member_attendance`. ADRs 0026, 0027, 0028, 0062, 0063.

Retries insert a new `attendance_sync_run` rather than mutating the last one:
the history is the difference between "this campaign has no attendance" and
"we have tried four times and Zoom returns 403". `partial` is a real terminal
state — a truncated participant list is usable data that must not be presented
as complete.

One metered unit per campaign, charged on the first run reaching `succeeded` or
`partial`, recorded by `metered` on that run. Retries free, failures free,
manual imports metered identically to automated ones, because the entitlement
bought is attendance measurement, not the mechanism. Where a metering rule and
a pricing page disagree, the pricing page is the specification.

`attendance` is three-valued and defaults to `unknown`. A campaign that has
never synced reports every member as `unknown`, not `absent`; a boolean here
would report a webinar with no host access as a webinar nobody came to.

Segments are computed on read, never stored (ADRs 0059, 0061, 0063), as a
six-way partition summing to `campaign.member_count`. `no_show` is a rollup
defined in one place so it can never appear in a list beside
`accepted_but_missed`, which it contains. Uninvited attendees are counted
separately from `meeting_attendee` and folded into no segment — putting them in
`attended` would let attendance exceed the invitation count.

Must not: guess an ambiguous name match. `ambiguous` is surfaced for the
organiser to resolve, which sets `match_method = 'manual'`. Must not discard
unmatched rows; that answers "how many attended" with a number smaller than the
provider's own. Must not turn `total_duration_seconds` into "really attended" —
no threshold has been decided, and encoding a guess as a column is how a guess
becomes permanent.

An organisation using Google for both sending and attendance connects the same
account twice, under two consent flows. That is accepted (ADR 0062) so that a
Workspace admin-level grant does not attach to every account connected merely
to send from.

### `public` — in `apps/api`

Backend-rendered pages, per ADR 0056: hosted RSVP (accept, decline, tentative,
add-to-calendar), unsubscribe, and the branded-domain equivalents. No session,
no SPA. Every request verifies a signed token and re-checks that the campaign
exists, the member is still in it, and suppression state, before acting.

Owns no tables. Writes `invitation_response` via `responses` and
`suppression_entry` via `audience`, each inside a `recipient` audit trace.

### `apps/web` — the dashboard

Greenfield React, Vite and Tailwind (ADR 0056), hosted on the VPS alongside the
backend. `C:\growthInfi\Frontend` contributes the stack choice, a Tailwind
palette, and the CSV column-mapping sketch in `CampaignDetails.jsx`. Nothing
that runs: 796 lines, no HTTP client anywhere, hardcoded arrays, route guards
importing an auth hook that does not exist, and cold-email vocabulary
throughout.

It still has to move off the personal GitHub account to the Growth-Infi
organisation (W23).

## Dependency direction

    platform/*  <-  everything

    identity  <-  mailbox, audience, campaign, billing, deliverability, attendance
    audience  <-  campaign  <-  planning  <-  sending
    billing   <-  planning            (the entitlement gate)
    deliverability <- sending         (calendar email mode, the throttle, the gate)
    campaign  <-  responses, attendance
    platform/audit  <-  every module that records evidence

No cycles. `campaign` snapshots from `audience` at freeze and never reads it
again. `planning` reads `mailbox` ceilings and `billing` entitlements but
neither reads back. `sending` writes counters owned by `planning` and `billing`
inside the settle transaction, which is the one place a module writes another's
table — and it is deliberate, because ADR 0060 requires no second commit on the
send path.
