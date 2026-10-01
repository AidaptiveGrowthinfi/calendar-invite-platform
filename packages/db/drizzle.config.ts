import { defineConfig } from 'drizzle-kit';

/**
 * ADR 0042 requires `entities.roles` so that policies and roles are generated
 * rather than hand-maintained beside the tables.
 *
 * The three roles are excluded because their attributes - LOGIN, PASSWORD,
 * BYPASSRLS - are not expressible in Drizzle's `pgRole`, and a generated
 * `app_worker` without BYPASSRLS would make the dispatcher silently see
 * nothing. They are created by `src/bootstrap-roles.ts`, which runs once per
 * environment before the first migration. Policies are still generated, which
 * is the half of ADR 0042's reasoning that matters: a policy declared beside
 * its table cannot drift from it.
 *
 * There is no `push` here and there must never be one. ADR 0042: `push` does
 * not apply RLS policies, so a database built by it has none - and every
 * isolation test would then pass against a schema that is not the one that
 * ships. `scripts/gate-no-drizzle-push.mjs` is CI gate 5.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  entities: {
    roles: {
      exclude: ['app_user', 'app_worker', 'migrator'],
    },
  },
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATOR ?? '',
  },
  verbose: true,
  strict: true,
});
