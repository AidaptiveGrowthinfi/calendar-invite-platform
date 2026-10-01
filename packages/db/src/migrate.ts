/**
 * The migration runner.
 *
 * Generated migrations only. `drizzle-kit push` is banned in EVERY
 * environment, development and test included (ADR 0042): it does not apply RLS
 * policies, so a database built by `push` has none - and then every isolation
 * test passes against a schema that is not the one that ships.
 * `scripts/gate-no-drizzle-push.mjs` is CI gate 5.
 *
 *   pnpm --filter @platform/db migrate
 */
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { applySchemaInvariants } from './schema-invariants';

/**
 * The migrations live beside the source in the repository and beside the
 * compiled output in the image, so `..` resolves correctly in both.
 */
export const MIGRATIONS_FOLDER = join(__dirname, '..', 'migrations');

export async function runMigrations(migratorUrl: string): Promise<void> {
  const sql = postgres(migratorUrl, { max: 1, prepare: false });

  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    process.stdout.write('migrations applied\n');

    // The two things drizzle-kit cannot express. See schema-invariants.ts:
    // FORCE ROW LEVEL SECURITY, which ADR 0043 requires and `.enableRLS()`
    // does not emit, and the grants that a table created by a later migration
    // needs. Both idempotent, both derived from the catalog.
    const report = await applySchemaInvariants(sql);
    process.stdout.write(
      `forced RLS on ${String(report.forced.length)} organisation-scoped table(s): ${report.forced.join(', ') || '(none yet)'}\n`,
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (url === undefined || url.length === 0) {
    process.stderr.write('DATABASE_URL_MIGRATOR is required\n');
    process.exit(1);
  }
  runMigrations(url).catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
}
