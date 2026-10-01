# Use Prisma with strict raw SQL guardrails

SUPERSEDED by ADR 0042 on 2026-09-03. Drizzle ORM replaces Prisma. The raw SQL
guardrails and tenant-scoping requirement in this ADR remain in force; only the
access layer changed. Tenant scoping is now enforced by ADR 0043 rather than by
convention. Retained unedited as the original record.

We will use Prisma as the default database access layer for the TypeScript backend, while allowing parameterized raw SQL or TypedSQL for planner, worker, locking, bulk import, and reconciliation paths that need more control. Unsafe raw SQL methods and string-built queries are banned for user-controlled input; every product query must preserve tenant scoping and every send-critical path must be backed by database constraints, transactions, and tests.
