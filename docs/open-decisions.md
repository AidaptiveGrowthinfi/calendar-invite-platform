# Open Decisions

Last reviewed 2026-09-08.

## Architecture

None blocking the data model. Every finding that shapes the schema has been
closed by an ADR:

| Finding | Decision |
| --- | --- |
| W2 consent source | No consent-source field. ADR 0038 stands. |
| W3 suppression vs erasure | Keyed digest, ADR 0046 |
| W5 native response ingestion | Provider attendee status, ADR 0041 |
| W7 tenant isolation | Row-level security, ADR 0043, and ADR 0042 |
| W9 event time and DST | Organiser local time with zone, ADR 0044 |
| W10 reschedule and cancel | Planned operations, ADR 0045 |
| W4, W12 capacity and volume | ADR 0047 |
| W4b shared provider quota | Fair-share allocation, ADR 0048 |
| W6 verification vs warm-up | ADR 0051 |
| W8 secrets | SOPS and age, ADR 0049 |
| W11 availability | ADR 0050 |
| W20 send-path tests | ADR 0052 |
| W22 frontend | React and Vite, ADR 0053, corrected by ADR 0056 |
| W13 ADR format | ADR 0054 |
| Cross-tenant bounce history | Organisation-scoped, ADR 0055 |
| W25 concurrent campaign capacity | Reservation and admission, ADR 0058 |
| Metering shape | Running counter and sealed period, ADR 0060 |
| Retention and access revocation | Retain indefinitely, ADR 0061 |
| W26 attendance host account | Separate from mailbox, ADR 0062 |
| W27 analytics segments | Six-way partition, ADR 0063 |
| Audit scope and volume | Evidence plus traces, ADR 0064 |
| W28 retention vs byproducts | Minimisation windows kept, ADR 0065 |
| W29 organisation timezone | Column added, schema slice 1 |

The working ledger with full reasoning, including findings recorded as not
defects, is `architecture-review-findings.md`.

## Raised and settled while writing the specification

Both contradictions found while writing the specification were decided on
2026-09-08, on the recommendation in each case.

**W28, retention windows vs ADR 0061.** Settled by ADR 0065, which narrows 0061
rather than superseding it. Indefinite retention is the guarantee over a
customer's product data; `audience_import_rejection.raw_row` and
`provider_webhook_event.payload` are ingestion byproducts holding personal data
with no sending use, and both keep the minimisation windows slices 2 and 5 give
them. The window clears the payload column, not the row: what was rejected and
why is product data and does not expire. Two scheduled jobs exist, and they are
the only jobs in the system that delete on a schedule. The window length is
configuration and a privacy-policy line - **not a plan dimension, ever**. ADR
0061 carries a pointer and no other edit, per 0054.

One thing this adds to the disclosure ADR 0061 already required: there are now
**two** retention statements to write, not one. Indefinite for product data, a
stated window for ingestion byproducts.

**W29, `organisation` had no timezone column.** Settled by correcting schema
slice 1: `timezone text not null default 'Asia/Kolkata'`, validated against
`pg_timezone_names` and normalised by the same validator ADR 0044 requires for
`campaign_revision.timezone`. One validator, two callers. It is the
organisation's accounting day and does not substitute for a campaign's own
zone. A slice correction, not an ADR. Carried in ticket E1-1.

Five smaller gaps the specification could not fill, none of which is a
contradiction - each is simply an answer nobody has given yet. They are
recorded as `OPEN-S1` to `OPEN-S5` in `spec/00-overview.md` with the workaround
each ticket uses while it stays open:

- **OPEN-S1** `api_key.scopes` vocabulary. Empty means full access within the
  organisation; slice 1 already flags this.
- **OPEN-S2** The retry backoff schedule per `provider_error_class`. The
  taxonomy is fixed; the numbers, the ceiling, and what exhausts to `abandoned`
  are not.
- **OPEN-S3** Campaign Health threshold values. The gate's structure is decided
  and `thresholds_version` already versions the answer.
- **OPEN-S4** Object storage for uploaded import files. Slice 2 assumes object
  storage under a lifecycle rule; ADR 0006 describes a single VPS and no ADR
  chooses a store.
