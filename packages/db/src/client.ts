/**
 * Database connections, one per role. ADR 0043.
 *
 * `spec/01-modules.md` gives `platform/db` a "must not": do not expose a raw
 * connection outside the module, and offer no way to run a tenant query
 * without `withOrg()`.
 *
 * The connection therefore sits behind the `CONNECTION` symbol in
 * `internal.ts`, which `src/index.ts` does not re-export. A handle's public
 * surface is `ping()` and `close()` - enough for a health check and a clean
 * shutdown, and not enough to bypass the chokepoint.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { CONNECTION, type Connection } from './internal';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface ConnectionOptions {
  readonly url: string;
  /** Transaction-mode pooling is assumed; `SET LOCAL` is safe under it. */
  readonly maxConnections?: number;
  readonly connectTimeoutSeconds?: number;
}

function connect(options: ConnectionOptions): postgres.Sql {
  return postgres(options.url, {
    max: options.maxConnections ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    // Drizzle generates parameterised SQL; `prepare: false` keeps the client
    // compatible with a transaction-mode pooler in front of PostgreSQL.
    prepare: false,
    onnotice: () => {
      // PostgreSQL notices are not errors and are noisy at boot. Real
      // diagnostics come from platform/observability.
    },
  });
}

interface BaseHandle {
  /** A trivial round trip, for ADR 0035's readiness check. */
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly [CONNECTION]: Connection;
}

/**
 * The API's handle. Connects as `app_user`, which holds no bypass: every read
 * and write is subject to RLS, and a query issued without
 * `app.organisation_id` returns zero rows.
 */
export interface AppDatabaseHandle extends BaseHandle {
  readonly kind: 'app_user';
}

/**
 * The worker's handle. Connects as `app_worker`, which holds BYPASSRLS.
 *
 * ADR 0043's exemption list is the exhaustive set of things this may be used
 * for. Everything else a worker does - including the per-organisation body of
 * a job the dispatcher selected - opens an `AppDatabaseHandle` and runs inside
 * `withOrg()`.
 *
 * The `exemption` argument is not decoration. It forces the caller to name
 * which of ADR 0043's three exemptions they are relying on, so a fourth use is
 * a visible, greppable thing rather than an import nobody notices.
 */
export interface WorkerDatabaseHandle extends BaseHandle {
  readonly kind: 'app_worker';
  readonly exemption: 1 | 2 | 3;
}

function handleFor(options: ConnectionOptions): BaseHandle {
  const sql = connect(options);
  const connection: Connection = { db: drizzle(sql, { schema }), sql };

  return {
    [CONNECTION]: connection,
    ping: async () => {
      await sql`select 1`;
    },
    close: async () => {
      await sql.end();
    },
  };
}

export function createAppDatabase(options: ConnectionOptions): AppDatabaseHandle {
  return { ...handleFor(options), kind: 'app_user' };
}

export function createWorkerDatabase(
  options: ConnectionOptions,
  exemption: 1 | 2 | 3,
): WorkerDatabaseHandle {
  return { ...handleFor(options), kind: 'app_worker', exemption };
}

/**
 * The migrator's connection. Owns the schema and is never used by a running
 * application process - only by `migrate.ts`, `bootstrap-roles.ts`, and tests
 * that build a schema before dropping their privileges.
 *
 * Returned raw, deliberately: it is not a tenant path, and the operations it
 * performs are DDL.
 */
export function createMigratorConnection(options: ConnectionOptions): postgres.Sql {
  return connect({ ...options, maxConnections: options.maxConnections ?? 1 });
}
