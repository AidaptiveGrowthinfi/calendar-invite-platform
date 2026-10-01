/**
 * Health checks. ADR 0035 requires them for API, worker, Redis and PostgreSQL.
 *
 * A health check that only reports "the process is up" is what lets a
 * deployment go green while the database is unreachable. Each dependency is
 * probed, and the overall status is the worst of them.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  readonly name: string;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly detail?: string;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly service: string;
  readonly checkedAt: string;
  readonly dependencies: readonly DependencyHealth[];
}

export type Probe = () => Promise<void>;

const TIMEOUT_MS = 2_000;

async function runProbe(name: string, probe: Probe): Promise<DependencyHealth> {
  const started = Date.now();
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${String(TIMEOUT_MS)}ms`)), TIMEOUT_MS),
      ),
    ]);
    return { name, status: 'healthy', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      status: 'unhealthy',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkHealth(
  service: string,
  probes: Readonly<Record<string, Probe>>,
): Promise<HealthReport> {
  const dependencies = await Promise.all(
    Object.entries(probes).map(([name, probe]) => runProbe(name, probe)),
  );

  const status: HealthStatus = dependencies.some((d) => d.status === 'unhealthy')
    ? 'unhealthy'
    : 'healthy';

  return { status, service, checkedAt: new Date().toISOString(), dependencies };
}
