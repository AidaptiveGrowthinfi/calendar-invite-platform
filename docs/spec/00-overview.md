# Specification: overview and reading order

Date: 2026-09-08
Status: current

This is the layer between the decisions and the code. The ADRs say what was
decided and why; the schema slices say what the data looks like; this
specification says what gets built, by which module, in what order, and what
must be true when it is done.

## The rule this specification follows

**It adds no decisions.** Every statement here traces to an ADR, a schema
slice, or `CONTEXT.md`, and names its source. Where building something requires
an answer no decision has given, the spec does not invent one: it marks the gap
`OPEN-S<n>`, states the recommendation, and registers it in
`../open-decisions.md`. A specification that quietly fills gaps is how a
decision gets taken by whoever wrote the paragraph.

Two consequences worth stating plainly:

- Where this spec and an ADR disagree, the ADR wins and the spec is wrong.
- Where this spec and a schema slice disagree, the slice wins, because the
  slices were derived from the ADRs directly and this was derived from both.

## Reading order

| Read | For |
| --- | --- |
| `../../CONTEXT.md` | The vocabulary. It lists forbidden synonyms; use the terms exactly. |
| `../open-decisions.md` | What is settled, deferred, and open. |
| `01-modules.md` | The module map: who owns which tables and which rules. |
| `02-api.md` | The HTTP surface, across all four entry points. |
| `03-workers-and-jobs.md` | Queues, workers, scheduled jobs, and their transaction boundaries. |
| `04-state-machines.md` | Every status enum, its transitions, and who writes them. |
| `05-invariants-and-tests.md` | What must be true, and the test that proves it. |
| `../tickets/backlog.md` | The sequenced build. |

The schema slices in `../schema/` remain the authority on tables and columns.
This spec never restates a column list; it references the slice.

## Runtime topology

ADR 0001 (modular monolith), 0005 (monorepo), 0006 (Docker Compose on one VPS).

    apps/api        NestJS HTTP.        Runs as app_user. Subject to RLS.
    apps/worker     NestJS + BullMQ.    Runs as app_worker where exempt.
    apps/web        React + Vite SPA.   Static build, served by the VPS.
    packages/db     Drizzle schema, migrations, withOrg(), roles.
    packages/shared Zod schemas (0008), domain types, the vocabulary.

Four containers plus PostgreSQL and Redis, per ADR 0006. `apps/web` is a static
bundle; ADR 0056 keeps the public RSVP and unsubscribe pages rendered by the
API rather than by the SPA, so those routes live in `apps/api`.

One VPS, no high-availability claim (ADR 0050). RPO 15 minutes via WAL
archiving; RTO 4 hours by rehearsed manual restore.

## Database roles and the access chokepoint

ADR 0043, implemented in `packages/db`.

    app_user      The API. Subject to RLS. Holds no bypass.
    app_worker    BYPASSRLS. Used only by the three exempt components.
    migrator      Owns the schema. Separate from both.

All tenant data access goes through `withOrg(orgId, fn)`: open a transaction,
`SET LOCAL app.organisation_id`, run the callback. Code that reaches the
database as `app_user` without it reads zero rows, which is the loud failure
ADR 0043 designs for.

`app_worker` is used only where ADR 0043's exhaustive exemption list permits:

