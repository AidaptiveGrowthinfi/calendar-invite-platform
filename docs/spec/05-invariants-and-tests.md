# Specification: invariants and the tests that prove them

ADR 0052 is close to a test plan already. This document completes it: it takes
0052's eight requirements as written, adds the invariants the schema slices
state but 0052 predates, and pairs each with the test that proves it and the
failure it prevents.

The failure column is not decoration. Each entry is the thing that actually
goes wrong, and it is what tells a reviewer whether a weakened test still
covers the requirement.

## Test infrastructure

- **A real PostgreSQL instance**, not a mock, for everything touching
  concurrency, RLS, constraints, or transactions. ADR 0052 requires this for
  reservation specifically, and the same reasoning covers every guarantee that
  belongs to the database: a mock asserts only that the code called it.
- **Recorded fixtures, not live APIs**, for provider clients (ADR 0052).
- **The v1 error taxonomy reproduced as fixtures** — rate limiting, backend
  errors, transient network failures, authorisation failures — because that
  classification was learned in production and should not be relearned.
- Migrations only. `drizzle-kit push` is banned in test environments too: a
  test database built by `push` has no RLS policies, so every isolation test
  would pass against a schema that is not the one that ships.

## The ADR 0052 floor — the definition of done for the send engine

| # | Requirement | Test | Prevents |
| --- | --- | --- | --- |
| 1 | **Idempotency.** The same operation identity submitted twice produces one provider call and one attempt record. | Submit twice concurrently; assert one row, one call, and that the second insert violated the unique constraint. | A duplicate invitation in a recipient's calendar. |
| 2 | **The unknown outcome.** A provider call that times out is `unknown`, not `failed`, and permits no second create. | Drive the timeout path directly. Assert `state='unknown'`, `provider_event_id` still null, and that the next planning pass produces **no** operation for that contact. | The branch that produces duplicate events when it is wrong. |
| 3 | **Reservation under concurrency.** Two workers reserve disjoint sets. | Two connections run the `FOR UPDATE SKIP LOCKED` statement against real PostgreSQL; assert disjoint `RETURNING` sets and no overlap. | Two workers sending the same invitation. |
| 4 | **Ordering.** A reservation exists before any provider call; a failure after the call leaves a recoverable record. | Fail the process between provider call and settle; assert the row is recoverable and not lost. | W17b — v1 sent the invitation and did not update the database. |
| 5 | **Revision derivation.** Correct across create, update, cancel and no-op, including the mid-send reschedule where some contacts need a create and others an update. | Table-driven over every combination of highest-received and current revision, plus the `unknown` case, which must yield *blocked*. | Sending a `create` to someone who holds the event, or skipping an `update` for someone holding the wrong time. |
| 6 | **Suppression.** A suppressed contact is excluded at planning time **and** immediately before provider submission. | Suppress a contact after plan approval and before dispatch; assert no provider call. | Mailing someone who unsubscribed on Tuesday, on Thursday. |
| 7 | **Tenant isolation.** A query without organisation context returns no rows, and every organisation-scoped table has RLS enabled and forced. | Enumerate `pg_class`; assert every table carrying `organisation_id` has `relrowsecurity` and `relforcerowsecurity`; assert the set without them equals ADR 0043's exemption list exactly. Separately, query as `app_user` with no `app.organisation_id` and assert zero rows. | A cross-organisation leak, and a new table shipping without a policy. |
| 8 | **Capacity.** Per-mailbox and platform-wide reservations are not exceeded under concurrent campaigns. | Approve two campaigns concurrently against overlapping mailbox-days; assert `committed` never exceeds the effective ceiling and exactly one is refused with a shortfall. | Two admissions each reading 200 remaining and each committing 200. |

Requirement 7's enumeration is the one that fails when someone adds a table.
It is the reason it is written as an enumeration rather than a list of tables.

## Schema invariants — stated by the slices, added here

