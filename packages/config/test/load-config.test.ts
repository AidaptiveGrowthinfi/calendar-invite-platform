import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, describeConfig, loadConfig } from '../src/index';

const b64 = (bytes: number): string => randomBytes(bytes).toString('base64');

const validEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  API_PUBLIC_URL: 'https://api.example.com',
  DATABASE_URL_APP: 'postgres://app_user@localhost:5432/platform',
  DATABASE_URL_WORKER: 'postgres://app_worker@localhost:5432/platform',
  DATABASE_URL_MIGRATOR: 'postgres://migrator@localhost:5432/platform',
  REDIS_URL: 'redis://localhost:6379',
  SUPPRESSION_PEPPER: b64(32),
  TOKEN_ENCRYPTION_KEY: b64(32),
  SIGNING_KEY_ID: 'k1',
  SIGNING_KEY_SECRET: b64(32),
  ...over,
});

describe('loadConfig - E0-3, fails at boot rather than at first use', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig(validEnv());
    expect(config.api.port).toBe(3000);
    expect(config.keys.activeSigningKey.id).toBe('k1');
  });

  it('fails when a secret is missing', () => {
    expect(() => loadConfig(validEnv({ SUPPRESSION_PEPPER: undefined }))).toThrow(
      ConfigurationError,
    );
  });

  it('fails when a key is the wrong length, and says which key and what length', () => {
    try {
      loadConfig(validEnv({ TOKEN_ENCRYPTION_KEY: b64(16) }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).toContain('TOKEN_ENCRYPTION_KEY');
      expect(String(error)).toContain('32 bytes');
    }
  });

  it('reports every problem at once, not the first one', () => {
    try {
      loadConfig(
        validEnv({
          SUPPRESSION_PEPPER: undefined,
          REDIS_URL: undefined,
          API_PUBLIC_URL: 'not-a-url',
        }),
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = String(error);
      expect(message).toContain('SUPPRESSION_PEPPER');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('API_PUBLIC_URL');
    }
  });

  it('rejects a signing key id containing a dot, which is the token separator', () => {
    expect(() => loadConfig(validEnv({ SIGNING_KEY_ID: 'k.1' }))).toThrow(ConfigurationError);
  });

  it('rejects reusing the suppression pepper as another key', () => {
    const shared = b64(32);
    expect(() =>
      loadConfig(validEnv({ SUPPRESSION_PEPPER: shared, TOKEN_ENCRYPTION_KEY: shared })),
    ).toThrow(/must not be the same key/u);
  });

  it('keeps three separate database roles - ADR 0043', () => {
    const config = loadConfig(validEnv());
    const urls = new Set([
      config.database.appUrl,
      config.database.workerUrl,
      config.database.migratorUrl,
    ]);
    expect(urls.size).toBe(3);
  });
});

describe('describeConfig', () => {
  it('never contains key material', () => {
    const env = validEnv();
    const described = JSON.stringify(describeConfig(loadConfig(env)));

    for (const secret of [
      env.SUPPRESSION_PEPPER,
      env.TOKEN_ENCRYPTION_KEY,
      env.SIGNING_KEY_SECRET,
    ]) {
      expect(described).not.toContain(secret as string);
    }
  });

  it('says enough to diagnose a misconfigured deployment', () => {
    const described = describeConfig(loadConfig(validEnv()));
    expect(described.databaseHost).toBe('localhost:5432');
    expect(described.signingKeyId).toBe('k1');
    expect(described.sentryConfigured).toBe(false);
  });
});
