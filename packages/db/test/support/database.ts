/**
 * Test database support.
 *
 * `spec/05-invariants-and-tests.md` is explicit that this needs A REAL
 * PostgreSQL INSTANCE, not a mock, for everything touching concurrency, RLS,
 * constraints or transactions - "a mock asserts only that the code called it".
 *
 * It is equally explicit that migrations, not `push`, build the test schema:
 * a database built by `push` has no RLS policies, so every isolation test
 * would pass against a schema that is not the one that ships.
 *
 * When no database is configured these suites SKIP and say so. They do not
 * pass. A green run that silently proved nothing is worse than a skipped one,
 * because CI gate 2 exists to catch a missing policy and a skip is visible in
 * the output.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL_MIGRATOR;
export const TEST_APP_URL = process.env.TEST_DATABASE_URL_APP;

export const databaseAvailable = (): boolean =>
  TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL.length > 0;

export const skipReason =
  'no TEST_DATABASE_URL_MIGRATOR - start PostgreSQL with `pnpm dev:infra` and re-run. ' +
  'These assertions cannot run against a mock (spec/05-invariants-and-tests.md).';

export function migratorConnection(): postgres.Sql {
  if (TEST_DATABASE_URL === undefined) {
    throw new Error(skipReason);
  }
  return postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
}

export function appConnection(): postgres.Sql {
  if (TEST_APP_URL === undefined) {
    throw new Error('no TEST_DATABASE_URL_APP');
  }
  return postgres(TEST_APP_URL, { max: 2, prepare: false });
}
