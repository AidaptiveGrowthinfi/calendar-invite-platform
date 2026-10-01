/**
 * Structured logging. ADR 0035.
 *
 * `spec/01-modules.md` requires request, campaign and job identifiers on every
 * log line, and names the seam that matters:
 *
 *   "`request_id` is the seam to `audit_trace.request_id` (slice 8) and is the
 *    only thing shared between a log line and an audit record."
 *
 * That is why `requestId` is a first-class field rather than something a caller
 * remembers to include. When someone asks "what happened during this request",
 * the answer comes from joining logs to `audit_trace` on this value, and a log
 * line without it cannot participate.
 *
 * JSON to stdout. Docker Compose on the VPS (ADR 0006) collects stdout, and a
 * structured line is greppable by identifier rather than by substring.
 */
import type { RequestId } from '@platform/shared';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

/**
 * The identifiers ADR 0035 requires on every line. All optional individually -
 * a boot-time line has no request - but the shape is fixed so that a query for
 * one campaign's activity is the same query everywhere.
 */
export interface LogContext {
  readonly requestId?: RequestId | string;
  readonly organisationId?: string;
  readonly campaignId?: string;
  readonly jobId?: string;
  readonly queue?: string;
}

export interface LogFields extends LogContext {
  readonly [key: string]: unknown;
}

/**
 * Keys whose values are never logged, whatever a caller passes.
 *
 * ADR 0033 says "never log token material"; ADR 0046's pepper and slice 5's
 * signing key are worse, because they are unrotatable or revoke every
 * outstanding token when rotated. Encrypted columns are `bytea` precisely so
 * they cannot be stringified by accident, but a plaintext token in flight is
 * still a string, and this is the last place to catch it.
 */
const REDACTED_KEYS = [
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'pepper',
  'apikey',
  'authorization',
  'cookie',
  'clientsecret',
  'presentedkey',
];

const REDACTED = '[redacted]';

function redact(value: unknown, key = ''): unknown {
  if (REDACTED_KEYS.some((needle) => key.toLowerCase().includes(needle))) {
    return REDACTED;
  }
  if (Buffer.isBuffer(value)) {
    // A Buffer in a log line is either key material or a payload. Neither is
    // useful rendered as bytes.
    return `[buffer ${String(value.length)}b]`;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]),
    );
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that carries `context` on every line it writes. */
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly service: 'api' | 'worker';
  /** Injectable for tests. Defaults to stdout. */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions, context: LogContext = {}): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const threshold = SEVERITY[options.level];

  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (SEVERITY[level] < threshold) {
      return;
    }
    write(
      JSON.stringify({
        time: now().toISOString(),
        level,
        service: options.service,
        message,
        ...(redact({ ...context, ...fields }) as Record<string, unknown>),
      }),
    );
  };

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    child: (extra) => createLogger(options, { ...context, ...extra }),
  };
}