| Invariant | Where | Test | Prevents |
| --- | --- | --- | --- |
| `mailbox_capacity_day.committed` = approved plan items for that mailbox-day, less releases | slice 4 | Property test over approve / supersede / cancel sequences, then compare. Same assertion as the `reconcile-capacity` job. | A drifted balance admitting or refusing the next campaign wrongly. |
| `usage_counter.used` = terminal successful attempts in the period for the dimension's operations | slice 6, ADR 0060 | Same shape. Same assertion as `reconcile-usage`. | A wrong bill. |
| `delivery_bucket_window.reserved` ≥ `consumed`, and reserved matches outstanding work | slice 5 | Constraint plus a reconciliation test. | Pacing drift, and reputation damage that is expensive to undo. |
| The six segments sum to `campaign.member_count` | slice 7, ADR 0063 | Assert the identity over generated campaigns. | The next state added to `response_state` without a matching segment. **This is the one that breaks first.** |
| Every active `plan_version` has a `plan_entitlement` row for **every** value of `plan_dimension` | slice 6 | Enumerate the enum against the table. Fails at deploy. | A dimension priced, shown on a pricing page, and enforced nowhere. |
| Every value of `plan_dimension` has an enforcement point | slice 6, ADR 0052 | Assert each enum value maps to a named gate — flow at approval, stock at creation. | The same failure, from the other direction. |
| `rows_total = rows_imported + rows_duplicate + rows_rejected` | slice 2 | Check constraint plus an import test. | A summary that does not reconcile, months later, when the file is gone. |
| `audit_event` chain verifies from `org_seq` 1 | slice 8 | Recompute every hash; assert a tampered row is identified by position. Same assertion as `verify-audit-chain`. | Tamper-evidence lost silently, which is the whole value of the table. |
| `org_seq` is gap-free per organisation | slice 8 | Concurrent writers; assert no gaps and no duplicates. | A gap indistinguishable from a deleted row. This is why no Postgres sequence is used. |
| No `audit_event.detail` key or value matches an address-shaped pattern | slice 8 | Scan generated events. | An erasure request having to rewrite the audit log. |
| `audit_event` rejects `UPDATE` and `DELETE` | slice 8 | Attempt both; assert the trigger raises. | A rule that lives only in code review eventually not running. |
| `plan_version` and `plan_entitlement` reject `UPDATE` and `DELETE` | slice 6 | Same. | An entitlement edited in place silently changing what a sealed period was measured against. |
| `(actor_type = 'user') = (actor_user_id is not null)` | slice 8 | Constraint test. | A null actor meaning both "the system did it" and "we lost track of who did". |
| `(match_state = 'matched') = (campaign_member_id is not null)` | slice 7 | Constraint test. | A matched row with no member, or a member on an unmatched row. |
| `send_plan_item.mailbox_id` present exactly when the campaign is native mode | slice 4 | Constraint test both ways. | A native operation with no mailbox, or a calendar-email item claiming one. |
| Contact identity and the suppression digest come from **one** normaliser | slice 2, ADR 0046 | Assert one exported function; property test that both call sites agree over adversarial addresses (unicode, punycode, case, whitespace). | A re-imported contact silently stopping matching their own suppression entry. **Unrepairable afterwards**, because 0046's rules are frozen. |
| Sealing is idempotent | slice 6 | Seal twice; assert one `usage_period` and no second invoice. | A duplicate invoice from a retried or late run. |
| Attendance metering charges once per campaign | slice 7 | Run sync to `partial`, then to `succeeded`, then again; assert `used` incremented once and one run carries `metered`. | Charging a customer for the platform's retries and a provider's 500s. |
| A campaign with no host account never auto-syncs | slice 7, ADR 0027 | Assert `attendance_state='manual'` is skipped by the scheduler. | An automated run without a host account — the state ADR 0027 says cannot happen. |
| Webhook replay is a no-op | slice 5 | Post the same signed event twice; assert one row and one bounce recorded. | Two hard bounces and a suppression on the strength of a duplicate. |
| An unverified webhook signature is never stored | slice 5 | Post an invalid signature; assert no row anywhere. | A forged suppression, and every downstream reader having to remember to filter. |
| An event that resolves to no organisation is `quarantined`, not dropped | slice 5 | Post without correlation metadata; assert the row exists. | Destroying the evidence of a correlation bug. |
| Timezone validation | slice 3, ADR 0044 | `Asia/Calcutta` normalises to `Asia/Kolkata`; 02:30 on a spring-forward day is rejected; an ambiguous fall-back time resolves to the first occurrence. | An event booked for 3pm local silently moving when a government changes DST rules. |
| `calendar_uid` is generated at freeze and reused | slice 3, ADR 0022 | Reschedule; assert the UID is unchanged and `SEQUENCE` advanced. | The update appearing in the recipient's client as a second unrelated event. |
| `update` and `cancel` route through `provider_mailbox_id` | slice 3 | Assert a different mailbox is never selected for a dependent operation. | A patch attempted against a calendar that does not hold the event. |
| An API key's digest covers the whole presented string | slice 1 | Present a valid secret under another organisation's prefix; assert zero rows. | Cross-tenant authentication through a forged prefix. |
| An API key is never stored | slice 1 | Assert only `key_prefix` and `key_digest` are persisted. | The obvious one. |

## What is deliberately not tested

Recorded so that a coverage report is read correctly rather than acted on.

- **No test asserts an audit event per invitation send.** There is none, by
  ADR 0064 and ADR 0045 decision 4. A future reader comparing the tests against
  ADR 0032's wording finds the decision here rather than an omission.
- **No test asserts retention of product data.** ADR 0061. The two byproduct
  clearing jobs (ADR 0065) *are* tested, and the assertion is that they clear a
  column and leave the row — a rejection keeps its reason after `raw_row` is
  cleared, and webhook deduplication still works after `payload` is cleared.
- **No test asserts segment storage.** Segments are computed on read (ADR 0063,
  0059, 0061). A test that asserted a stored segment would be asserting a
  design that was refused.
- ADR 0052's list is a **floor, not a ceiling**, and applies to the send path
  specifically. Ordinary product surfaces are covered by normal judgement.

## Coverage gates in CI

ADR 0006 puts CI on GitHub Actions. The build fails, not warns, on:

1. Any ADR 0052 requirement failing.
2. The RLS enumeration finding a table without a policy, or an exemption list
   that no longer matches.
3. The `plan_dimension` enumerations — entitlement rows, and enforcement
   points.
4. The segment-partition identity.
5. A migration that was not generated (`drizzle-kit push` is banned; a schema
   diff with no migration is a failure).
6. The audit chain failing to verify on the test corpus.

These six are the ones where a failure is a correctness fault rather than a
flake, and where continuing to deploy is worse than stopping.
