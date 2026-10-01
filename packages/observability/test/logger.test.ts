import { describe, expect, it } from 'vitest';
import { createLogger, type LogFields } from '../src/logger';

const capture = () => {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: 'debug',
    service: 'api',
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date('2026-09-09T00:00:00.000Z'),
  });
  return { logger, lines };
};

describe('structured logging - ADR 0035', () => {
  it('carries the identifiers on every line', () => {
    const { logger, lines } = capture();
    logger.child({ requestId: 'req-1', campaignId: 'camp-1' }).info('planned');

    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'api',
      message: 'planned',
      requestId: 'req-1',
      campaignId: 'camp-1',
    });
  });

  it('request_id is present, because it is the seam to audit_trace', () => {
    // spec/01-modules.md: the only thing shared between a log line and an
    // audit record. A line without it cannot be joined to the evidence.
    const { logger, lines } = capture();
    logger.child({ requestId: 'req-7' }).error('failed');
    expect(lines[0]?.requestId).toBe('req-7');
  });

  it('honours the level threshold', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', service: 'worker', write: (l) => lines.push(l) });
    logger.info('quiet');
    logger.warn('loud');
    expect(lines).toHaveLength(1);
  });

  describe('redaction', () => {
    it('never writes token material - ADR 0033', () => {
      const { logger, lines } = capture();
      logger.info('connected', {
        mailboxId: 'mb-1',
        refreshToken: 'ya29.super-secret',
        nested: { accessToken: 'also-secret' },
      } as LogFields);

      const rendered = JSON.stringify(lines[0]);
      expect(rendered).not.toContain('ya29.super-secret');
      expect(rendered).not.toContain('also-secret');
      expect(rendered).toContain('mb-1');
    });

    it('never writes the suppression pepper', () => {
      const { logger, lines } = capture();
      logger.info('boot', { suppressionPepper: 'PEPPER' } as LogFields);
      expect(JSON.stringify(lines[0])).not.toContain('PEPPER');
    });

    it('summarises a Buffer rather than rendering it', () => {
      const { logger, lines } = capture();
      logger.info('read', { payload: Buffer.alloc(48) } as LogFields);
      expect(lines[0]?.payload).toBe('[buffer 48b]');
    });

    it('keeps an error readable', () => {
      const { logger, lines } = capture();
      logger.error('boom', { cause: new Error('provider timed out') } as LogFields);
      expect(lines[0]?.cause).toMatchObject({ message: 'provider timed out' });
    });
  });
});
