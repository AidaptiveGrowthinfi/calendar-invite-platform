import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@platform/config';
import { describeConfig } from '@platform/config';
import { createLogger } from '@platform/observability';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Configuration is loaded and validated BEFORE Nest starts (ADR 0049): a
  // missing secret must stop the process here rather than surface on the first
  // request that happens to need it.
  const config = loadConfig();
  const logger = createLogger({ level: config.observability.logLevel, service: 'api' });

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();

  await app.listen(config.api.port);
  logger.info('api listening', describeConfig(config));
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${String(error)}\n`);
  process.exit(1);
});
