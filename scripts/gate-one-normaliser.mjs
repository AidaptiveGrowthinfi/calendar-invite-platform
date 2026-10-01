/**
 * The gate for the invariant `spec/05-invariants-and-tests.md` marks
 * "Unrepairable afterwards".
 *
 *   "Contact identity and the suppression digest come from ONE normaliser.
 *    Assert one exported function; property test that both call sites agree
 *    over adversarial addresses."
 *
 *   Prevents: a re-imported contact silently stopping matching their own
 *   suppression entry.
 *
 * The property test lives in `packages/crypto/test/suppression.test.ts` and
 * proves the two agree. This gate proves there is only one to agree with: it
 * fails when a second normaliser appears anywhere in the workspace, which is
 * how the drift starts.
 *
 * ADR 0046's rules are frozen from the first written row, so this is not a
 * problem that can be fixed later by picking a winner.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeLines } from './lib/source-lines.mjs';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', '.git', 'dist', 'coverage', '.pnpm-store', 'docs', 'tmp']);

/** The one legitimate home. ADR 0046, `spec/01-modules.md`. */
const CANONICAL = 'packages/crypto/src/email.ts';

/**
 * Shapes that mean "somebody is normalising an email address here". Deliberately
 * broad: a false positive costs a conversation, a false negative costs every
 * suppression record.
 */
const SUSPECT_PATTERNS = [
  /function\s+\w*[Nn]ormalis[ez]e?Email/u,
  /const\s+\w*[Nn]ormalis[ez]e?Email/u,
  /\w+\.toLowerCase\(\)\s*\.trim\(\)\s*(?:\/\/.*)?$/u,
  /domainToASCII/u,
  /punycode/iu,
];

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;

    const rel = relative(ROOT, full).replaceAll('\\', '/');
    if (rel === CANONICAL) continue;
    // Tests may reference the normaliser; they may not define one. A test that
    // defines its own would be asserting agreement with itself.
    const isTest = rel.includes('/test/') || rel.endsWith('.test.ts');

    const contents = readFileSync(full, 'utf8');
    codeLines(contents).forEach((line, index) => {
      for (const pattern of SUSPECT_PATTERNS) {
        if (!pattern.test(line)) continue;
        if (isTest && /import|from '/u.test(line)) continue;
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        return;
      }
    });
  }
}

walk(ROOT);

if (offenders.length > 0) {
  process.stderr.write(
    `A second email normaliser appears to exist. Only ${CANONICAL} may normalise an address.\n\n`,
  );
  for (const offender of offenders) process.stderr.write(`  ${offender}\n`);
  process.stderr.write(
    '\nADR 0046 freezes the normalisation rules from the first written row. If two\n' +
      'normalisers drift, a re-imported contact silently stops matching their own\n' +
      'suppression entry, the platform resumes sending to someone who unsubscribed,\n' +
      'and it cannot be repaired afterwards - the digests cannot be recomputed from\n' +
      'addresses the platform deliberately does not keep.\n\n' +
      "Import { normaliseEmailAddress } from '@platform/crypto' instead.\n",
  );
  process.exit(1);
}

process.stdout.write('gate: one email normaliser - ok\n');
