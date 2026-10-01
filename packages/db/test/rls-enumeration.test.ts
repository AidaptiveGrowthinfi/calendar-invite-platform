/**
 * CI gate 2, and ADR 0052 requirement 7.
 *
 * `spec/05-invariants-and-tests.md`:
 *
 *   "Enumerate pg_class; assert every table carrying organisation_id has
 *    relrowsecurity and relforcerowsecurity; assert the set without them equals
 *    ADR 0043's exemption list exactly. Separately, query as app_user with no
 *    app.organisation_id and assert zero rows."
 *
 *   Prevents: a cross-organisation leak, and a new table shipping without a
 *   policy.
 *
 * It is written as an ENUMERATION rather than a list of tables. That is the
 * whole design: a list has to be updated by the person adding the table, which
 * is the person who just forgot.
 */
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { EXEMPT_TABLES, NOT_ORGANISATION_SCOPED, RLS_EXEMPTIONS } from '../src/rls-exemptions';
import { databaseAvailable, migratorConnection, skipReason } from './support/database';

/**
 * The declaration half of the gate. Runs with or without a database, because
 * "the exemption list still has exactly three entries" is a fact about the
 * repository, not about a deployment.
 */
describe('ADR 0043 exemption list', () => {
  it('has exactly three entries', () => {
    // "Exemptions, exhaustive. Any addition to this list requires a new ADR."
    // Two features have already needed a fourth and routed around it instead:
    // slice 5's shared trial domain, and slice 1's api_key prefix.
    expect(RLS_EXEMPTIONS).toHaveLength(3);
  });

  it('names the three components ADR 0043 names', () => {
    expect(RLS_EXEMPTIONS.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(RLS_EXEMPTIONS[0]?.component).toContain('dispatcher');
    expect(RLS_EXEMPTIONS[1]?.component).toContain('quota');
    expect(RLS_EXEMPTIONS[2]?.component).toContain('Better Auth');
  });

  it('gives every exemption a stated reason', () => {
    for (const exemption of RLS_EXEMPTIONS) {
      expect(exemption.reason.length).toBeGreaterThan(20);
    }
  });
});

const describeWithDb = databaseAvailable() ? describe : describe.skip;

if (!databaseAvailable()) {
  // eslint-disable-next-line no-console
  console.warn(`[skipped] RLS enumeration against a live schema: ${skipReason}`);
}

describeWithDb('RLS enumeration against the live schema', () => {
  let sql: postgres.Sql;

  const connection = (): postgres.Sql => {
    sql ??= migratorConnection();
    return sql;
  };

  afterAll(async () => {
    await sql?.end();
  });

  interface TableRow {
    readonly table_name: string;
    readonly has_organisation_id: boolean;
    readonly rls_enabled: boolean;
    readonly rls_forced: boolean;
    readonly policy_count: number;
  }

  const enumerate = async (): Promise<readonly TableRow[]> =>
    connection()<TableRow[]>`
      select
        c.relname as table_name,
        exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'organisation_id'
            and a.attnum > 0 and not a.attisdropped
        ) as has_organisation_id,
        c.relrowsecurity  as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `;

  it('every organisation-scoped table has RLS enabled AND forced', async () => {
    const scoped = (await enumerate()).filter((t) => t.has_organisation_id);
    expect(scoped.length).toBeGreaterThan(0);

    const notEnabled = scoped.filter((t) => !t.rls_enabled).map((t) => t.table_name);
    const notForced = scoped.filter((t) => !t.rls_forced).map((t) => t.table_name);

    expect(notEnabled, 'tables with organisation_id but RLS not enabled').toEqual([]);
    // FORCE is the half `.enableRLS()` does not emit. Without it the table
    // owner bypasses its own policy (ADR 0043), and the migrator owns
    // every table.
    expect(notForced, 'tables with RLS enabled but not FORCED').toEqual([]);
  });

  it('every organisation-scoped table carries at least one policy', async () => {
    const scoped = (await enumerate()).filter((t) => t.has_organisation_id);
    const unpolicied = scoped.filter((t) => t.policy_count === 0).map((t) => t.table_name);

    // Under Drizzle an unpolicied table is already default-deny, so this is a
    // second line of defence rather than the only one (ADR 0042). It is what
    // keeps the exemption list honest.
    expect(unpolicied, 'organisation-scoped tables with no policy').toEqual([]);
  });

  it('the set of tables without RLS equals the exemption list exactly', async () => {
    const all = await enumerate();

    const withoutRls = all
      .filter((t) => !t.rls_forced)
      .map((t) => t.table_name)
      .filter((name) => !NOT_ORGANISATION_SCOPED.includes(name))
      .sort();

    // Better Auth's tables are exempt under ADR 0043 entry 3 and do not exist
    // until E1-1, so the expected set is the intersection of the declared
    // exemptions with what has actually been created.
    const expected = EXEMPT_TABLES.filter((name) => all.some((t) => t.table_name === name)).sort();

    expect(withoutRls).toEqual(expected);
  });

  it('every policy has a WITH CHECK clause, not only USING', async () => {
    // ADR 0043 names both. `using` decides which rows are visible; `with check`
    // decides what a row is allowed to become. With only `using`, a write can
    // set organisation_id to another organisation's value.
    const policies = await connection()<Array<{ table_name: string; policy: string }>>`
      select c.relname as table_name, p.polname as policy
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polwithcheck is null
    `;

    expect(policies.map((p) => `${p.table_name}.${p.policy}`)).toEqual([]);
  });

  it('every index on an organisation-scoped table leads with organisation_id', async () => {
    // ADR 0043 makes this part of the decision rather than an optimisation:
    // the policy predicate is an indexed equality on this column, and it is
    // paid on every read and write.
    const offenders = await connection()<Array<{ table_name: string; index_name: string }>>`
      select c.relname as table_name, i.relname as index_name
      from pg_index x
      join pg_class c on c.oid = x.indrelid
      join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'organisation_id'
            and a.attnum > 0 and not a.attisdropped
        )
        and not x.indisprimary
        and (
          select a.attname from pg_attribute a
          where a.attrelid = c.oid and a.attnum = x.indkey[0]
        ) is distinct from 'organisation_id'
    `;

    expect(offenders.map((o) => `${o.table_name}.${o.index_name}`)).toEqual([]);
  });
});
