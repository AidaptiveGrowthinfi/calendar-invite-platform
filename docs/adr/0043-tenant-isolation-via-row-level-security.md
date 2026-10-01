# Enforce tenant isolation with PostgreSQL row-level security

Date: 2026-09-03
Closes: W7

ADR 0007 required that "every product query must preserve tenant scoping". That
is a code-review convention, not a mechanism. One omitted predicate in a planner
or reconciliation query is a cross-organisation data leak, and ADR 0007 itself
sanctions hand-written SQL for exactly the paths that touch the most rows.
Tenant isolation will therefore be enforced by the database.

Mechanism:

- Every organisation-scoped table carries `organisation_id uuid NOT NULL`
  referencing the organisation, and every index on such a table leads with
  `organisation_id`.
- Every such table has row-level security `ENABLE`d and `FORCE`d. `FORCE` is
  required: without it the table owner bypasses its own policy.
- The policy compares `organisation_id` against a transaction-local setting,
  `current_setting('app.organisation_id', true)::uuid`.
- Tables are declared in Drizzle with `enableRLS()` so that a table shipped
  without a policy is default-deny rather than open.

Roles:

- `app_user` runs the API and is subject to RLS. It holds no bypass.
- `app_worker` holds `BYPASSRLS` and is used only by the components named as
  exempt below.
- The migration owner is separate from both.

Application access goes through a single chokepoint, `withOrg(orgId, fn)`, which
opens a transaction, issues `SET LOCAL app.organisation_id`, and runs the
callback inside it. `SET LOCAL` is transaction-scoped, so this is safe under
transaction-mode connection pooling. Code that bypasses the chokepoint and
queries as `app_user` without the setting returns zero rows. That is the
intended behaviour: the failure mode of forgetting tenant context is an empty
result, which is loud, rather than another organisation's data, which is silent.

Exemptions, exhaustive. Any addition to this list requires a new ADR.

1. The dispatcher that selects which campaign's work runs next. Choosing
   between organisations is inherently cross-tenant.
2. Shared provider quota accounting. The Google Calendar API daily quota is per
   Cloud project and is drawn on by every organisation (see W4b).
3. Better Auth's own tables - users, sessions, organisation memberships. A user
   may belong to several organisations, so these are cross-organisation by
   definition and are governed by Better Auth's own access rules.

A test asserts that every table in the organisation-scoped set has row-level
security enabled and forced, and that the exemption list matches the set of
tables without it. The test fails when a new table is added without a policy.
Under Drizzle this is a second line of defence rather than the only one,
because an unpolicied table is already default-deny, but it is what keeps the
exemption list honest.

Accepted cost: every read and write on tenant data pays a policy predicate.
It is an indexed equality on a column that leads every index, so the cost is
negligible, but it is the reason the indexing rule above is part of this
decision rather than an optimisation to apply later.
