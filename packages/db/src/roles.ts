/**
 * The three database roles. ADR 0043.
 *
 *   app_user    The API. Subject to RLS. Holds no bypass.
 *   app_worker  BYPASSRLS. Used ONLY by the three exempt components.
 *   migrator    Owns the schema. Separate from both.
 *
 * Declared `.existing()` because their attributes - LOGIN, PASSWORD, BYPASSRLS,
 * ownership - are not expressible in Drizzle's `pgRole`, and a role created
 * without BYPASSRLS would make the dispatcher silently see nothing rather than
 * fail. They are created by the hand-written bootstrap migration
 * `migrations/0000_bootstrap_roles.sql`, which is the one migration in this
 * project that is not generated.
 *
 * `drizzle.config.ts` still sets `entities.roles` as ADR 0042 requires, with
 * these three excluded so that drizzle-kit does not try to manage what it
 * cannot express.
 */
import { pgRole } from 'drizzle-orm/pg-core';

/** Runs the API. Every tenant read and write goes through `withOrg()`. */
export const appUser = pgRole('app_user').existing();

/**
 * Runs the worker. Holds BYPASSRLS, and ADR 0043's exemption list is the
 * exhaustive set of things it may be used for. Everything else a worker does -
 * including the per-organisation body of a job the dispatcher selected - runs
 * inside `withOrg()` as `app_user`.
 */
export const appWorker = pgRole('app_worker').existing();

/** Owns the schema. Never used by a running application process. */
export const migrator = pgRole('migrator').existing();

export const ROLE_NAMES = ['app_user', 'app_worker', 'migrator'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
