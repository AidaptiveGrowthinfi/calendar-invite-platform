/**
 * CI gate 5, first half: `drizzle-kit push` must not exist anywhere.
 *
 * ADR 0042: "RLS policies are known to apply under `drizzle-kit migrate` but
 * not under `drizzle-kit push`. Therefore `push` is banned in this project,
 * including in development; all schema change goes through generated
 * migrations."
 *
 * `spec/05-invariants-and-tests.md` extends it to test environments and gives
 * the reason that makes this a correctness gate rather than a style one: a test
 * database built by `push` has no RLS policies, so every isolation test would
 * pass against a schema that is not the one that ships.
 *
 * E0-2's acceptance criterion is literally "`drizzle-kit push` does not exist
 * as a script anywhere, including in dev".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeLines, isDataFile } from './lib/source-lines.mjs';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', '.git', 'dist', 'coverage', '.pnpm-store']);
const CHECKED_EXTENSIONS = ['.json', '.ts', '.js', '.mjs', '.cjs', '.yml', '.yaml', '.sh', '.md'];

/** This file names the banned string in order to ban it. */
const SELF = relative(ROOT, new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));

const OFFENDING = /drizzle-kit\s+push|drizzle-kit["']?\s*:\s*["']?push/u;

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!CHECKED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;

    const rel = relative(ROOT, full).replaceAll('\\', '/');
    if (rel === SELF.replaceAll('\\', '/')) continue;
    // The ADRs and the spec discuss the ban; they are not violations of it.
    if (rel.startsWith('docs/')) continue;
    // Nor are the gates themselves, whose error messages have to name it.
    if (/^scripts\/gate-.*\.mjs$/u.test(rel)) continue;

    const contents = readFileSync(full, 'utf8');
    // YAML, shell and Markdown have no JS comment syntax, so `codeLines` cannot
    // help. Strip `#` comments instead, so the CI workflow's own explanation of
    // the ban is not mistaken for a violation of it.
    const hashCommented = /\.(ya?ml|sh)$/u.test(rel);
    const lines = isDataFile(rel)
      ? contents.split('\n').map((line) => (hashCommented ? (line.split('#')[0] ?? '') : line))
      : codeLines(contents);
    lines.forEach((line, index) => {
      if (OFFENDING.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

walk(ROOT);

if (offenders.length > 0) {
  process.stderr.write('drizzle-kit push is banned (ADR 0042). Found:\n');
  for (const offender of offenders) process.stderr.write(`  ${offender}\n`);
  process.stderr.write(
    '\npush does not apply RLS policies. A database built by it has none, and every\n' +
      'isolation test then passes against a schema that is not the one that ships.\n' +
      'Use: pnpm db:generate && pnpm db:migrate\n',
  );
  process.exit(1);
}

process.stdout.write('gate: no drizzle-kit push - ok\n');