- **OPEN-S5** Signing-key rotation policy for RSVP and unsubscribe tokens.
  Slice 5 accepts that revocation is by key rotation. Distinct from ADR 0046's
  pepper, which can never be rotated.

## Specification and tickets

Written 2026-09-08, in `spec/` and `tickets/backlog.md`. The specification adds
no decisions: where building something needed an answer no ADR had given, it
recorded the gap above rather than filling it.

The build sequence is E0 foundations, E1 identity, E2 audit, then E3 to E5 in
parallel, converging on E6 campaigns, E7 planning, and E8 the send engine,
which is the critical path. The two clocks - the Google Cloud project and
OAuth verification - are track P and start now, in parallel with E0.

## Deferred by the product owner

- W1, MVP build scope. Deferred on the basis that scope depends on available
  warmed-up mailboxes. The finding notes that this answers send-volume scope
  rather than build scope; reopen if the schedule slips. Second reason to
  reopen, added 2026-09-07: ADR 0056 establishes that the dashboard is a
  greenfield build, so the estimate was crediting screens that do not exist.
- W4c, per-mailbox warm-up ramp. Deferred because mailboxes will be pre-warmed
  before connection. Throttle-signal detection and back-off are still required
  and are covered by ADR 0047.

## Taken by recommendation, reversible

- Metering counts operations rather than contacts, so a twice-rescheduled
  campaign costs roughly three times a single send. Changes the limit
  dimensions in ADR 0040. See ADR 0045.
- The volume targets in ADR 0047 were proposed rather than confirmed.
- A plan change mid-period closes and seals the current billing period rather
  than prorating across two prices within one period. Recorded in
  `schema/06-billing.md`; reopen if proration becomes a requirement.

## Frontend

Settled 2026-09-07: React, Vite and Tailwind, built new, hosted on the VPS
alongside the backend under ADR 0006. Public RSVP and unsubscribe pages stay
in the NestJS backend. ADR 0056, superseding 0053.

The existing `C:\growthInfi\Frontend` repository contributes the stack choice
and two references - a Tailwind palette, and the CSV column-mapping sketch in
`CampaignDetails.jsx` - and no running code. It still has to move off the
personal GitHub account to the Growth-Infi organisation (W23).

## Data model

Slices written: `schema/01-tenancy.md`, `schema/02-audience.md`,
`schema/03-campaign.md`, `schema/04-send-plan.md`,
`schema/05-deliverability.md`, `schema/06-billing.md`,
`schema/07-attendance.md`, `schema/08-audit.md`.

Settled 2026-09-07:

- A Contact is deduplicated **per organisation**. Per-import values - display
  name, merge fields, source row - live on `audience_member`. See
  `schema/02-audience.md`.
- Bounce history is **organisation-scoped**. ADR 0051's "anywhere in the
  platform's history" conflicted with ADR 0046's deliberate refusal to allow
  cross-tenant correlation. ADR 0055 narrows 0051 and rules out a
  platform-level bounce ledger without a further ADR.

Settled 2026-09-07, and they unblock slice 3:

- A campaign freezes its membership at approval and does not reference a live
  audience. One campaign is one webinar; a later import cannot enlarge an
  approved send. ADR 0057.
- Mailbox capacity is reserved by the approved plan, and approving a campaign
  is an admission decision against capacity not already committed to other
  campaigns in the same organisation. A campaign that does not fit is refused
  at approval with its shortfall, rather than stranding contacts mid-send.
  ADR 0058, closing W25.

Also settled 2026-09-07:

- ADR 0058's capacity commitments are a **running balance** per mailbox per
  day, written in the same transaction as the plan rows that claim them. The
  balance is a denormalisation, so its invariant against the plan rows is
  checked by a scheduled job and by a test under ADR 0052, and a divergence
  alerts rather than self-correcting.

- Campaign Health is an **append-only series**, latest row current. ADR 0016's
  recovery hysteresis reads prior states, so the history is an input to the
  gate rather than an archive of it.
