# Calendar Invite Campaign Platform

A SaaS platform for sending calendar invitations at scale to opted-in audiences
and measuring attendance.

> **This repository is public but not open source.** See [`LICENSE`](LICENSE).
> Public visibility is how a two-person team gets branch protection and
> unrestricted CI on GitHub Free; it is not a grant of rights.

**Read [`CONTEXT.md`](CONTEXT.md) first.** It defines the domain vocabulary and,
unusually, lists forbidden synonyms for each term. The ADRs, the schema and the
specification all depend on that language, and `pnpm gate:vocabulary` enforces
the unambiguous part of it.

## Where the thinking lives

The design is finished and is **not to be re-derived**. It is all in `docs/`:

| Path                                   | What it holds                                                          |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `docs/open-decisions.md`               | **Start here.** What is settled, deferred, and open.                   |
| `docs/spec/00-overview.md`             | Runtime topology, cross-cutting rules, the five open gaps.             |
| `docs/spec/01-modules.md`              | 16 modules: tables owned, ADRs that bind them, a "must not" list each. |
| `docs/spec/02-api.md`                  | Four entry points: dashboard, programmatic, public pages, webhooks.    |
| `docs/spec/03-workers-and-jobs.md`     | 8 workers, 10 reconciliation jobs, 2 clearing jobs.                    |
| `docs/spec/04-state-machines.md`       | Every status enum and its legal transitions.                           |
| `docs/spec/05-invariants-and-tests.md` | What must be true, and the test that proves it.                        |
| `docs/tickets/backlog.md`              | Track P plus E0-E14, sequenced, with acceptance criteria.              |
| `docs/schema/01`-`08`                  | The tables. The authority; the spec never restates a column list.      |
| `docs/adr/0001`-`0065`                 | The decisions.                                                         |
| `docs/architecture-review-findings.md` | The working ledger, W1-W29.                                            |

Where the spec and an ADR disagree, the ADR wins. Where the spec and a schema
slice disagree, the slice wins.

## Getting started

Prerequisites: Node 20.20.2 (`.nvmrc`), pnpm 10, and Docker.

```sh
pnpm install
cp .env.example .env.local          # then fill in the three keys it names
pnpm dev:infra                      # PostgreSQL and Redis
pnpm db:bootstrap                   # creates app_user, app_worker, migrator
pnpm db:migrate                     # migrations only - see below
pnpm build
pnpm test
```

Generate the three keys with `openssl rand -base64 32`. `pnpm db:bootstrap`
needs `DATABASE_URL_ADMIN` and the three role passwords; everything after it
uses the three role URLs.

Then, in separate terminals:

```sh
pnpm --filter @apps/api dev         # http://localhost:3000/health/ready
pnpm --filter @apps/worker dev
pnpm --filter @apps/web dev         # http://localhost:5173
```

## Layout

```
apps/api          NestJS HTTP. Runs as app_user. Subject to RLS.
apps/worker       BullMQ. Runs as app_worker only where ADR 0043 exempts it.
apps/web          React + Vite SPA. Static build, served by the VPS.
packages/db       Drizzle schema, migrations, withOrg(), the three roles.
packages/crypto   The one email normaliser, suppression HMAC, token crypto.
packages/config   Environment loading and boot-time validation.
packages/observability  Structured logs and health checks.
packages/shared   Domain types, the vocabulary, the provider error taxonomy.
scripts/          The CI gates.
```

`packages/crypto`, `packages/config` and `packages/observability` are separate
packages rather than folders inside `apps/api` because `apps/worker` needs the
same code, and duplicating `platform/crypto` between two deployables is exactly
the drift `spec/01-modules.md` forbids. `spec/00-overview.md` lists only
`packages/db` and `packages/shared`; splitting the other three out is a
structural choice, and a reversible one.

## Rules that are enforced, not remembered

Four things fail the build. Each replaces a convention somebody would otherwise
have to hold in their head.

```sh
pnpm gates
```

| Gate                  | Enforces                                                                        | Because                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gate:no-push`        | The banned `drizzle-kit` push command exists nowhere, including in dev and test | It does not apply RLS policies. A database built by it has none, and every isolation test then passes against a schema that is not the one that ships (ADR 0042).                                                                                            |
| `gate:migrations`     | No schema change without a generated migration                                  | Otherwise a deploy expects columns the database does not have.                                                                                                                                                                                               |
| `gate:one-normaliser` | Exactly one email normaliser                                                    | If two drift, a re-imported contact silently stops matching their own suppression entry and the platform resumes sending to someone who unsubscribed. **Unrepairable afterwards** - ADR 0046's rules are frozen and the addresses are deliberately not kept. |
| `gate:vocabulary`     | CONTEXT.md's unambiguous forbidden terms                                        | v1's cold-email vocabulary is what the frontend inherited, and ADR 0056 threw it away.                                                                                                                                                                       |

Plus the RLS enumeration in `packages/db/test/rls-enumeration.test.ts`, which
needs a real PostgreSQL and fails when a table ships without a policy.

## Three things worth knowing before you write a query

**Tenant data goes through `withOrg()`.** It opens a transaction, sets
`app.organisation_id`, and runs your callback. There is no other way in: the
connection sits behind a private symbol. Code that reaches the database without
it returns **zero rows** - ADR 0043 designs for that, because an empty result
is loud and another organisation's data is silent.

**Migrations only.** `pnpm db:generate` then `pnpm db:migrate`. Drizzle's
`.enableRLS()` emits `ENABLE` but not `FORCE`, so `pnpm db:migrate` applies
`FORCE ROW LEVEL SECURITY` and the grants afterwards, derived from the catalog
rather than from a list anybody maintains. Without `FORCE`, the table owner
bypasses its own policy.

**A decision is never edited in place** (ADR 0054). Supersede it with a new ADR
and add a pointer to the old one; that pointer is the only permitted edit.
Schema slices and the spec documents are not ADRs and may be edited freely.

## Working together

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
