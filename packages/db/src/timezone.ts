// One validator, two callers: organisation.timezone (E1-1) and
// campaign_revision.timezone (E6-1). ADR 0044, W29.

const ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
};

export class InvalidTimezoneError extends Error {
  constructor(input: string) {
    super(`Not a recognised IANA timezone: ${JSON.stringify(input)}`);
    this.name = 'InvalidTimezoneError';
  }
}

/**
 * `known` is the set of names from `select name from pg_timezone_names`.
 * Returns the canonical identifier or throws InvalidTimezoneError.
 */
export function canonicalTimezone(input: string, known: ReadonlySet<string>): string {
  const wanted = input.trim().toLowerCase();
  let match: string | undefined;
  for (const name of known) {
    if (name.toLowerCase() === wanted) {
      match = name;
      break;
    }
  }
  if (!match) throw new InvalidTimezoneError(input);
  const canonical = ALIASES[match];
  return canonical && known.has(canonical) ? canonical : match;
}
