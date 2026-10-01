/**
 * Schema slice 1: the tenancy anchor.
 *
 * Only the two tables E0-2 needs are here. The rest of slice 1 - `mailbox`,
 * `api_key`, `mailbox_health` - belongs to E1 and E4, and putting them here
 * early would mean writing them before the tickets that own their behaviour.
 */
import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../bytea';
import { organisationIdColumn, tenantPolicy } from '../org-scoped';

export const orgStatus = pgEnum('org_status', ['active', 'suspended', 'closed']);
export const mailboxProvider = pgEnum('mailbox_provider', ['google', 'microsoft']);

/**
 * The organisation. Slice 1.
 *
 * NOT row-level secured, deliberately. It is the anchor every policy compares
 * against, and securing it would make the tenant lookup circular. Slice 1 is
 * explicit: access is by primary key from an authenticated session only.
 *
 * That is why this table has no `organisation_id` column and therefore never
 * appears in the RLS enumeration test's scoped set - the test keys on the
 * column, not on a name list.
 */
export const organisation = pgTable('organisation', {
  id: uuid('id').primaryKey().defaultRandom(),

  /**
   * The Better Auth organisation. Slice 1 keeps the two apart so that the
   * table every RLS policy references is governed by this project's migrations
   * rather than a third-party library's, and so the auth library stays
   * replaceable. E1-1 owns the resolution.
   *
   * `text`, not `uuid`: Better Auth ids are library-generated strings.
   */
  authOrganizationId: text('auth_organization_id').notNull().unique(),

  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: orgStatus('status').notNull().default('active'),

  /**
   * W29, closed 2026-09-08. Slice 4 computes `mailbox_capacity_day.day` and
   * slice 6 computes `usage_counter.period_start` as "a date in the
   * organisation's timezone", and until this column existed both would
   * silently have been UTC - which in the first market shifts a capacity-day
   * boundary to 05:30 local and closes a billing period mid-morning.
   *
   * Validated against `pg_timezone_names` and normalised to canonical form by
   * the validator E1-1 owns. That is the SAME validator
   * `campaign_revision.timezone` calls in E6-1: one validator, two callers.
   * The database default is a backstop, not the validation.
   */
  timezone: text('timezone').notNull().default('Asia/Kolkata'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Slice 1: "Optional, and empty for every customer at launch. Exists from the
 * first migration so that ADR 0048's customer-owned Cloud project option is
 * reachable without a migration later."
 *
 * It is here in E0-2 for that reason and for one more: the RLS machinery needs
 * at least one organisation-scoped table to be provably working, and this is
 * the one slice 1 says ships first.
 */
export const organisationOauthClient = pgTable(
  'organisation_oauth_client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: organisationIdColumn(() => organisation.id),
    provider: mailboxProvider('provider').notNull(),
    clientId: text('client_id').notNull(),

    /**
     * ADR 0049 and the cross-cutting rule in `spec/00-overview.md`: encrypted
     * material is `bytea`, never `text`, so it cannot be logged as a string by
     * accident. Written and read only through `platform/crypto`.
     */
    clientSecretEnc: bytea('client_secret_enc').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('organisation_oauth_client_org_provider_key').on(table.organisationId, table.provider),
    // organisation_id leads every index. ADR 0043 makes this part of the
    // decision rather than an optimisation, because the policy predicate is an
    // indexed equality on this column.
    index('organisation_oauth_client_org_idx').on(table.organisationId, table.provider),
    tenantPolicy('organisation_oauth_client'),
  ],
).enableRLS();