- **No application cache in the MVP.** Redis keeps ADR 0002's remit - queues,
  retries, backoff, worker coordination - and the send path's correctness
  properties stay inside single PostgreSQL transactions. ADR 0059 states the
  escalation path if dashboard aggregates later need one.

Settled 2026-09-08, and it unblocked slice 6:

- Metered usage is a **running counter for enforcement and a sealed billing
  period for evidence**, with `invitation_attempt` remaining the underlying
  truth while a period is open. Usage was two requirements wearing one word:
  enforcement is asked on the hot path and tolerates staleness, evidence must
  outlive both the attempt rows and the prices it was billed under. ADR 0060.
- Only flow dimensions are metered. Stock dimensions - seats, mailboxes,
  sending domains, API keys - are enforced by counting live rows at creation,
  and `retention_days` is configuration rather than a limit.
- The entitlement gate is taken where ADR 0058's capacity gate is already
  taken: at campaign approval, in the same transaction, refused with a
  shortfall in the same way.

Also settled 2026-09-08, and it unblocked slice 7:

- **Nothing is ever deleted.** Every organisation retains all of its data
  indefinitely, on every plan, internal or paid. ADR 0061.
- **Revoking access is a gate, not a data operation.** An organisation that is
  `past_due`, `cancelled`, `expired` or internally suspended loses the ability
  to use the product and loses no rows. Restoring access restores the complete
  history, and it is the same organisation rather than a new one. There is no
  archive flag, no cold tier and no re-onboarding path, because each would be a
  way for the guarantee to fail quietly.
- `retention_days` is therefore **not a plan dimension**. ADR 0040's list drops
  from ten to nine, and the configuration kind of dimension disappears with it.
  ADR 0061 partially supersedes 0040; the pointer is the only edit made to it,
  per ADR 0054.
- No retention job exists. There is nothing for it to do.
- Slice 7 needs no sealed analytics roll-up. ADR 0026's segments are derived
  from `invitation_response` and the attendance sync whenever asked for,
  because the source rows do not expire.
- One of ADR 0060's three justifications for the billing seal is now vacuous -
  evidence outliving attempt retention. The seal stands on the two that remain,
  each load-bearing alone, and 0060 carries a pointer saying so rather than
  keeping a conclusion whose argument changed.
- **Erasure on request is untouched and is the only deletion path.** ADRs 0046
  and 0055 own it: an erasure request deletes the contact row and its bounce
  state, and suppression survives as a keyed digest. "We never delete" answers
  a billing question and must never be the answer to an erasure one.

Settled 2026-09-08, while modelling slice 7:

- The attendance host account is **its own table**, not a `mailbox`. Slice 3's
  `attendance_host_mailbox_id` could not hold a Zoom account, making a third of
  ADR 0026's provider support unreachable. Now `attendance_host_account_id` ->
  `meeting_host_account`. W26, ADR 0062. Slice 3 corrected.
- Analytics segments are a **six-way partition** over response and a
  three-valued attendance state, and `no_show` is a rollup rather than a peer
  of the segments it contains. ADR 0026's five overlapped, omitted `tentative`,
  and treated "never measured" as "did not attend". W27, ADR 0063.
- Analytics is **derived on read**. No roll-up, no materialised segments, no
  aggregation job - ADR 0061 keeps the source rows and ADR 0059 rules out a
  cache. The cost is a three-table join on a per-campaign screen.
- One metered `attendance_sync` is **one unit per campaign**, charged on the
  first run that succeeds or partially succeeds. Retries and provider failures
  are free.

Settled 2026-09-08, and it closed slice 8:

- The audit log records **evidence**; system work stays in the tables that
  already record it; a **trace** connects the two. Eleven of ADR 0032's
  thirteen events are evidence, two are work, and those two carry all the
  volume. ADR 0064.
- A trace is **one decision and the work it authorised**, not an object's
  lifetime. A reschedule opens a new trace, which is where ADR 0045 already put
  a decision boundary.
- The trace is **a column on rows already written**, never new rows per step.
  `invitation_attempt` does not carry it - `send_plan_id` reaches it in one
  join, and the alternative was a denormalisation on the largest table.
