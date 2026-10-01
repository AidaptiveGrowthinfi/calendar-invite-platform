/**
 * platform/config. ADR 0049.
 *
 * `spec/01-modules.md`: "Fails at boot on a missing secret rather than at first
 * use." That is the whole contract of this module, and `loadConfig` is the only
 * way to get a `Config`.
 */
import { validateKeyMaterial, type KeyMaterial } from '@platform/crypto';
import { environmentSchema, type Environment } from './schema';

export { environmentSchema, NODE_ENVS, type Environment } from './schema';

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export interface Config {
  readonly nodeEnv: Environment['NODE_ENV'];
  readonly isProduction: boolean;

  readonly api: {
    readonly port: number;
    readonly publicUrl: string;
  };

  /**
   * Three connection strings, one per role (ADR 0043). `packages/db` picks the
   * one matching the process it is running in; nothing else may read them.
   */
  readonly database: {
    readonly appUrl: string;
    readonly workerUrl: string;
    readonly migratorUrl: string;
  };

  readonly redis: { readonly url: string };

  /** Validated key material for `platform/crypto`. */
  readonly keys: KeyMaterial;

  readonly observability: {
    readonly sentryDsn: string | undefined;
    readonly logLevel: Environment['LOG_LEVEL'];
  };
}

/**
 * Reads and validates the environment. Call once, at boot, before anything
 * else. Throws `ConfigurationError` listing every problem at once rather than
 * the first one, because fixing a deployment one variable per restart is how a
 * ten-minute outage becomes an hour.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(
      `configuration is invalid, refusing to start:\n${problems}\n\n` +
        'Secrets are decrypted at deploy time by SOPS (ADR 0049). ' +
        'For local development: pnpm secrets:decrypt',
    );
  }

  const env = parsed.data;

  const keys = validateKeyMaterial({
    suppressionPepper: env.SUPPRESSION_PEPPER,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    activeSigningKey: { id: env.SIGNING_KEY_ID, secret: env.SIGNING_KEY_SECRET },
    // OPEN-S5: no rotation policy exists, so nothing is retired yet.
    retiredSigningKeys: [],
  });

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    api: Object.freeze({ port: env.API_PORT, publicUrl: env.API_PUBLIC_URL }),
    database: Object.freeze({
      appUrl: env.DATABASE_URL_APP,
      workerUrl: env.DATABASE_URL_WORKER,
      migratorUrl: env.DATABASE_URL_MIGRATOR,
    }),
    redis: Object.freeze({ url: env.REDIS_URL }),
    keys,
    observability: Object.freeze({
      sentryDsn: env.SENTRY_DSN,
      logLevel: env.LOG_LEVEL,
    }),
  });
}

/**
 * Redacts a config for logging. `platform/observability` calls this on boot so
 * that "what is this process actually configured with" is answerable from the
 * logs without the answer containing the keys.
 */
export function describeConfig(config: Config): Record<string, unknown> {
  const host = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return '(unparseable)';
    }
  };

  return {
    nodeEnv: config.nodeEnv,
    apiPort: config.api.port,
    apiPublicUrl: config.api.publicUrl,
    databaseHost: host(config.database.appUrl),
    redisHost: host(config.redis.url),
    signingKeyId: config.keys.activeSigningKey.id,
    retiredSigningKeyCount: config.keys.retiredSigningKeys.length,
    sentryConfigured: config.observability.sentryDsn !== undefined,
    logLevel: config.observability.logLevel,
  };
}
