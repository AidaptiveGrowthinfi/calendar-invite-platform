# Build backlog

Date: 2026-09-08
Derived from `../spec/`, which is derived from the ADRs and the schema slices.

Tickets are sized to a few days, not hours. Each names its dependencies, the
decisions that bind it, and acceptance criteria written as things that must be
demonstrably true rather than as work to be done.

Mirrored in Jira, project KAN ("GI Tech"), labelled `spec-v2`: epics KAN-73 to
KAN-89, tickets KAN-90 to KAN-183, each carrying its backlog id as a label
(`E8-3`) and a lane label. Dependencies are Jira "Blocks" links. KAN-1 to
KAN-72 are the pre-spec plan, labelled `pre-spec` and kept for reference.
This file stays the source of truth; Jira tracks status.

**Read `../spec/00-overview.md` before picking up any ticket.** Its
cross-cutting rules bind every one of them, and several tickets below are one
sentence long only because those rules are not restated per ticket.

## Sequence

    P   ────────────────────────────────────────────────────────  (parallel, starts now)
    E0 ─► E1 ─► E2 ─┬─► E3 ─┐
                    ├─► E4 ─┤
                    └─► E5 ─┼─► E6 ─► E7 ─► E8 ─┬─► E9
                            │                   ├─► E10 ─► E11
                            └───────────────────┴─► E12
    E13 ──────────────────────────────────────────────  (from E1, in parallel)
    E14 ──────────────────────────────────────────────  (as each counter lands)

E8 is the critical path. Everything before it exists so that it can be written
correctly, and everything after it depends on it working.

---

## P — Parallel track: the two clocks

These are not decisions and do not wait for the build. Both are wall-clock time
that does not shorten once the product exists.

### P-1 · Create a company-owned Google Cloud project

**Refs**: W23, ADR 0048, `open-decisions.md`
**Blocks**: E4, and therefore E8's native path
**Owner**: product owner, not an engineer — it needs an account, not code

The original project is inaccessible; the developer who owned it has left.
A new project under the GrowthInfi Workspace organisation is the accepted path,
and v1's project is treated as legacy.

Acceptance: a Cloud project exists under a company account; OAuth client
credentials are issued and stored per ADR 0049; the Calendar API is enabled and
its quota is recorded, because ADR 0048's fair-share allocation needs the
number.

### P-2 · Begin Google OAuth verification for `calendar.events`

**Refs**: W23, `open-decisions.md`
**Depends on**: P-1
**Blocks**: production launch, nothing before it

A sensitive-scope review queue measured in weeks to months. It does not shorten
or clarify once the product exists, and deferring it means finishing the
product and then waiting.

Note from W23: a project under a personal Gmail cannot use the Internal user
type, which requires a Workspace organisation — so this is External
verification and should be submitted early.

Acceptance: the verification request is submitted, with the consent screen,
scope justification, and demo video attached; the queue position is being
tracked.

### P-3 · Confirm the departed teammate's Supabase access is revoked

**Refs**: W23, W21
**Blocks**: nothing

v1 is grounded, so the exposure is low. It is one login to check and it does
not become clearer later. The service-role key bypasses RLS entirely, so
retained access means unrestricted read/write on v1 customer data including
connected-mailbox OAuth tokens.

Acceptance: access confirmed removed, or confirmed never held. Recorded in
`architecture-review-findings.md` under W23.

### P-4 · Move the frontend repository to the Growth-Infi organisation

**Refs**: W23, ADR 0056
**Blocks**: E13 only nominally — E13 is a greenfield build

Acceptance: the repository is owned by the organisation, not a personal
account.

---

## E0 — Foundations

### E0-1 · Monorepo, CI, and the deployment path

**Refs**: ADRs 0005, 0006
**Depends on**: nothing

`apps/api`, `apps/worker`, `apps/web`, `packages/db`, `packages/shared`.
GitHub Actions builds and tests on push to main, pushes images to GHCR, and
SSHes to the VPS so Docker Compose pulls and restarts changed services.

Acceptance: a trivial change deploys end to end; the six CI gates from
`../spec/05-invariants-and-tests.md` exist as failing-on-red jobs even where
they currently assert nothing.

### E0-2 · Drizzle, roles, RLS, and `withOrg()`

**Refs**: ADRs 0042, 0043
**Depends on**: E0-1
**This ticket is load-bearing for every ticket after it.**

`packages/db` with the three roles (`app_user`, `app_worker`, `migrator`),
`withOrg(orgId, fn)` as the only tenant access path, `pgPolicy` declarations
beside the tables, `entities: { roles: true }` in `drizzle.config.ts`.

Acceptance:
- `drizzle-kit push` does not exist as a script anywhere, including in dev.
- The RLS enumeration test from `../spec/05-invariants-and-tests.md` runs and
  passes against an empty schema, and the exemption list has exactly three
  entries.
- A query as `app_user` with no `app.organisation_id` returns zero rows, and
  there is a test asserting it.

### E0-3 · Secrets, config, and boot-time validation

**Refs**: ADR 0049
**Depends on**: E0-1