1. The dispatcher choosing which organisation's work runs next.
2. Shared provider quota accounting (the Cloud project's Google Calendar quota).
3. Better Auth's own tables.

Everything else a worker does runs inside `withOrg()` as `app_user`, including
the per-organisation body of a job the dispatcher selected. **A fourth
exemption requires a new ADR.** Two features have already routed around this
rather than adding one — slice 5's shared trial domain, slice 1's `api_key`
prefix — and that is the expected response to needing one.

`drizzle-kit push` is banned in every environment, including development: it
does not apply RLS policies (ADR 0042). Schema change goes through generated
migrations only.

## Cross-cutting rules that bind every module

These are not owned by any module and every module is checked against them.

**Tenancy.** Every organisation-scoped table carries `organisation_id` first in
every index, RLS enabled and forced, policy with `with check` as well as
`using` (ADR 0043).

**Vocabulary.** `CONTEXT.md` is binding on identifiers, API paths, UI copy, and
error messages. It lists an "Avoid" set per term for a reason: v1's cold-email
vocabulary is what the frontend inherited, and ADR 0056 threw that away.

**Money.** Integer minor units, never a float, with an explicit currency
column (slice 6).

**Time.** `timestamptz` everywhere except a campaign's event time, which is
local wall-clock plus IANA zone (ADR 0044). A UTC instant for an event is
derived at query time and never stored.

**Secrets.** SOPS and age (ADR 0049). Encrypted material is `bytea`, never
`text`, so it cannot be logged as a string by accident. Never commit
credentials, to `docs/legacy-v1-schema/` or anywhere.

**Idempotency belongs to the database.** Where an operation must not happen
twice, the guarantee is a unique constraint, not a check in a worker
(slices 4, 5).

**Denormalised counters are reconciled, never self-corrected.** Four running
values exist — `mailbox_capacity_day`, `delivery_bucket_window`,
`usage_counter`, `audit_chain_head` — each written in the same transaction as
the rows it counts, each with a scheduled job that checks its invariant and
**alerts** on divergence. A balance that quietly repairs itself hides the bug
that caused it.

**Deletion has exactly three cases, and they must stay distinguishable in
code.** Product data is never deleted (ADR 0061) — "we never delete" answers a
billing question. An erasure request deletes a contact, its bounce state, its
`audience_member` rows and its matched `meeting_attendee` rows, while
suppression survives as a keyed digest (ADRs 0046, 0055) — and "we never
delete" is never the answer to an erasure one. Two ingestion byproducts are
cleared on a minimisation window (ADR 0065), and that clears a **column**, not
a row.

**ADR 0054.** A decision is never edited in place. Supersede with a new ADR and
add a pointer to the old one; that pointer is the only permitted edit. Schema
slices and these spec documents are not ADRs and may be edited freely.

## What the MVP does not build

Recorded here so a ticket is not written for it.

| Not built | Source |
| --- | --- |
| Application cache | ADR 0059 |
| Usage-based billing, overage | ADR 0031, slice 6 |
| Meeting creation, recording, waiting rooms | ADR 0028, slice 7 |
| Follow-up campaigns | slice 7 |
| Engagement scoring from attendance duration | slice 7 |
| An audit UI, cross-organisation audit | slice 8 |
| A retention job for product data | ADR 0061. Two byproduct payloads are cleared on a window; ADR 0065 |
| Template builder | ADR 0023 |
| SMTP verification (`tmp/mailVerify-inspect`) | ADR 0025 Option B, off the critical path |
| Platform-level bounce ledger | ADR 0055 |
| Per-token storage for RSVP and unsubscribe links | slice 5 |
| An audit event per invitation send | ADR 0064 |

## Open items this specification could not resolve

Each is registered in `../open-decisions.md`. None blocks starting the build;
each blocks one named ticket, noted in the backlog.

| Id | Gap | Blocks |
| --- | --- | --- |
| OPEN-S1 | `api_key.scopes` vocabulary is undefined; empty means full access within the organisation (slice 1). | Scoped programmatic API, not key issuance |
| OPEN-S2 | Retry policy per `provider_error_class`: backoff schedule, ceiling, and what exhausts to `abandoned`. `error_class` is stated to drive retry policy (slice 4); no decision gives the numbers. | The dispatcher's retry loop |
| OPEN-S3 | Campaign Health threshold values. ADR 0016 gives the gate ownership of its thresholds and slice 5 versions them; no threshold set exists. | Gate evaluation, not the gate's structure |
| OPEN-S4 | Object storage for uploaded import files. Slice 2 says object storage under a lifecycle rule; no ADR chooses one, and ADR 0006 describes a single VPS. | Import file upload |
| OPEN-S5 | Signing-key rotation for RSVP and unsubscribe tokens. Slice 5 accepts that revocation is by key rotation; no rotation policy exists. Distinct from ADR 0046's pepper, which can never be rotated. | Token issuance policy, not the token format |

Two further gaps were found while writing this spec. Both were contradictions
in decided material rather than absences, and both were settled the same day:

- **W28** — the retention windows in slices 2 and 5 against ADR 0061's "no
  retention job exists". Closed by **ADR 0065**, which narrows 0061: indefinite
  retention is the guarantee over a customer's product data, and two ingestion
  byproducts keep minimisation windows. Two scheduled jobs exist, and they are
  the only jobs in the system that delete on a schedule.
- **W29** — `organisation` had no timezone column while slices 4 and 6 both
  depended on one. Closed by correcting slice 1, which now carries
  `timezone text not null default 'Asia/Kolkata'`, validated by the same
  `pg_timezone_names` validator ADR 0044 requires.

See `../architecture-review-findings.md`.
