import { describe, expect, it } from 'vitest';
import {
  InvalidEmailAddressError,
  maskNormalisedAddress,
  normaliseEmailAddress,
} from '../src/email';

/**
 * ADR 0046's rules are frozen. These cases are therefore not ordinary unit
 * tests: they are the written record of what the frozen rules produce. A change
 * that makes one of them fail is not a test to update, it is a change that
 * orphans every existing suppression digest.
 */
describe('normaliseEmailAddress - ADR 0046 frozen rules', () => {
  it('lowercases the local part as well as the domain', () => {
    expect(normaliseEmailAddress('Jo.Smith@Example.COM')).toBe('jo.smith@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseEmailAddress('  jo@example.com \t\n')).toBe('jo@example.com');
  });

  it('strips zero-width characters at the edges, as a spreadsheet cell supplies them', () => {
    const zwsp = String.fromCodePoint(0x200b);
    const bom = String.fromCodePoint(0xfeff);
    expect(normaliseEmailAddress(`${bom}jo@example.com${zwsp}`)).toBe('jo@example.com');
  });

  it('applies NFC, so a decomposed local part matches its composed form', () => {
    const composed = 'josé@example.com';
    const decomposed = 'josé@example.com';
    expect(decomposed.normalize('NFD')).not.toBe(composed);
    expect(normaliseEmailAddress(decomposed)).toBe(normaliseEmailAddress(composed));
  });

  it('converts an internationalised domain to its A-label', () => {
    expect(normaliseEmailAddress('jo@bücher.de')).toBe('jo@xn--bcher-kva.de');
  });

  it('treats an A-label and its U-label as the same address', () => {
    expect(normaliseEmailAddress('jo@bücher.de')).toBe(
      normaliseEmailAddress('jo@XN--BCHER-KVA.DE'),
    );
  });

  it('splits on the last @, so a quoted local part survives', () => {
    expect(normaliseEmailAddress('"a@b"@example.com')).toBe('"a@b"@example.com');
  });

  describe('deliberately NOT applied - ADR 0046 refuses these', () => {
    it('does not collapse dots, because a Workspace custom domain looks like any other', () => {
      expect(normaliseEmailAddress('j.o.smith@gmail.com')).not.toBe(
        normaliseEmailAddress('josmith@gmail.com'),
      );
    });

    it('does not strip plus addressing', () => {
      expect(normaliseEmailAddress('jo+webinar@gmail.com')).toBe('jo+webinar@gmail.com');
    });
  });

  describe('rejects rather than guessing', () => {
    const bad = [
      ['empty', ''],
      ['whitespace only', '   '],
      ['no @', 'not-an-address'],
      ['no local part', '@example.com'],
      ['no domain', 'jo@'],
      ['domain without a dot', 'jo@localhost'],
      ['internal whitespace', 'jo smith@example.com'],
    ] as const;

    for (const [name, input] of bad) {
      it(name, () => {
        expect(() => normaliseEmailAddress(input)).toThrow(InvalidEmailAddressError);
      });
    }
  });

  it('is idempotent - normalising a normalised address changes nothing', () => {
    const inputs = ['Jo@Example.com', ' jo+x@bücher.de ', '"a@b"@EXAMPLE.COM'];
    for (const input of inputs) {
      const once = normaliseEmailAddress(input);
      expect(normaliseEmailAddress(once)).toBe(once);
    }
  });
});

describe('maskNormalisedAddress', () => {
  it('keeps two characters of the local part and the full domain', () => {
    expect(maskNormalisedAddress('josmith@gmail.com')).toBe('jo***@gmail.com');
  });

  it('does not pad a short local part up to two characters', () => {
    expect(maskNormalisedAddress('j@gmail.com')).toBe('j***@gmail.com');
  });
});