SOPS and age. Encrypted material is `bytea`, never `text`.

Acceptance: a missing or undecryptable secret fails at boot, not at first use;
no plaintext `.env` in the repository or on the VPS; nothing decryptable is
committed.

### E0-4 · Observability

**Refs**: ADR 0035
**Depends on**: E0-1

Structured logs with request, campaign and job identifiers on every line;
Sentry for web, API and worker; health checks for API, worker, Redis and
PostgreSQL.

Acceptance: `request_id` is present on every log line emitted during a request
and is the value later written to `audit_trace.request_id`.

### E0-5 · Backups and recovery

**Refs**: ADRs 0036, 0050
**Depends on**: E0-1

Daily base backups plus continuous WAL archiving to off-VPS storage.

Acceptance: RPO ≤ 15 minutes and RTO ≤ 4 hours are demonstrated by a rehearsed
restore, not asserted. ADR 0050 is explicit that a restore test which has not
run within the retention window invalidates the target — so the rehearsal is
the deliverable, not the configuration.

### E0-6 · `platform/crypto`

**Refs**: ADRs 0033, 0046; slices 1, 2, 5
**Depends on**: E0-3

One module, six operations: email normalisation, the suppression HMAC, token
encryption (AES-256-GCM, v1's `lib/crypto.js` as reference), RSVP/unsubscribe
token signing, API key generation, API key digest.

Acceptance:
- Exactly **one** exported email normaliser, and a property test over
  adversarial addresses asserting that contact identity and the suppression
  digest agree. This is the invariant whose failure is silent and unrepairable.
- The suppression pepper is used for nothing else and is documented as
  unrotatable.
- The RSVP signing key is separate and rotatable.

---

## E1 — Identity and access

### E1-1 · Better Auth, and the `organisation` seam

**Refs**: ADR 0009; slice 1
**Depends on**: E0-2

Better Auth owns `user`, `session`, `account`, `organization`, `member`,
`invitation`. The product owns `organisation`, linked one-to-one by
`auth_organization_id` and resolved once per request.

Acceptance: it is `organisation.id` that reaches `app.organisation_id`, never
the Better Auth id; the auth library is replaceable without touching an RLS
policy.

**Carries W29**, closed 2026-09-08. `organisation.timezone` is in slice 1 with
default `Asia/Kolkata`. This ticket owns the IANA validator — resolve against
`pg_timezone_names`, normalise to canonical form — and it is the **same**
validator `campaign_revision.timezone` calls in E6-1. One validator, two
callers. Slices 4 and 6 both read this column for their day and period
boundaries, so getting it wrong here is a five-and-a-half hour shift nobody
sees on a screen.

### E1-2 · `api_key` issuance and authentication

**Refs**: ADR 0034; slice 1
**Depends on**: E1-1, E0-6

`gi_<base62(organisation_id)>_<secret>`. Authentication parses the prefix,
opens `withOrg()`, and reads the digest of the whole presented key as
`app_user` under RLS.

Acceptance:
- A valid secret presented under another organisation's prefix selects zero
  rows.
- The key is returned once and never again; only `key_prefix` and `key_digest`
  persist.
- No RLS exemption was added. The list still has three entries.
- `last_used_at` is written outside the request transaction, at most once per
  key per few minutes.

Scope enforcement is **OPEN-S1**. Issue keys with an empty `scopes` array,
meaning full access within the organisation, and build the middleware seam.

---

## E2 — Audit

Early, deliberately: every module after this writes evidence, and retrofitting
a hash chain is worse than building on one.

### E2-1 · `audit_trace`, `audit_event`, `audit_chain_head`

**Refs**: ADRs 0032, 0064; slice 8
**Depends on**: E1-1

Two operations: open a trace, append an event. Appending takes `FOR UPDATE` on
the chain head, computes the hash over canonically serialised detail, inserts,
and advances the head — inside the **caller's** transaction, so an event and
the thing it evidences commit together.

Acceptance:
- `UPDATE` and `DELETE` on `audit_event` are rejected by a trigger.
- `org_seq` is gap-free under concurrent writers. No Postgres sequence is used.
- `(actor_type = 'user') = (actor_user_id is not null)` holds.
- A test asserts no `detail` key or value matches an address-shaped pattern.
- Chain verification identifies a tampered row by position.

### E2-2 · Chain verification job

**Refs**: slice 8
**Depends on**: E2-1

Acceptance: it **alerts** and does not repair. A chain that silently re-links
is a chain that hides the edit it was built to reveal.

---

## E3 — Plan catalogue and entitlements

Before planning, because approval gates on entitlements.

### E3-1 · `plan`, `plan_version`, `plan_entitlement`

**Refs**: ADRs 0030, 0031, 0040, 0061; slice 6
**Depends on**: E1-1

Nine dimensions in a closed enum. Immutability by trigger.

Acceptance:
- `UPDATE` and `DELETE` are rejected on both versioned tables.
- A test enumerates `plan_dimension` and fails when an active `plan_version`
  lacks a row for any value. This must fail at deploy, never at the moment a
  customer is refused or wrongly allowed.
- `is_unlimited` is an explicit boolean; no null and no `-1` sentinel.
- No `retention_days` anywhere (ADR 0061).

Plan names, prices and numeric limits are **deferred by the owner**. Every one
of them is a row, which is why this ticket does not wait on them. Seed a
development catalogue and mark it as such.

### E3-2 · `subscription` and the stock gates

**Refs**: ADRs 0029, 0030; slice 6
**Depends on**: E3-1

Stock dimensions — `team_seat`, `connected_mailbox`, `sending_domain`,
`api_key` — counted live at creation under `FOR UPDATE` on the subscription
row.

Acceptance: a test enumerates `plan_dimension` and fails when a value has no
enforcement point. The failure this prevents is a dimension that is priced,
displayed on a pricing page, and enforced nowhere.

---

## E4 — Mailboxes

### E4-1 · Google and Microsoft OAuth connection

**Refs**: ADRs 0010, 0033, 0048, 0049; slice 1
**Depends on**: E1-1, E0-6, E3-2, **P-1**

v1's `gmail.controller.js` is the reference for OAuth and account-lifecycle
handling — technique, not code.

Acceptance:
- Uniqueness is `(organisation_id, provider, provider_account_id)`, not email.
  A renamed Workspace address does not create a second mailbox holding a second
  copy of the same tokens.
- Tokens are `bytea` and encrypted; nothing decryptable is logged.
- `connected_mailbox` is counted **before** the consent redirect.
- `mailbox_connected` is emitted with the granted scopes in `detail`.

### E4-2 · Token refresh and `needs_reauth`

**Refs**: slice 1
**Depends on**: E4-1

Acceptance: `needs_reauth` is handled as a normal operating state and a
re-consent path exists; a scheduled job refreshes tokens before expiry so a
campaign does not discover mass `needs_reauth` mid-send.

### E4-3 · Capacity ceilings and throttle state

**Refs**: ADRs 0019, 0047; slice 1
**Depends on**: E4-1

Effective ceiling is the lower of `daily_capacity_target` (default 2000) and
`observed_capacity_ceiling`.

Acceptance: a discovered throttle writes `observed_capacity_ceiling` and it is
reused, never rediscovered by breaching the limit again. `throttle_state` is
orthogonal to `status`.

---

## E5 — Audience and import

### E5-1 · `contact` and `suppression_entry`

**Refs**: ADRs 0039, 0046, 0055; slice 2
**Depends on**: E1-1, E0-6

Acceptance:
- `suppression_entry` has **no** foreign key to `contact` and never gains one.
- Re-suppression is idempotent on `(organisation_id, digest)`.
- The suppression check is a left join and an `is null` test. No
  `is_suppressed` boolean exists on `contact`.
- No `last_response` on `contact`.

### E5-2 · The import pipeline

**Refs**: ADRs 0024, 0025, 0051; slice 2
**Depends on**: E5-1, E3-2

Upload → mapping → commit, three calls, because the mapping is a decision the
customer takes after seeing their own headers. MX and provider detection,
delivery-bucket derivation, non-SMTP verification signals, deduplication,
rejection capture.

Acceptance:
- `rows_total = rows_imported + rows_duplicate + rows_rejected` is a check
  constraint and holds after a crashed import.
- Counters are recomputed at the end, not incremented per row.
- `suppressed` and `previously_bounced` appear as rejection reasons with
  masked addresses, never as silent drops.
- A duplicate checksum is reported, not blocked.
- `imported_contact` is gated at commit and refuses with a count rather than
  applying half the file.

**OPEN-S4** blocks the object-storage half of upload. Until it is answered,
hold files on the VPS filesystem behind the same checksum interface, so the
decision changes one adapter.

Ships with **E14-10**, `clear-import-payloads` (ADR 0065): after the window,
`raw_row` is cleared and the uploaded file is removed, while the rejection row
keeps `source_row_number`, `reason` and `reason_detail`. The test asserts the
row survives and the rejected-row **count** is still answerable afterwards —
only the customer's original text goes.

### E5-3 · Borderline review

**Refs**: ADR 0024; slice 2
**Depends on**: E5-2

Acceptance: `risky` contacts enter as `pending`; the planner excludes `pending`
and `rejected`; `not_required` is the default so the common case writes no
review workload.

### E5-4 · The planner's eligibility query

**Refs**: ADRs 0015, 0039, 0051, 0055; slice 2
**Depends on**: E5-3

The exact query in slice 2, with the two extra warm-up predicates.

Acceptance: every column it filters on is indexed under `organisation_id`; no
query on this path reaches into `verification_signals`.

---

## E6 — Campaigns

### E6-1 · `campaign` and `campaign_revision`

**Refs**: ADRs 0028, 0044, 0045; slice 3
**Depends on**: E1-1

Acceptance:
- `start_local` / `end_local` are `timestamp` **without** time zone, with an
  IANA zone.
- `Asia/Calcutta` normalises to `Asia/Kolkata`; a nonexistent local time is
  rejected as a validation error; an ambiguous one resolves to the first
  occurrence.
- Revisions are append-only and have no `updated_at`.
- `reason` is supplied by the organiser, not inferred from which fields
  changed.
- No copy of `title` on `campaign`.

### E6-2 · Membership freeze

**Refs**: ADRs 0022, 0057; slice 3
**Depends on**: E6-1, E5-4

Acceptance:
- `display_name` and `merge_fields` are snapshotted at freeze, so a later
  import cannot change the content of an approved campaign mid-send.
- `calendar_uid` is generated once at freeze and reused by every update and
  cancel.
- Nothing on the send path reads `source_audience_id`.
- Suppression is **not** frozen.

---

## E7 — Planning and admission

### E7-1 · Plan computation

**Refs**: ADRs 0020, 0045, 0047, 0048; slice 4
**Depends on**: E6-2, E4-3

Acceptance: a draft plan claims nothing; the projected operation count and its
cost against both gates are returned without committing, which is the number
ADR 0045 requires be shown before a reschedule is confirmed.

### E7-2 · The approval transaction

**Refs**: ADRs 0057, 0058, 0060; slices 4, 6
**Depends on**: E7-1, E3-2, E2-1
**This is the second most safety-critical ticket in the backlog.**

One transaction: `FOR UPDATE` on the capacity rows and the usage counters,
capacity admission against each mailbox's **current** effective ceiling,
entitlement test per period the window crosses, freeze membership, insert plan
items, increment `committed`, open a trace, emit `campaign_approved` and
`plan_approved`, set `approved`.

Acceptance:
- Two concurrent approvals over shared mailbox-days: exactly one is refused,
  and `committed` never exceeds the ceiling.
- A refusal persists a `refused` plan carrying `admission_shortfall` with the
  per-day deficit and which gate refused.
- `send_plan_item` carries **no** execution state — no `sent`, no
  `attempted_at`, no status.
- A window crossing a period boundary is tested against each period's remaining
  entitlement.

### E7-3 · Capacity release and re-evaluation

**Refs**: ADRs 0019, 0058; slice 4
**Depends on**: E7-2

Acceptance: superseding or cancelling a plan releases `committed` for
operations that will never be sent; a mailbox whose ceiling drops below what is
committed triggers re-evaluation and tells the organiser, and the row records
the overcommit rather than hiding it.

---

## E8 — The send engine

ADR 0052's list is the definition of done. Every acceptance criterion here is
one of its requirements.

### E8-1 · Reservation and the outbox

**Refs**: ADRs 0013, 0014; slice 4
**Depends on**: E7-2

The attempt row **is** the outbox. `FOR UPDATE SKIP LOCKED` in a subquery, with
the state transition and `RETURNING` in one statement — the shape recovered
from v1 in W18b.

Acceptance:
- Two workers reserve disjoint sets, against real PostgreSQL, not a mock.
- Rows are written `reserved` before any provider call and enqueued only after
  that transaction commits.
- Flushing Redis loses no work: the sweeper re-enqueues from the partial index.

### E8-2 · Provider adapters and the error taxonomy

**Refs**: ADRs 0010, 0035, 0052; slice 4
**Depends on**: E8-1, E4-1

Google Calendar and Microsoft Graph behind one interface.

Acceptance: v1's four error classes are reproduced as recorded fixtures; no
test calls a live API; `error_code` and `error_detail` keep the provider's own
words.

### E8-3 · Dispatch ordering and settlement

**Refs**: ADRs 0014, 0015, 0019, 0039; slices 4, 6
**Depends on**: E8-2

Acceptance:
- Suppression is re-evaluated immediately before the provider call, and a
  contact suppressed after approval receives nothing.
- A failure between the provider call and the settle leaves a recoverable
  record — W17b does not recur.
- Settlement is **one** transaction: terminal state, `provider_event_id` and
  `provider_mailbox_id` onto the member, `consumed += 1`, `used += 1`, throttle
  `consumed += 1`.
- `update` and `cancel` route through the mailbox that created the event.

### E8-4 · The `unknown` outcome

**Refs**: ADR 0014; slice 4
**Depends on**: E8-3
**The branch that produces duplicate calendar events when it is wrong.**

Acceptance:
- A timeout is recorded `unknown`, never `failed`.
- `campaign_member.provider_event_id` stays null.
- Every dependent operation for that contact **blocks**. No second create, no
  update, no cancel.
- `unknown` never transitions back to `reserved`. Only reconciliation resolves
  it.
- A test drives the timeout path directly.

### E8-5 · Idempotency and retry

**Refs**: ADRs 0014, 0045; slice 4
**Depends on**: E8-3

Acceptance:
- The same operation identity submitted twice produces one provider call and
  one attempt record, and the second insert violates the unique constraint.
- A retry increments `try_count` and never inserts a row.
- `abandoned` is distinct from `failed`.

**OPEN-S2** blocks the backoff numbers. Implement the taxonomy-driven policy
with the schedule behind one configuration object so answering it is a config
change.

### E8-6 · Revision derivation, and reschedule mid-send

**Refs**: ADR 0045; slices 3, 4
**Depends on**: E8-5

Acceptance: table-driven over every combination of highest-received and current
revision, including the mid-send case where some contacts need a create and
others an update, and including `unknown` yielding *blocked*. No
`highest_revision_delivered` cache exists on `campaign_member`.

### E8-7 · Cancel

**Refs**: ADR 0045; slice 3
**Depends on**: E8-6

Acceptance: `cancelling` and `cancelled` are distinct, and the campaign is not
reported cancelled while withdrawal invitations are still going out.

---

## E9 — Responses

### E9-1 · Native response sync

**Refs**: ADR 0041; slice 4
**Depends on**: E8-3

Acceptance:
- Incremental via the mailbox sync token; a `410 GONE` clears it and triggers a
  full resync.
- Provider vocabulary is mapped at the boundary; both `tentative` and
  `tentativelyAccepted` become `tentative`.
- Upsert is idempotent; an older `last_response_at` never overwrites a newer
  one.
- `last_synced_at` is written even on a run that found nothing.
- `responded_to_revision` is recorded, so an acceptance of revision 1 is not
  reported as an acceptance of revision 2.

### E9-2 · Hosted RSVP and unsubscribe pages

**Refs**: ADRs 0011, 0016, 0039, 0056; slice 5
**Depends on**: E9-1, E0-6

Backend-rendered. No token table.

Acceptance:
- Every request verifies the signature and expiry, then re-checks that the
  campaign exists, the member is still in it, and suppression — in that order.
- Unsubscribe is a `POST`; the `GET` renders a confirmation, because mail
  scanners follow links.
- Each action runs inside a `recipient` audit trace.

---

## E10 — Deliverability and calendar email mode

### E10-1 · Sending domains and DNS verification

**Refs**: ADRs 0016, 0017; slice 5
**Depends on**: E3-2

Acceptance: `expected_value` sits beside `observed_value` per record;
`tracking_host` and `rsvp_host` are stored, never derived from `domain`;
`last_checked_at` is maintained, because a domain that verified in March and
lost its DKIM record in June is not verified.

### E10-2 · The shared trial domain

**Refs**: ADR 0018; slice 5
**Depends on**: E10-1

Acceptance: no platform-level RLS-exempt table is created; the allocation is
organisation-scoped; the cap is enforced through `delivery_bucket_window` like
every other limit, not by a special case in the trial path.

### E10-3 · Email provider adapter and webhook ingestion

**Refs**: ADRs 0014, 0021; slice 5
**Depends on**: E10-1

Acceptance:
- The signature is verified **before** insert; an unverified event is never
  stored.
- The organisation is resolved before insert; an unresolvable event is
  `quarantined`, not dropped.
- Replay is a no-op through `(organisation_id, provider, provider_event_id)`.
- `last_webhook_at` advances on every accepted event.
- The enum already carries Mailgun and Brevo, so the first non-SendGrid
  customer is not blocked behind a migration.

Ships with **E14-11**, `clear-webhook-payloads` (ADR 0065): after the window,
`payload` is cleared and the event keeps its identity, type, `occurred_at`,
correlation and `state`. The test asserts replay deduplication still works with
the payload gone — the unique constraint is on the identity, not the body.

### E10-4 · The adaptive throttle

**Refs**: ADR 0019; slice 5
**Depends on**: E10-3, E8-3

Acceptance: workers implement no pacing of their own; all six dimensions run
through one table with a discriminator; a new dimension is an enum value, not a
new code path.

### E10-5 · The deliverability gate

**Refs**: ADRs 0016, 0051, 0055; slice 5
**Depends on**: E10-4

Acceptance:
- Append-only; rows are never updated or deleted.
- Every rate carries its `sample_size`; every verdict carries
  `thresholds_version`.
- Recovery applies hysteresis over the recent series — a campaign does not
  resume because a worker was retried.
- Provider silence is not read as good news.

**OPEN-S3** blocks the threshold values, not the structure.

### E10-6 · Calendar email mode

**Refs**: ADRs 0015, 0021, 0022, 0023; slices 4, 5
**Depends on**: E10-5, E8-6, E10-7

Application-owned templates and ICS generation; controlled templates, not a
builder.

Acceptance: items carry no `mailbox_id` and the check constraint enforces it
against `campaign.send_mode`; `provider_message_id` is recorded;
`SEQUENCE` matches `campaign_revision.seq`; a missing merge key renders empty
rather than failing the send.

---

## E11 — Attendance and results

### E11-1 · `meeting_host_account`

**Refs**: ADRs 0027, 0062; slice 7
**Depends on**: E1-1, E0-6

Acceptance: a separate table from `mailbox`; `provider <> 'custom'`; `revoked`
and `disconnected` are distinct because they need different messages. An
organisation using Google for both connects the same account twice, and that is
accepted, not a defect to fix by merging the tables.

### E11-2 · Attendance sync and manual import

**Refs**: ADRs 0026, 0027, 0028; slice 7
**Depends on**: E11-1, E6-2

Acceptance:
- A retry inserts a new run; the history survives.
- `partial` is terminal and surfaced as incomplete, not as failure.
- A campaign with no host account is `manual` and is never auto-synced.
- A blank row is counted in `rejected_row_count` and discarded; there is no
  `attendance_import_rejection` table.

### E11-3 · Matching

**Refs**: slice 7
**Depends on**: E11-2

Acceptance: exact email is confident; anything weaker or multiply-matching is
`ambiguous` and surfaced for the organiser; unmatched rows are kept, because
discarding them answers "how many attended" with a number smaller than the
provider's own. `(match_state = 'matched') = (campaign_member_id is not null)`
holds.

### E11-4 · Segments and the results screen

**Refs**: ADRs 0026, 0059, 0061, 0063; slice 7
**Depends on**: E11-3, E9-1

Acceptance:
- Six segments, computed on read. No stored segment, no roll-up, no
  aggregation job.
- They sum to `campaign.member_count`, asserted by a test.
- `no_show` is defined in one place and never appears beside
  `accepted_but_missed`.
- Uninvited attendees are their own number and are in no segment.
- `attendance` defaults to `unknown`; a never-synced campaign reports `unknown`,
  not `absent`.
- `last_synced_at` is shown.

### E11-5 · Attendance metering

**Refs**: slices 6, 7
**Depends on**: E11-2, E12-1

Acceptance: one unit per campaign, charged on the first run reaching
`succeeded` or `partial`; `metered` records which run carried it; retries,
failures and re-syncs are free; manual imports are metered identically.

---

## E12 — Metering, sealing, and payment

### E12-1 · `usage_counter` and the flow gates

**Refs**: ADRs 0045, 0060; slice 6
**Depends on**: E7-2, E8-3

Acceptance: `used` is incremented in the same transaction that writes the
attempt's terminal state — no second commit on the send path; the check
constraint restricts the table to the five flow dimensions.

### E12-2 · Period sealing

**Refs**: ADRs 0060, 0061; slice 6
**Depends on**: E12-1

Acceptance:
- Idempotent by `(organisation_id, period_start)`; a retried or late run is a
  no-op, not a second invoice.
- Lines copy `limit_value` and `is_unlimited`; the price is not copied.
- Counter rows are not deleted after sealing.
- Drift found after a seal is corrected by a visible subsequent adjustment, and
  a test asserts the sealed rows are not rewritten.

### E12-3 · `seal-alarm`

**Refs**: slice 6
**Depends on**: E12-2

A closed period with no `usage_period` row alerts, on a schedule that leaves a
person time to act before the invoice is due. An unsealed period is revenue
that does not get billed.

### E12-4 · Razorpay

**Refs**: ADRs 0029, 0030; slice 6
**Depends on**: E3-2

Acceptance: nothing in the send path asks the provider anything; a webhook
delay or provider outage cannot change what a customer may do, only when
`subscription` is updated. A plan change mid-period seals and opens a new
period. Events open a `billing_change` trace with `actor_type =
'billing_provider'`.

---

## E13 — Dashboard

Greenfield React, Vite and Tailwind (ADR 0056), hosted on the VPS. Starts as
soon as E1 lands and tracks the API.

Cold-email vocabulary from the old repository does not come across;
`CONTEXT.md` is binding on UI copy.

    E13-1  Shell, auth, organisation switching, route guards that exist
    E13-2  Audiences: list, upload, column mapping, rejections, review queue
    E13-3  Campaigns: create, revisions, the projected-cost confirmation
    E13-4  Plan review and approval, including the refusal shortfall screen
    E13-5  Send monitoring: attempts by state, throttle and gate state
    E13-6  Deliverability: domains, DNS diff, campaign health series
    E13-7  Results: the six segments, no_show as a labelled rollup, uninvited count
    E13-8  Billing: plan, usage against limits, sealed periods
    E13-9  Settings: mailboxes, host accounts, API keys, suppression

E13-4 is the one that carries weight: a refusal must show the per-day
shortfall and which gate refused, because "your campaign was refused" is not an
actionable message.

---

## E14 — Reconciliation and operations

Each lands with the counter it checks, not afterwards. Every one **alerts and
never self-corrects**.

    E14-1  reconcile-capacity      with E7-2
    E14-2  reconcile-usage         with E12-1
    E14-3  reconcile-throttle      with E10-4
    E14-4  verify-audit-chain      with E2-2
    E14-5  sweep-reserved          with E8-1
    E14-6  reconcile-unknown       with E8-4
    E14-7  check-capacity-drop     with E7-3
    E14-8  refresh-tokens          with E4-2
    E14-9  stale-webhook           with E10-3

The two clearing jobs are not reconciliation and are listed apart, because they
are the only jobs in the system that delete anything on a schedule and a third
one must be a decision rather than a pattern being followed (ADR 0065).

    E14-10 clear-import-payloads   with E5-2
    E14-11 clear-webhook-payloads  with E10-3

Both clear a **column**, never a row. A rejection keeps `source_row_number`,
`reason` and `reason_detail` after `raw_row` goes, because what was rejected
and why is product data under ADR 0061 and does not expire. A webhook event
keeps its identity, type, correlation and `state` after `payload` goes, so
deduplication still works. Tested that way — the assertion is that the row
survives, not that the payload does.

The window length is configuration and a privacy-policy line, not a migration,
and it is **not a plan dimension** (ADR 0065).

E14-6 is the only mechanism that resolves an `unknown` attempt. Until it
exists, affected contacts block indefinitely — which is correct behaviour, and
is why it ships with E8-4 rather than later.

---

## Deliverability review additions

Added 2026-10-01 from findings W30 to W43 (`architecture-review-findings.md`
section G). Where a finding needs an ADR first, the ticket names it under
**Decision**; the workaround is to build behind configuration so the ADR
changes a value, not a code path.

### E4-4 · Microsoft tenant budget (TERRL)

**Refs**: W30, ADRs 0047, 0058, 0066; slice 1 `provider_tenant`
**Depends on**: E4-3; the admission half lands with E7-2

Rewritten 2026-10-01 when ADR 0066 corrected W30: the per-mailbox limit it was
written against was withdrawn by Microsoft. The per-mailbox default stays 2,000
for both providers. The risk is the tenant-wide external recipient limit.

Acceptance:
- Microsoft connection records the Entra `tid` and upserts a `provider_tenant`
  row; asks for the licence count or the EAC TERRL; refuses `onmicrosoft.com`
  sending addresses.
- `daily_budget` = `budget_fraction` (default 0.50) of TERRL, where TERRL is the
  declared value, else `500 x licences^0.7 + 9500`, else the 5,000 trial cap.
  Recomputed when either declared value changes. A table-driven test covers all
  three paths.
- Approval (E7-2) locks every mailbox-day of a touched tenant and refuses when a
  day's tenant sum exceeds `daily_budget`; the shortfall names the tenant.
  A concurrency test: two campaigns on different mailboxes of one tenant, only
  one admitted when together they exceed the budget.
- The throttle paces at most 20 messages/minute per Microsoft mailbox and never
  dispatches for a tenant whose trailing-24-hour count would exceed its budget.
- A sending-limit signal from any mailbox sets the tenant's `throttle_state`.

### E7-4 · Engagement-ordered planning and sunset

**Refs**: W38; slices 4, 7
**Depends on**: E7-1

Acceptance:
- Plan items carry an engagement tier from prior responses and attendance
  within the organisation; dispatch orders by tier, then `reserved_at`.
- Contacts with no engagement across N campaigns (configuration) are excluded
  from the default selection and shown as a count the organiser can include.
- Sunset never writes a `suppression_entry`.

### E8-8 · Bucket-fair dispatch

**Refs**: W33, ADR 0019; slice 4
**Depends on**: E8-3

Acceptance:
- `invitation_attempt.delivery_bucket` is written at reservation.
- The reservation query selects only buckets with throttle capacity and
  round-robins across them; the `FOR UPDATE SKIP LOCKED` shape is unchanged.
- A test throttles one bucket and asserts others keep their full rate.

### E10-7 · MIME structure and ICS renderer

**Refs**: W36, ADRs 0022, 0023; slice 3
**Depends on**: E6-2
**Decision**: D-2

A pure function from frozen member data and campaign revision to a MIME
message. Can be built and tested long before the provider adapter.

Acceptance:
- `multipart/mixed` > `multipart/alternative` (`text/plain`, `text/html`,
  `text/calendar; method=REQUEST`); `CANCEL` for cancellations.
- `UID` is `campaign_member.calendar_uid`; `SEQUENCE` is the revision seq.
- `ORGANIZER` and `From` share the verified domain.
- Golden-file tests render correctly as an invitation card in Gmail, Outlook
  and Apple Calendar (recorded once by hand, asserted thereafter).

### E10-8 · ORGANIZER inbound reply ingestion

**Refs**: W36, ADR 0011; slice 4 `invitation_response`
**Depends on**: E10-3, E10-7, E9-2
**Decision**: D-2

Acceptance:
- iTIP `REPLY` mail to the RSVP-host organiser address is parsed into
  `invitation_response` with a native-reply source.
- Inbound is verified and deduplicated as webhooks are (E10-3).
- Non-iTIP mail to that address is forwarded or dropped by configuration,
  never bounced.

### E10-9 · Authentication checks on native mailbox domains

**Refs**: W34, ADR 0016; slice 5
**Depends on**: E10-1, E4-1

Acceptance: SPF, DKIM and DMARC are checked for every connected mailbox's
domain using the E10-1 checker; failures reach the gate for native campaigns
and are shown on the mailbox.

### E10-10 · Canary stage and in-flight cap

**Refs**: W32, ADR 0019; slice 5
**Depends on**: E10-4
**Decision**: D-3

Acceptance:
- Each delivery bucket of a campaign sends a canary (1-2% or 100-200,
  configuration) and holds until outcomes reach the minimum sample.
- `in_flight` is a throttle dimension: submitted but unsettled messages per
  bucket never exceed the cap.
- `reconcile-throttle` covers the new dimension.

### E10-11 · Volume-spike cap and smoothing

**Refs**: W37, W43, ADR 0019
**Depends on**: E10-4
**Decision**: D-3

Acceptance:
- A sending domain's daily volume per bucket is capped at a multiple (3x,
  configuration) of its trailing 14-day average; warm-up is the zero-history
  case.
