/**
 * The private door into a database handle.
 *
 * `spec/01-modules.md` gives `platform/db` two "must not" rules that are really
 * one rule: do not expose a raw connection outside the module, and offer no way
 * to run a tenant query without `withOrg()`.
 *
 * A handle that carried a public `db` or `sql` field would satisfy neither -
 * anyone could reach past `withOrg()` and query as `app_user` with no tenant
 * context. That returns zero rows rather than another tenant's data, so it is
 * not a leak, but it is a confusing bug and it makes the chokepoint optional.
 *
 * The connection therefore lives behind this symbol. It is exported from this
 * file and deliberately NOT re-exported from `src/index.ts`, so `withOrg()` and
 * the package's own tests can reach it and a consumer of `@platform/db`
 * cannot.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type * as schema from './schema';

export const CONNECTION = Symbol('platform/db connection');

export interface Connection {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly sql: postgres.Sql;
}
