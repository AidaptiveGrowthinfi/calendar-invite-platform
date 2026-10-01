import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PlatformModule } from './platform/platform.module';

/**
 * The application root.
 *
 * Product modules land here as their tickets do: `identity` (E1), `audit`
 * (E2), `audience` (E3), `campaign` (E6), `send` (E8). The boundaries are
 * already drawn in `docs/spec/01-modules.md`, including what each one must not
 * do, so this list is the map rather than a decision.
 */
@Module({
  imports: [PlatformModule, HealthModule],
})
export class AppModule {}
