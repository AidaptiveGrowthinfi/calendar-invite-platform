/**
 * ADR 0043's exemption list. EXHAUSTIVE.
 *
 * "Any addition to this list requires a new ADR."
 *
 * Two features have already needed a fourth entry and routed around it
 * instead - slice 5's shared trial domain, and slice 1's `api_key`, which puts
 * the organisation reference in the key itself so authentication can open
 * `withOrg()` before touching the database. `spec/00-overview.md` records that
 * routing around the list is the EXPECTED response to needing a fourth entry,
 * not a workaround.
 *
 * The enumeration test asserts this list has exactly three entries and that the
 * set of unpolicied tables in the live schema matches the tables named here. It
 * fails when someone adds a table without a policy, and it fails when someone
 * quietly extends this list. Both are the point.
 */

export interface RlsExemption {
  /** ADR 0043's numbering. */
  readonly id: 1 | 2 | 3;
  readonly component: string;
  readonly reason: string;
  /**
   * Tables this exemption covers, as they exist today. Empty where the
   * component is exempt but its tables do not exist yet - the exemption is
   * about which component may hold BYPASSRLS, and a table list that grows as
   * the schema does is how the enumeration test stays honest.
   */
  readonly tables: readonly string[];
}

export const RLS_EXEMPTIONS: readonly RlsExemption[] = Object.freeze([
  Object.freeze({
    id: 1,
    component: 'dispatcher',
    reason:
      'Selects which campaign runs next. Choosing between organisations is inherently cross-tenant.',
    tables: [],
  }),
  Object.freeze({
    id: 2,
    component: 'shared provider quota accounting',
    reason:
      'The Google Calendar API daily quota is per Cloud project and is drawn on by every organisation (W4b, ADR 0048).',
    tables: [],
  }),
  Object.freeze({
    id: 3,
    component: 'Better Auth',
    reason:
      "A user may belong to several organisations, so user, session, account, organization, member and invitation are cross-organisation by definition and are governed by Better Auth's own access rules.",
    tables: ['user', 'session', 'account', 'organization', 'member', 'invitation', 'verification'],
  }),
]);

/** Every table name covered by an exemption, flattened. */
export const EXEMPT_TABLES: readonly string[] = Object.freeze(
  RLS_EXEMPTIONS.flatMap((exemption) => exemption.tables).sort(),
);

/**
 * Tables that legitimately carry no `organisation_id` and are not exemptions:
 * they are not organisation-scoped at all.
 *
 * `organisation` is the anchor the policies compare against; slice 1 states
 * that securing it would make the tenant lookup circular. The migrations table
 * is Drizzle's own bookkeeping.
 */
export const NOT_ORGANISATION_SCOPED: readonly string[] = Object.freeze([
  'organisation',
  '__drizzle_migrations',
]);
