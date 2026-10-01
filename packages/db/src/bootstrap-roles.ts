/**
 * Creates the three roles. ADR 0043.
 *
 * Run ONCE per environment, as a superuser, before the first migration.
 *
 * This is a script and not a migration, for one reason: roles have passwords,
 * and a migration is committed to the repository. "Never commit credentials"
 * is a cross-cutting rule in `spec/00-overview.md`, and it is the rule W23
 * shows this project already learned the hard way. Passwords come from the
 * environment, which SOPS decrypts at deploy time (ADR 0049).
 *
 * Idempotent: safe to run against an environment that already has the roles.
 * It does not rotate a password that is already set - changing a credential is
 * a deliberate act, not a side effect of running a bootstrap script twice.
 *
 *   pnpm --filter @platform/db exec tsx src/bootstrap-roles.ts
 */
import postgres from 'postgres';

interface RoleSpec {
  readonly name: string;
  readonly bypassRls: boolean;
  readonly note: string;
}

const ROLES: readonly RoleSpec[] = [
  {
    name: 'app_user',
    bypassRls: false,
    note: 'Runs the API. Subject to RLS. Holds no bypass.',
  },
  {
    name: 'app_worker',
    bypassRls: true,
    // BYPASSRLS is the whole point of this role and the reason ADR 0043's
    // exemption list is exhaustive. A worker role created without it makes
    // the dispatcher return zero rows and look like a scheduling bug.
    note: 'Runs the worker. BYPASSRLS, for ADR 0043 exemptions 1-3 only.',
  },
  {
    name: 'migrator',
    bypassRls: false,
    note: 'Owns the schema. Never used by a running application process.',
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required to bootstrap roles. Secrets are decrypted at deploy time by SOPS (ADR 0049).`,
    );
  }
  return value;
}

export async function bootstrapRoles(adminUrl: string): Promise<void> {
  const passwords: Record<string, string> = {
    app_user: requireEnv('APP_USER_PASSWORD'),
    app_worker: requireEnv('APP_WORKER_PASSWORD'),
    migrator: requireEnv('MIGRATOR_PASSWORD'),
  };

  const sql = postgres(adminUrl, { max: 1, prepare: false });

  try {
    for (const role of ROLES) {
      const existing = await sql<Array<{ rolname: string }>>`
        select rolname from pg_roles where rolname = ${role.name}
      `;

      if (existing.length === 0) {
        const password = passwords[role.name] as string;
        // The password is a literal, not an identifier, and postgres.js has no
        // parameter binding in CREATE ROLE. It is escaped by doubling quotes.
        const escaped = password.replace(/'/gu, "''");
        const bypass = role.bypassRls ? 'bypassrls' : 'nobypassrls';
        await sql.unsafe(`create role "${role.name}" with login ${bypass} password '${escaped}'`);
        process.stdout.write(`created role ${role.name} (${role.note})\n`);
      } else {
        // Attributes are corrected even on an existing role: a role created by
        // hand without BYPASSRLS is exactly the failure this guards against.
        const bypass = role.bypassRls ? 'bypassrls' : 'nobypassrls';
        await sql.unsafe(`alter role "${role.name}" with login ${bypass}`);
        process.stdout.write(`role ${role.name} already exists, attributes confirmed\n`);
      }
    }

    // The migrator owns the schema, and drizzle's runner records applied
    // migrations in a `drizzle` schema it creates on first run. PostgreSQL 15+
    // gives an ordinary role neither CREATE on the database nor ownership of
    // `public`, so without these the first `db:migrate` fails on permissions.
    // Both are idempotent.
    const [database] = await sql<Array<{ name: string }>>`select current_database() as name`;
    const databaseName = (database as { name: string }).name.replace(/"/gu, '""');
    await sql.unsafe(`grant create on database "${databaseName}" to migrator`);
    await sql.unsafe('alter schema public owner to migrator');
    process.stdout.write(`migrator owns schema public and may create schemas in ${databaseName}\n`);

    process.stdout.write('roles bootstrapped\n');
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  bootstrapRoles(requireEnv('DATABASE_URL_ADMIN')).catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
}
