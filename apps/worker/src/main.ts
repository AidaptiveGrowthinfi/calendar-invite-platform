import 'reflect-metadata';
import { Redis } from 'ioredis';
import { loadConfig, describeConfig } from '@platform/config';
import { createAppDatabase } from '@platform/db';
import { checkHealth, createLogger } from '@platform/observability';

/**
 * The worker process. ADR 0001 (background workers), ADR 0012 (BullMQ).
 *
 * It starts, proves it can reach PostgreSQL and Redis, and then waits. No
 * queues are registered yet: `docs/spec/03-workers-and-jobs.md` specifies
 * eight workers and twelve scheduled jobs, and every one of them belongs to a
 * ticket from E3 onward.
 *
 * Note which connection this opens. Despite being the worker, it connects as
 * `app_user`, not `app_worker`. ADR 0043's exemption list is exhaustive and
 * BYPASSRLS is for the three components on it; everything else a worker does,
 * including the per-organisation body of a job the dispatcher selected, runs
 * inside `withOrg()`. A worker that opened `app_worker` by default would make
 * the entire isolation model advisory.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.observability.logLevel, service: 'worker' });

  const database = createAppDatabase({ url: config.database.appUrl });
  const redis = new Redis(config.redis.url, { maxRetriesPerRequest: null });

  const health = await checkHealth('worker', {
    postgres: async () => database.ping(),
    redis: async () => {
      await redis.ping();
    },
  });

  if (health.status !== 'healthy') {
    logger.error('worker dependencies are not healthy', { health });
    await database.close();
    redis.disconnect();
    process.exit(1);
  }

  logger.info('worker started', { ...describeConfig(config), queues: [] });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await database.close();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`worker failed to start: ${String(error)}\n`);
  process.exit(1);
});
