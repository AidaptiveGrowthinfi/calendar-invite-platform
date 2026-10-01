/**
 * The environment contract. ADR 0049.
 *
 * Every value the platform needs is declared here once. Nothing else in the
 * codebase reads `process.env` - `scripts/gate-no-raw-env.mjs` fails CI on a
 * second reader, because a config value read directly at a call site is a value
 * that is not validated at boot and fails at 2am instead.
 *
 * Secrets arrive already decrypted. SOPS and age decrypt at DEPLOY time
 * (ADR 0049), which is what keeps a hosted dependency and a network call off
 * the boot path. What this module guarantees is the other half of E0-3: a
 * missing or malformed secret stops the process at boot rather than at first
 * use.
 */
import { z } from 'zod';
import {
  SIGNING_KEY_BYTES,
  SUPPRESSION_PEPPER_BYTES,
  TOKEN_ENCRYPTION_KEY_BYTES,
} from '@platform/crypto';

/**
 * Key material is carried as base64. A wrong-length key is a boot failure, and
 * the message says which key and what length, because the alternative is
 * reading a stack trace from `createCipheriv` at 2am.
 */
const base64Key = (bytes: number, name: string): z.ZodType<Buffer, z.ZodTypeDef, string> =>
  z
    .string()
    .min(1, `${name} is required`)
    .transform((value, ctx) => {
      const buffer = Buffer.from(value, 'base64');
      if (buffer.length !== bytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must decode to exactly ${bytes} bytes, got ${buffer.length}. Generate one with: openssl rand -base64 ${bytes}`,
        });
        return z.NEVER;
      }
      return buffer;
    });

export const NODE_ENVS = ['development', 'test', 'production'] as const;

export const environmentSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),

  // --- Runtime -------------------------------------------------------------
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_PUBLIC_URL: z.string().url(),

  // --- PostgreSQL ----------------------------------------------------------
  // Three URLs, not one, because ADR 0043 gives the API, the worker and the
  // migrator three different roles. One shared superuser URL would make the
  // whole RLS model decorative.
  DATABASE_URL_APP: z.string().url(), // connects as app_user, subject to RLS
  DATABASE_URL_WORKER: z.string().url(), // connects as app_worker, BYPASSRLS
  DATABASE_URL_MIGRATOR: z.string().url(), // owns the schema

  // --- Redis ---------------------------------------------------------------
  REDIS_URL: z.string().url(),

  // --- Secrets (decrypted by SOPS at deploy time) --------------------------
  SUPPRESSION_PEPPER: base64Key(SUPPRESSION_PEPPER_BYTES, 'SUPPRESSION_PEPPER'),
  TOKEN_ENCRYPTION_KEY: base64Key(TOKEN_ENCRYPTION_KEY_BYTES, 'TOKEN_ENCRYPTION_KEY'),
  SIGNING_KEY_ID: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9-]+$/u, 'must not contain a dot'),
  SIGNING_KEY_SECRET: base64Key(SIGNING_KEY_BYTES, 'SIGNING_KEY_SECRET'),

  // --- Observability (ADR 0035) --------------------------------------------
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Environment = z.infer<typeof environmentSchema>;