- Each window's budget is spread evenly across the send window; jitter only
  de-synchronises workers. No randomised human-mimicking delays.
- The planner spreads a campaign the cap would exceed across days.

### E10-12 · Gmail complaint visibility

**Refs**: W31, ADR 0016; slice 5
**Depends on**: E10-5

Acceptance:
- Every calendar email carries a `Feedback-ID` (campaign, organisation, mode,
  sender).
- The gate reads Gmail complaint rate as `unknown`, never zero.
- Postmaster spam rate is ingested to `campaign_health.signals` when
  available.
- Unsubscribe, decline and deferral rates are evaluated per bucket.

### E10-13 · Seed self-test and placement probe

**Refs**: W35, ADR 0016
**Depends on**: E10-6

Acceptance: before launch and on a schedule, a real invitation goes to
platform-owned seed mailboxes at Gmail, Outlook and Yahoo;
`Authentication-Results` alignment and inbox-or-spam placement are recorded as
a gate signal; a failed self-test blocks launch.

### E10-14 · Content and domain-reputation preflight

**Refs**: W41, W40, ADRs 0016, 0023
**Depends on**: E10-1, E10-7

Acceptance:
- A rendered HTML body over 100 KB fails preflight.
- Sending, tracking and RSVP domains are checked for registration age and
  blocklist status; both are gate inputs.
