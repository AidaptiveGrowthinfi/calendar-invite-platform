/**
 * The vocabulary gate.
 *
 * `spec/00-overview.md` makes CONTEXT.md binding on identifiers, API paths, UI
 * copy and error messages, and gives the reason: v1's cold-email vocabulary is
 * what the frontend inherited, and ADR 0056 threw that away. "Reply rate",
 * "Sequence" and `{{first_name}}` templating described a cold-email sequencer;
 * this product sends calendar invitations and measures attendance.
 *
 * Not one of the six correctness gates. It fails the build anyway, because the
 * cost of catching it here is a rename and the cost of catching it in six
 * months is every screen.
 *
 * Only the mechanically checkable subset is enforced -
 * `NOT_MECHANICALLY_CHECKABLE` in `packages/shared/src/vocabulary.ts` lists the
 * words too common in general programming to flag, and says why. A gate that
 * cries wolf gets disabled.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { codeLines } from './lib/source-lines.mjs';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', '.git', 'dist', 'coverage', '.pnpm-store', 'docs', 'tmp']);

const require = createRequire(import.meta.url);

/**
 * THE single source. `packages/shared/src/vocabulary.ts` derives this from
 * CONTEXT.md's entries; the gate does not keep its own copy, because two lists
 * drift and the drift is invisible until the wrong word ships.
 */
let FORBIDDEN;
try {
  ({ ENFORCED_FORBIDDEN: FORBIDDEN } = require('../packages/shared/dist/vocabulary.js'));
} catch {
  process.stderr.write('gate: vocabulary - @platform/shared is not built. Run: pnpm build\n');
  process.exit(1);
}

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|jsx?)$/u.test(entry)) continue;

    const rel = relative(ROOT, full).replaceAll('\\', '/');
    // The vocabulary module and the test that guards it name the forbidden
    // words in order to forbid them.
    const NAMES_THEM_TO_FORBID_THEM = [
      'packages/shared/src/vocabulary.ts',
      'packages/shared/test/vocabulary.test.ts',
    ];
    if (NAMES_THEM_TO_FORBID_THEM.includes(rel)) continue;

    codeLines(readFileSync(full, 'utf8')).forEach((line, index) => {
      for (const word of FORBIDDEN) {
        const pattern = new RegExp(`\\b${word}\\b`, 'iu');
        if (pattern.test(line)) {
          offenders.push(`${rel}:${index + 1}: "${word}" - ${line.trim()}`);
        }
      }
    });
  }
}

walk(ROOT);

if (offenders.length > 0) {
  process.stderr.write('CONTEXT.md forbids these terms:\n\n');
  for (const offender of offenders) process.stderr.write(`  ${offender}\n`);
  process.stderr.write('\nSee CONTEXT.md for the term to use instead.\n');
  process.exit(1);
}

process.stdout.write('gate: vocabulary - ok\n');
