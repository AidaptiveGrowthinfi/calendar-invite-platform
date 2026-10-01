# Use Drizzle ORM as the database access layer

Supersedes: ADR 0007
Date: 2026-09-03

We will use Drizzle ORM as the database access layer for the TypeScript
backend, replacing Prisma. The guardrails from ADR 0007 carry over unchanged:
string-built queries are banned for user-controlled input, every product query
must preserve tenant scoping, and every send-critical path must be backed by
database constraints, transactions, and tests.

Two reasons, the second of which is the stronger one.

First, tenant isolation. ADR 0043 makes PostgreSQL row-level security the
enforcement mechanism for tenant scoping. Prisma cannot express RLS policies or
roles in its schema, so policies would live in hand-written migrations
disconnected from the table definitions, and the only thing preventing a new
table from shipping without a policy would be a test somebody remembered to
write. Drizzle declares policies and roles in the same schema file as the
tables via `pgPolicy` and `pgRole`, and `drizzle-kit` generates the migrations
for them. More importantly, a table declared with `enableRLS()` and no policy
is default-deny: forgetting a policy fails closed rather than open. The test
described in 0043 is still required, but it stops being the only guarantee.

Second, and independent of RLS, the shape of this system's hard queries.
The safety-critical core is reservation locking (`SELECT ... FOR UPDATE SKIP
LOCKED`), atomic capacity counters, bulk import, and reconciliation - the exact
paths ADR 0007 already had to carve out as raw SQL. Prisma treats raw SQL as an
escape hatch from an ORM built around a separate query-engine binary. Drizzle
is a typed SQL builder where raw SQL is the native mode, the generated SQL is
predictable, and there is no engine process between the application and
PostgreSQL. The majority of this product's difficult database work sits in the
half where Prisma is weakest.

Accepted costs:

- Drizzle's relational query API is less ergonomic than Prisma's nested
  `include`. This will be felt on dashboard and analytics read paths, which are
  the least risky part of the product.
- The tooling is younger. RLS policies are known to apply under `drizzle-kit
  migrate` but not under `drizzle-kit push`. Therefore `push` is banned in this
  project, including in development; all schema change goes through generated
  migrations. Policy and role generation additionally requires
  `entities: { roles: true }` in `drizzle.config.ts`.
- There is no official NestJS integration module; the database instance is
  provided through the Nest DI container by hand.

This decision is being taken before any schema or application code exists,
which is the only point at which it is close to free.

Sources:
  https://orm.drizzle.team/docs/rls
  https://github.com/drizzle-team/drizzle-orm/issues/3504