- Domain setup defaults to a dedicated subdomain and warns on a root domain
  (W40).

### E10-15 · Time-to-inbox and the event deadline

**Refs**: W42, ADRs 0019, 0035
**Depends on**: E10-3, E8-3

Acceptance: submit-to-delivered latency per bucket is recorded and shown; an
invitation whose expected delivery falls after the event start is not
submitted and ends `abandoned`.

### E10-16 · IP pool routing

**Refs**: W39, ADRs 0020, 0021
**Depends on**: E10-3
**Decision**: D-4

Acceptance: `email_provider_account.ip_pool` routes sends; a dedicated IP has
its own tracked warm-up independent of the domain's.

### D — Decisions to write

Owner lane. Each unblocks the tickets that name it.

    D-1  DONE 2026-10-01: ADR 0066, Microsoft tenant budget             (W30)
    D-2  ADR succeeding 0022: MIME structure and ORGANIZER path        (W36)
    D-3  ADR amending 0019: canary, in-flight, spike cap, smoothing    (W32, W37, W43)
    D-4  ADR: shared vs dedicated IP and the volume threshold          (W39)
    D-5  OPEN-S3 threshold values (proposal in open-decisions.md)
    D-6  OPEN-S2 backoff schedule
    D-7  OPEN-S4 object storage
    D-8  OPEN-S5 signing-key rotation policy
    D-9  OPEN-S1 API key scopes

