/**
 * `withOrg()` - the single chokepoint for tenant data. ADR 0043.
 *
 * Opens a transaction, issues `SET LOCAL app.organisation_id`, and runs the
 * callback inside it.
 *
 * `SET LOCAL` is transaction-scoped, which is what makes this safe under
 * transaction-mode connection pooling: the setting cannot leak to the next
 * borrower of the connection, because the transaction that set it has ended.
 * A plain `SET` would leak, and the leak would be another organisation's data
 * appearing in a query that looked correct.
 *
 * Code that reaches the database as `app_user` WITHOUT this returns zero rows.
 * ADR 0043 designs for that: the failure mode of forgetting tenant context is
 * an empty result, which is loud, rather than another organisation's data,
 * which is silent.
 */
import { sql } from 'drizzle-orm';
import type { OrganisationId } from '@platform/shared';
import type { AppDatabaseHandle, Database } from './client';
import { CONNECTION } from './internal';

/**
 * The transaction handle handed to the callback. It is a Drizzle transaction,
 * so everything inside commits or rolls back together - which is what
 * `platform/audit` relies on to make an event and the thing it evidences
 * commit as one.
 */
export type OrgTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Runs `fn` with tenant context set to `organisationId`.
 *
 * @param handle The `app_user` handle. Typed so that a `WorkerDatabaseHandle`
 *   cannot be passed by accident: running this as `app_worker` would set the
 *   variable on a connection that holds BYPASSRLS, where the policy is not
 *   consulted and the setting therefore does nothing. That combination looks
 *   correct in a code review and enforces nothing.
 */
export async function withOrg<T>(
  handle: AppDatabaseHandle,
  organisationId: OrganisationId,
  fn: (tx: OrgTransaction) => Promise<T>,
): Promise<T> {
  // The value is interpolated into a `set_config` call as a parameter, never
  // as string-built SQL (ADR 0042 carries ADR 0007's guardrail forward). The
  // shape check is belt and braces: a non-uuid would fail the cast inside the
  // policy predicate anyway, but it would fail there as an obscure runtime
  // error rather than here as a clear one.
  if (!UUID_PATTERN.test(organisationId)) {
    throw new TenantContextError(`organisationId is not a uuid: ${String(organisationId)}`);
  }

  return handle[CONNECTION].db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organisation_id', ${organisationId}, true)`);
    return fn(tx);
  });
}

/**
 * Reads back the tenant context inside a transaction. For tests and for the
 * health check; product code has no reason to ask.
 */
export async function currentOrganisationId(tx: OrgTransaction): Promise<string | null> {
  const rows = await tx.execute<{ value: string | null }>(
    sql`select current_setting('app.organisation_id', true) as value`,
  );
  const first = (rows as unknown as Array<{ value: string | null }>)[0];
  return first?.value ?? null;
}
