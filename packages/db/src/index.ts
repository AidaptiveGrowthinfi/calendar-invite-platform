/**
 * platform/db. ADRs 0042, 0043.
 *
 * `spec/01-modules.md` gives this module three "must not" rules:
 *
 *   - Must not expose a raw connection outside the module.
 *   - Must not offer any way to run a tenant query without `withOrg()`.
 *   - Must not ship a `drizzle-kit push` script.
 *
 * The first two are why `Database` is exported as a type but never as a value,
 * and why `withOrg()` takes an `AppDatabaseHandle` rather than a bare client.
 * The third is enforced by `scripts/gate-no-drizzle-push.mjs`.
 */
export * as schema from './schema/index';
export * from './schema/index';
export * from './timezone';

export {
  createAppDatabase,
  createWorkerDatabase,
  createMigratorConnection,
  type AppDatabaseHandle,
  type WorkerDatabaseHandle,
  type ConnectionOptions,
  type Database,
} from './client';

export {
  withOrg,
  currentOrganisationId,
  TenantContextError,
  type OrgTransaction,
} from './with-org';

export { appUser, appWorker, migrator, ROLE_NAMES, type RoleName } from './roles';

export {
  RLS_EXEMPTIONS,
  EXEMPT_TABLES,
  NOT_ORGANISATION_SCOPED,
  type RlsExemption,
} from './rls-exemptions';

export { TENANT_PREDICATE, tenantPolicy, organisationIdColumn } from './org-scoped';
export { bytea } from './bytea';
