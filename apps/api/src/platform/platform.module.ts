/**
 * The platform modules, wired into Nest's DI container.
 *
 * `spec/00-overview.md` lists `platform/db`, `platform/config`,
 * `platform/crypto` and `platform/observability` as modules of one application
 * (ADR 0001, a modular monolith). They live in `packages/` rather than inside
 * this app because `apps/worker` needs the same code, and duplicating
 * `platform/crypto` between two deployables is precisely the drift
 * `spec/01-modules.md` forbids.
 *
 * ADR 0042 notes there is no official NestJS integration for Drizzle, so the
 * database instance is provided through the DI container by hand. This is that.
 */
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadConfig, type Config } from '@platform/config';
import { createAppDatabase, type AppDatabaseHandle } from '@platform/db';
import { createLogger, type Logger } from '@platform/observability';

export const CONFIG = Symbol('CONFIG');
export const DATABASE = Symbol('DATABASE');
export const LOGGER = Symbol('LOGGER');

@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      // ADR 0049: a missing or undecryptable secret fails at BOOT, not at first
      // use. `loadConfig` throws here, before Nest finishes building the
      // container, so the process never reaches a listening state.
      useFactory: (): Config => loadConfig(),
    },
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: Config): Logger =>
        createLogger({ level: config.observability.logLevel, service: 'api' }),
    },
    {
      provide: DATABASE,
      inject: [CONFIG],
      // The API connects as `app_user`. It holds no bypass, so every read and
      // write is subject to RLS and anything outside `withOrg()` sees nothing.
      useFactory: (config: Config): AppDatabaseHandle =>
        createAppDatabase({ url: config.database.appUrl }),
    },
  ],
  exports: [CONFIG, DATABASE, LOGGER],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly database: AppDatabaseHandle,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Nest calls this after the HTTP server stops accepting connections. */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.info('shutting down', { signal });
    await this.database.close();
  }
}
