import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    /**
     * Tests run against `src`, not `dist`, so a test never passes against a
     * stale build. The package `exports` fields still point at `dist`, which is
     * what the Docker images and `apps/*` consume, so the build stays honest.
     */
    alias: {
      '@platform/shared': src('shared'),
      '@platform/crypto': src('crypto'),
      '@platform/config': src('config'),
      '@platform/db': src('db'),
      '@platform/observability': src('observability'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
    /**
     * Database-backed suites need a real PostgreSQL instance
     * (`spec/05-invariants-and-tests.md`: a mock asserts only that the code
     * called it). They skip themselves when DATABASE_URL is absent and say so,
     * rather than silently reporting green.
     */
    passWithNoTests: false,
  },
});
