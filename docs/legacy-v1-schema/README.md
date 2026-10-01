# v1 legacy schema - REFERENCE ONLY

**project1 (v2) is the source of truth. v1 is not.**

Nothing in this directory is a model to copy. The v2 data model is derived from
the ADRs in `../adr/` and the vocabulary in `../../CONTEXT.md`. v1 has no
organisation, no audience, no send plan, no suppression, no invitation attempt,
and calls a contact a "recipient" - it is a different and much smaller product.

v1 material is kept for exactly two purposes:

1. Techniques proven to work, such as the `FOR UPDATE SKIP LOCKED` reservation
   in `01-functions.sql`.
2. Defects proven to happen, so v2 does not reinvent them. See `FINDINGS.md`.

Read `FINDINGS.md` first - it explains that the extracted project is not the
production database.

---

Recovered database definitions from the Bulk-Calendar-Invites v1 Supabase
project. This directory is a staging area, not the final schema. Its purpose is
to get send-critical logic under version control before it can be lost, and to
serve as reference when the project1 Drizzle schema is designed.

## Why this exists

W18 in `../architecture-review-findings.md`. The v1 send engine depends on four
Postgres functions:

- `lock_recipients_for_batch_v2` - atomic reservation of a recipient batch.
  This is the concurrency primitive the whole send path rests on, and the
  closest existing implementation of the reservation pattern in ADR 0014.
- `complete_email_batch_v2` - marks a batch and its recipients complete.
- `cleanup_failed_batch` - releases a batch after final BullMQ failure.
- `get_campaigns_with_stats` - campaign list aggregation.

No migration files were ever committed to the v1 repository. A confirmed local
search found zero `.sql` files; the function names appear only as string
literals in `backend/scheduler.js` and `backend/workers/email.worker.js`. The
definitions exist in exactly one place: the live Supabase project. If that
project is deleted, downgraded, or loses its data, the logic is gone with no
way to recover it.

## How to extract

Preferred, if you have the Postgres client tools installed. Connection string
is in Supabase Studio under Project Settings -> Database:

    pg_dump --schema-only --no-owner --no-privileges \
      "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
      > 00-full-schema.sql

That single command captures everything below and is the best outcome.

Fallback, requiring no local install: open Supabase Studio -> SQL Editor and
run each query in `EXTRACT.sql`, saving results to the filename named in the
comment above it.

Query 1 is the one that matters most. If you only run one, run that.

## Do not commit credentials

The connection string contains the database password. Do not paste it into any
file in this directory. Extracted schema and function bodies are safe to
commit; connection strings, service role keys, and API keys are not.

## Expected contents once populated

    00-full-schema.sql      pg_dump output, if that route was used
    01-functions.sql        the four RPC bodies          <- priority
    02-columns.tsv          table and column definitions
    03-constraints.tsv      PK, FK, unique, check
    04-indexes.tsv          indexes
    05-rls.tsv              RLS state and policies       <- evidence for W21
    06-enums.tsv            status vocabularies
    07-triggers.tsv         triggers

## What happens next

Once `01-functions.sql` exists, the reservation logic can be reviewed against
ADR 0014 - specifically whether the existing lock is genuinely atomic under
concurrent schedulers, and whether it survives the W19 duplicate-execution
hazard. That review feeds directly into the project1 schema design rather than
being rediscovered later.