- `audit_event` is append-only and **hash-chained per organisation**, with a
  gap-free sequence from an `audit_chain_head` row. Tamper-evidence is what
  made the narrow log worth having, and it is only affordable because the log
  is narrow.
- Actors are typed with an explicit `system` value. A null actor never means
  "the system did it".
- Audit events hold identifiers, never addresses, so erasure never rewrites the
  log. Same collision as ADR 0046, resolved the same way.
- ADR 0032 is narrowed rather than superseded: "invitation sends" is
  deliberately not an audit event, and ADR 0064 says so, so a future reader
  does not find 0032 half-implemented.

Also settled 2026-09-08:

- `api_key` is defined in `schema/01-tenancy.md`, closing the last gap. The key
  itself is never stored, only a SHA-256 digest - a plain digest rather than
  ADR 0046's HMAC, because a 256-bit random secret has nothing to enumerate and
  a second unrotatable pepper would be a permanent liability taken on for
  symmetry alone.
- The key carries its own organisation reference, so authenticating a request
  needs **no fourth RLS exemption**. Authentication parses the prefix, opens
  `withOrg()`, and reads the digest as `app_user` under RLS; a forged prefix
  selects zero rows.

**Slices 1 to 8 are written. The data model is complete.**

## Outstanding work, not decisions

- W18, recovering the v1 Supabase function definitions into version control.
  Instructions in `legacy-v1-schema/`.
- W23, the offboarding data exposure. v1 is grounded so there is no continuity
  risk, but the departed teammate's Supabase access should be confirmed removed.

## Deferred until after the build, by the owner

Decided 2026-09-08: the product is built first, and the items below are settled
afterwards, on the basis that a working product gives better scope to define
them. This is recorded so a later session does not re-raise them as blockers.

- Plan names, prices, and numeric limits per plan. ADRs 0031 and 0040 were
  written for this: the dimensions are locked, so every number is a row in
  `plan_version` and `plan_entitlement` rather than a migration.
- What a `past_due` organisation may still see. One predicate; ADR 0061 already
  guarantees it keeps its data either way.
- Tenant-level deletion and the DPA drafting it depends on. Needed before the
  first enterprise contract, not before the build.
- W1 build scope and W4c warm-up ramp, already deferred previously.
- W18, recovering the v1 Supabase function definitions. Blocked on
  infrastructure that is not under company control, so deferring costs nothing.

**Two exceptions that are clocks rather than decisions**, raised 2026-09-08 and
not covered by the deferral above:

- **Google OAuth verification for the sensitive `calendar.events` scope.** A
  review queue measured in weeks to months of wall-clock time that does not
  shorten or clarify once the product exists. It also requires a Google Cloud
  project under a company account, which does not exist - the original is
  inaccessible since the developer left. Starting it late means finishing the
  product and then waiting. Recorded here rather than only in a handoff,
  because handoffs are written to a temporary directory and do not survive.
- **W23, confirming the departed teammate's Supabase access is revoked.** v1 is
  grounded so the exposure is low, but it is one login to check and it does not
  become clearer later.

## Product and business

- Exact subscription plan names
- Exact subscription prices
- Exact numeric limits for each plan
- Which capabilities a `past_due` organisation keeps - read-only access, or
  none. ADR 0061 settles that it keeps its data either way; what it can still
  see is a predicate the schema already supports.
Settled 2026-09-08: indefinite retention **will** be disclosed in the privacy
policy and the DPA, with the retention criterion stated rather than a fixed
period. Raised in ADR 0061, accepted by the owner. Legal and product, not
schema, and it needs drafting before the first customer security review.

One consequence needs an answer before that drafting, and it is not settled:
**there is no organisation-level deletion path.** ADR 0061 guarantees nothing
is deleted, and ADRs 0046 and 0055 provide erasure only per contact. A standard
data processing agreement obliges a processor to return or delete all personal
data at the end of the service, and a customer asking "delete our account and
everything in it" currently has no mechanism. Recommendation: a tenant-level
erasure operation, explicitly customer-initiated and separate from billing
status, so that "we never delete" remains true of the platform's own policy
while a customer keeps the right to leave. Needs an ADR before the DPA is
signed, not before slice 8.
