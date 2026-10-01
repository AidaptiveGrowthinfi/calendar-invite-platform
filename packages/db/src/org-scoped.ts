/**
 * The organisation-scoped table helper. ADR 0043.
 *
 * `spec/00-overview.md` states the tenancy rule as three things that must all
 * be true of every organisation-scoped table:
 *
 *   1. `organisation_id` present, and FIRST in every index.
 *   2. Row-level security enabled AND forced.
 *   3. A policy with `with check` as well as `using`.
 *
 * Getting any of them wrong is a cross-organisation leak or a write that lands
 * in the wrong tenant. Rather than restate them per table and rely on review,
 * a table declares itself organisation-scoped through `orgScoped()` and gets
 * all three by construction.
 *
 * The enumeration test in `test/rls-enumeration.test.ts` is still required -
 * ADR 0043 asks for it and `spec/05-invariants-and-tests.md` makes it CI gate
 * 2 - because this helper only covers tables that remembered to use it. The
 * helper prevents the mistake; the test catches the omission.
 */
import { sql } from 'drizzle-orm';
import { pgPolicy, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { appUser } from './roles';

/**
 * The tenant predicate. ADR 0043: compare `organisation_id` against a
 * transaction-local setting.
 *
 * The `true` second argument to `current_setting` is what makes a missing
 * setting return NULL instead of raising. NULL fails the equality, so the
 * policy matches no rows - which is ADR 0043's designed failure mode: code
 * that forgets tenant context gets an empty result, which is loud, rather than
 * another organisation's data, which is silent.
 */
export const TENANT_PREDICATE = sql`organisation_id = current_setting('app.organisation_id', true)::uuid`;

/**
 * The `organisation_id` column every scoped table carries.
 *
 * Declared as a function rather than a shared column object because Drizzle
 * column builders are stateful and reusing one instance across tables produces
 * silently wrong schemas.
 */
export const organisationIdColumn = (references: () => AnyPgColumn) =>
  uuid('organisation_id').notNull().references(references, { onDelete: 'restrict' });

/**
 * The standard tenant policy: `using` for reads, `withCheck` for writes.
 *
 * `withCheck` is not optional and not a duplicate of `using`. Without it a
 * write can set `organisation_id` to another organisation's value: `using`
 * governs which rows are visible, `with check` governs what a row is allowed to
 * become. ADR 0043 names both.
 *
 * Scoped to `app_user`. `app_worker` holds BYPASSRLS and is unaffected, which
 * is exactly why its use is restricted to ADR 0043's exhaustive list.
 */
export const tenantPolicy = (tableName: string): ReturnType<typeof pgPolicy> =>
  pgPolicy(`${tableName}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: appUser,
    using: TENANT_PREDICATE,
    withCheck: TENANT_PREDICATE,
  });
