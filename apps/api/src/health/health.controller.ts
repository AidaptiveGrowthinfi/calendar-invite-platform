/**
 * Health endpoints. ADR 0035 requires checks for API, worker, Redis and
 * PostgreSQL.
 *
 * Two endpoints, because they answer different questions:
 *
 *   /health/live   Is this process running? Used by Docker to decide whether
 *                  to restart the container.
 *   /health/ready  Can it serve? Probes PostgreSQL. Used by the reverse proxy
 *                  to decide whether to send traffic.
 *
 * Conflating them is how a deployment goes green while the database is
 * unreachable.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { checkHealth, type HealthReport } from '@platform/observability';
import type { AppDatabaseHandle } from '@platform/db';
import { DATABASE } from '../platform/platform.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: AppDatabaseHandle) {}

  @Get('live')
  live(): { status: 'alive' } {
    return { status: 'alive' };
  }

  @Get('ready')
  async ready(): Promise<HealthReport> {
    return checkHealth('api', {
      // `ping()` is a `select 1` as app_user. Deliberately not a tenant
      // query: a tenant query without withOrg() correctly returns nothing,
      // which would look like a failed probe.
      postgres: async () => this.database.ping(),
    });
  }
}
