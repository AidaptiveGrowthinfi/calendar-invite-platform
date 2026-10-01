import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENFORCED_FORBIDDEN, NOT_MECHANICALLY_CHECKABLE, VOCABULARY } from '../src/vocabulary';

/**
 * CONTEXT.md is the authority and `vocabulary.ts` is a projection of it.
 * `scripts/gate-vocabulary.mjs` imports `ENFORCED_FORBIDDEN` rather than
 * keeping a copy, so there is one list, not two that drift.
 */
describe('vocabulary', () => {
  it('covers every term CONTEXT.md defines', () => {
    const context = readFileSync(join(process.cwd(), 'CONTEXT.md'), 'utf8');
    const definedTerms = [...context.matchAll(/^\*\*(.+?)\*\*:$/gmu)].map((m) => m[1] as string);

    expect(definedTerms.length).toBe(VOCABULARY.length);
  });

  it('the gate imports the list rather than restating it', () => {
    const gate = readFileSync(join(process.cwd(), 'scripts', 'gate-vocabulary.mjs'), 'utf8');
    expect(gate).toContain('ENFORCED_FORBIDDEN');
    // A literal array of words in the gate means a second list to keep in step.
    expect(gate).not.toMatch(/const FORBIDDEN = \[\s*'/u);
  });

  it('never enforces a word that is itself a defined term', () => {
    // "User - avoid Mailbox" means do not call a user a mailbox. Mailbox has
    // its own entry, and banning it outright would ban half of E4.
    const defined = VOCABULARY.map((t) => t.use.toLowerCase());
    for (const word of ENFORCED_FORBIDDEN) {
      expect(defined, `"${word}" is a defined term`).not.toContain(word.toLowerCase());
    }
  });

  it('excludes words that are ambiguous in general programming', () => {
    for (const word of NOT_MECHANICALLY_CHECKABLE) {
      expect(ENFORCED_FORBIDDEN).not.toContain(word);
    }
  });

  it('still enforces the unambiguous cold-email vocabulary ADR 0056 threw away', () => {
    // The words that made the v1 frontend describe a different product.
    for (const word of ['recipient', 'lead', 'blast', 'sendJob']) {
      expect(ENFORCED_FORBIDDEN).toContain(word);
    }
  });
});
