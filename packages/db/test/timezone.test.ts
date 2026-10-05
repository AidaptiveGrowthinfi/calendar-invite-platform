import { describe, expect, it } from 'vitest';
import { canonicalTimezone, InvalidTimezoneError } from '../src/timezone';

const known = new Set(['Asia/Kolkata', 'Asia/Calcutta', 'America/New_York', 'US/Eastern', 'UTC']);

describe('canonicalTimezone', () => {
  it('normalises Asia/Calcutta to Asia/Kolkata', () => {
    expect(canonicalTimezone('Asia/Calcutta', known)).toBe('Asia/Kolkata');
  });
  it('leaves canonical names alone', () => {
    expect(canonicalTimezone('Asia/Kolkata', known)).toBe('Asia/Kolkata');
  });
  it('fixes case and whitespace', () => {
    expect(canonicalTimezone('  asia/kolkata ', known)).toBe('Asia/Kolkata');
  });
  it('maps US/Eastern to America/New_York', () => {
    expect(canonicalTimezone('US/Eastern', known)).toBe('America/New_York');
  });
  it('rejects unknown zones', () => {
    expect(() => canonicalTimezone('Nope/Zone', known)).toThrow(InvalidTimezoneError);
  });
});
