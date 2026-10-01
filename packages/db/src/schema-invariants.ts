/**
 * The two things `drizzle-kit` cannot express, applied after every migration.
 *
 * ---------------------------------------------------------------------------
 * 1. FORCE ROW LEVEL SECURITY
 *
 * Drizzle's `.enableRLS()` emits `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
 * and nothing else. ADR 0043 requires RLS to be enabled AND FORCED, and states
 * why: "without it the table owner bypasses its own policy". The migrator owns
 * these tables. Without FORCE, a migration or any connection as the owner reads
 * and writes across every tenant while the policy sits there looking correct.
 *
 * 2. GRANTS
 *
 * `app_user` and `app_worker` need table privileges, and a table created by a
 * migration six months from now needs them too. `ALTER DEFAULT PRIVILEGES`
 * covers future tables; the explicit grants cover the ones already there.
 * ---------------------------------------------------------------------------
 *
 * Both are idempotent and both are derived from the live catalog rather than
 * from a list someone maintains, so a table added by a future migration is
 * covered without anyone remembering. That is the point: the failure this
 * prevents is silent, and a checklist is not a mechanism.
 *
 * `test/rls-enumeration.test.ts` verifies the result independently. This code
 * makes it right; the test proves it, and CI gate 2 fails the build when it
 * is not.
 */
import type postgres from 'postgres';

export interface SchemaInvariantReport {
  readonly forced: readonly string[];
  readonly granted: readonly string[];
}

/**
 * Every table carrying an `organisation_id` column is organisation-scoped, by
 * ADR 0043's definition. The set is computed from the catalog, not declared.
 */
const ORG_SCOPED_TABLES_SQL = `
  select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname = 'organisation_id'
    and a.attnum > 0
    and not a.attisdropped
  order by c.relname
`;

export async function applySchemaInvariants(sql: postgres.Sql): Promise<SchemaInvariantReport> {
  const scoped = await sql.unsafe<Array<{ table_name: string }>>(ORG_SCOPED_TABLES_SQL);
  const forced: string[] = [];

  for (const { table_name: table } of scoped) {
    // Identifiers cannot be parameterised. These come from pg_class rather than
    // from user input - ADR 0007's guardrail, carried forward by 0042, bans
    // string-built SQL for USER-CONTROLLED input, which this is not - and they
    // are quoted anyway.
    const quoted = `"${table.replace(/"/gu, '""')}"`;
    await sql.unsafe(`alter table ${quoted} enable row level security`);
    await sql.unsafe(`alter table ${quoted} force row level security`);
    forced.push(table);
  }

  // Privileges on what exists now.
  await sql.unsafe(`grant usage on schema public to app_user, app_worker`);
  await sql.unsafe(
    `grant select, insert, update, delete on all tables in schema public to app_user, app_worker`,
  );
  await sql.unsafe(`grant usage, select on all sequences in schema public to app_user, app_worker`);

  // Privileges on what a later migration creates. Scoped to objects created by
  // the migrator, which is the only role that creates any.
  await sql.unsafe(
    `alter default privileges for role migrator in schema public
       grant select, insert, update, delete on tables to app_user, app_worker`,
  );
  await sql.unsafe(
    `alter default privileges for role migrator in schema public
       grant usage, select on sequences to app_user, app_worker`,
  );

  return { forced, granted: ['app_user', 'app_worker'] };
}