---

## Working in parallel

Tickets carry a lane, not an owner. Two people work two lanes at a time; the
sequence diagram above says which tickets are ready.

| Lane | Contents | Notes |
| --- | --- | --- |
| `lane-core` | E0 verification, E1, E2, E5, E6, E7, E8, and the E14 jobs that ship with them | The critical path. One person, undivided, as CONTRIBUTING.md says. |
| `lane-platform` | E3, E4, E9, E10, E11, E12, and their E14 jobs | Independent modules. E3 first - it unblocks E4, E5-2 and E10-1. |
| `lane-frontend` | E13 | Against `spec/02-api.md`, with a mock server until each endpoint lands. |
| `lane-owner` | P, D | Accounts and decisions, not code. |

A workable rhythm: one person holds `lane-core` throughout; the other takes E3
first, then alternates between `lane-platform` and `lane-frontend` as each
blocks on the core.

Rules that keep two people from colliding:
- **Migrations merge one at a time.** Drizzle's `meta/` snapshot conflicts.
  The second pull request to merge rebases and regenerates its migration; it
  never hand-merges the snapshot.
- **The API contract moves first.** A change to an endpoint's shape edits
  `spec/02-api.md` in the same pull request, so the frontend lane is never
  building against a contract that only exists in the other person's branch.
- **Modules, not slices.** Split by module (`spec/01-modules.md`), never by
  schema slice.
- **A gap is raised, not filled.** CONTRIBUTING.md's rule applies; D tickets
  are where the answers land.

---

## Blocked on an owner decision

Not blocked on engineering. Each is registered in `../open-decisions.md`.

| Ticket | Blocked by | Workaround while open |
| --- | --- | --- |
| Scoped programmatic API | OPEN-S1 | Empty scopes = full access; the seam exists |
| E8-5 backoff numbers | OPEN-S2 | One configuration object |
| E10-5 threshold values | OPEN-S3 | `thresholds_version` already versions them |
| E5-2 object storage | OPEN-S4 | VPS filesystem behind the checksum interface |
| E9-2 key rotation policy | OPEN-S5 | Key is rotatable; policy undecided |
| Plan names, prices, limits | Deferred by owner | Development catalogue, marked as such |
| `past_due` capabilities | Deferred by owner | One predicate; the schema supports either answer |
