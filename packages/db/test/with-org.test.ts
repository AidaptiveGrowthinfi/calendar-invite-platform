/**
 * The chokepoint. ADR 0043, and the second half of ADR 0052 requirement 7.
 *
 * "Separately, query as app_user with no app.organisation_id and assert zero
 *  rows."
 *
 * The failure mode being designed for is stated in ADR 0043 and is worth
 * repeating: forgetting tenant context must produce an EMPTY RESULT, which is
 * loud, rather than another organisation's data, which is silent.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOrganisationId } from '@platform/shared';
import { TenantContextError, withOrg } from '../src/with-org';
import { createAppDatabase, type AppDatabaseHandle } from '../src/client';
import {
  appConnection,
  databaseAvailable,
  migratorConnection,
  skipReason,
  TEST_APP_URL,
} from './support/database';

describe('withOrg input validation', () => {
  it('rejects an organisation id that is not a uuid before opening a transaction', async () => {
    // Runs without a database on purpose: the guard must fire before anything
    // is dialled, so a bad id is a clear error rather than a cast failure
    // buried inside a policy predicate.
    const handle = { kind: 'app_user' } as unknown as AppDatabaseHandle;
    await expect(withOrg(handle, 'not-a-uuid' as never, async () => 'unreachable')).rejects.toThrow(
      TenantContextError,
    );
  });
});

const canRun = databaseAvailable() && TEST_APP_URL !== undefined;
const describeWithDb = canRun ? describe : describe.skip;

if (!canRun) {
  process.stderr.write(`[skipped] withOrg against a live database: ${skipReason}\n`);
}

describeWithDb('withOrg against a live database', () => {
  let admin: postgres.Sql;
  let asAppUser: postgres.Sql;
  let handle: AppDatabaseHandle;

  const orgA = asOrganisationId(randomUUID());
  const orgB = asOrganisationId(randomUUID());

  beforeAll(async () => {
    admin = migratorConnection();
    asAppUser = appConnection();
    handle = createAppDatabase({ url: TEST_APP_URL as string });

    for (const id of [orgA, orgB]) {
      const slug = `test-${id.slice(0, 8)}`;
      await admin`
        insert into organisation (id, auth_organization_id, name, slug, updated_at)
        values (${id}, ${`auth-${id}`}, ${slug}, ${slug}, now())
      `;
      await admin`
        insert into organisation_oauth_client
          (organisation_id, provider, client_id, client_secret_enc)
        values (${id}, 'google', ${`client-${id}`}, ${Buffer.from('secret')})
      `;
    }
  });

  afterAll(async () => {
    if (admin !== undefined) {
      await admin`delete from organisation_oauth_client where organisation_id in ${admin([orgA, orgB])}`;
      await admin`delete from organisation where id in ${admin([orgA, orgB])}`;
    }
    await handle?.close();
    await asAppUser?.end();
    await admin?.end();
  });

  it('a query as app_user with no tenant context returns zero rows', async () => {
    const rows = await asAppUser`select * from organisation_oauth_client`;
    expect(rows).toHaveLength(0);
  });

  it('inside withOrg, only that organisation is visible', async () => {
    const seen = await withOrg(handle, orgA, async (tx) => {
      const result = await tx.execute<{ organisation_id: string }>(
        sql`select organisation_id from organisation_oauth_client`,
      );
      return (result as unknown as Array<{ organisation_id: string }>).map(
        (row) => row.organisation_id,
      );
    });

    expect(new Set(seen)).toEqual(new Set([orgA]));
  });

  it('the tenant setting does not leak to the next transaction', async () => {
    // SET LOCAL is transaction-scoped, which is what makes withOrg safe under
    // transaction-mode pooling. If this ever fails, the pooler is handing back
    // a connection carrying another tenant's context.
    await withOrg(handle, orgA, async () => undefined);
    const rows = await asAppUser`select * from organisation_oauth_client`;
    expect(rows).toHaveLength(0);
  });

  it('a write cannot place a row in another organisation', async () => {
    // This is what `with check` buys over `using` alone: `using` governs which
    // rows are visible, `with check` governs what a row is allowed to become.
    await expect(
      withOrg(handle, orgA, async (tx) =>
        tx.execute(sql`
          insert into organisation_oauth_client
            (organisation_id, provider, client_id, client_secret_enc)
          values (${orgB}, 'microsoft', 'forged', ${Buffer.from('x')})
        `),
      ),
    ).rejects.toThrow();
  });

  it('a write inside the right organisation succeeds', async () => {
    await withOrg(handle, orgA, async (tx) =>
      tx.execute(sql`
        insert into organisation_oauth_client
          (organisation_id, provider, client_id, client_secret_enc)
        values (${orgA}, 'microsoft', 'legitimate', ${Buffer.from('x')})
      `),
    );

    const count = await withOrg(handle, orgA, async (tx) => {
      const result = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from organisation_oauth_client`,
      );
      return (result as unknown as Array<{ n: string }>)[0]?.n;
    });

    expect(count).toBe('2');
  });
});
