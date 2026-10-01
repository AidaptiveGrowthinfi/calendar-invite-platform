/**
 * CI gate 5, second half.
 *
 * `spec/05-invariants-and-tests.md`: "A migration that was not generated
 * (`drizzle-kit push` is banned; a schema diff with no migration is a
 * failure)."
 *
 * Runs a generate into a scratch directory and fails if it would have produced
 * anything. A schema change committed without its migration deploys an
 * application expecting columns the database does not have.
 *
 * The scratch directory is INSIDE packages/db and named relatively, because
 * drizzle-kit resolves `--out` against its own working directory: an absolute
 * path is appended to it and the run fails in a way that is easy to mistake
 * for a pass.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DB_PACKAGE = join(process.cwd(), 'packages', 'db');
const MIGRATIONS = join(DB_PACKAGE, 'migrations');
const SCRATCH_RELATIVE = '.gate-scratch';
const SCRATCH = join(DB_PACKAGE, SCRATCH_RELATIVE);

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

try {
  cpSync(MIGRATIONS, SCRATCH, { recursive: true });
  const before = new Set(readdirSync(SCRATCH).filter((f) => f.endsWith('.sql')));

  // `--out` on its own makes drizzle-kit stop reading the config file, so the
  // dialect and schema are repeated here. They must stay in step with
  // packages/db/drizzle.config.ts.
  const output = execFileSync(
    'pnpm',
    [
      'exec',
      'drizzle-kit',
      'generate',
      '--dialect',
      'postgresql',
      '--schema',
      './src/schema/index.ts',
      '--out',
      SCRATCH_RELATIVE,
      '--name',
      'gate_check',
    ],
    {
      cwd: DB_PACKAGE,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    },
  );

  const after = readdirSync(SCRATCH).filter((f) => f.endsWith('.sql'));
  const created = after.filter((f) => !before.has(f));

  if (created.length > 0) {
    process.stderr.write(
      'The Drizzle schema has changes with no generated migration:\n' +
        created.map((f) => `  would create ${f}`).join('\n') +
        '\n\nRun: pnpm db:generate\n' +
        'The banned push command is not an alternative (ADR 0042) - it does not\n' +
        'apply RLS policies.\n',
    );
    process.exit(1);
  }

  // A generate that produced nothing AND said nothing usually means it never
  // read the schema. Guard against the gate passing vacuously.
  if (!/No schema changes|\d+ tables/u.test(output)) {
    process.stderr.write(
      `drizzle-kit did not report on the schema, so this gate proved nothing:\n${output}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('gate: migrations are current - ok\n');
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
