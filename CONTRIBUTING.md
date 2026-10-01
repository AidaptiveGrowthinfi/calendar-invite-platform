# Working on this together

Two people, one repository. This is the short list of agreements that stop the
two of you building on different assumptions.

## Before picking up a ticket

Read `docs/spec/00-overview.md`. Its cross-cutting rules bind every ticket, and
several tickets in the backlog are one sentence long only because those rules
are not restated per ticket.

Then read the ticket in `docs/tickets/backlog.md` and the "must not" list for
the module it touches in `docs/spec/01-modules.md`. Those entries are not style
advice - each one names a shape some schema slice explicitly rejected, so that
it is not reintroduced by someone who has not read the slice.

## Branches and review

- Branch off `main`. Small branches; `main` stays deployable.
- Open a pull request. CI must be green before merge.
- Review is not optional for anything touching `packages/db`,
  `packages/crypto`, or a migration. Those are the places where a mistake is
  either invisible or unrepairable.

## The one rule that matters more than the others

**When the decisions do not answer your question, raise it. Do not fill it in.**

The specification was written under this rule and it is why it is trustworthy:
where building something needed an answer no ADR had given, it marked the gap
rather than inventing one. A specification that quietly fills gaps is how a
decision gets taken by whoever happened to write the paragraph.

There are already five known gaps, `OPEN-S1` to `OPEN-S5`, each with a
documented workaround in the backlog. Follow that pattern:

1. Add the question to `docs/open-decisions.md` with a recommendation.
2. Use the workaround, and mark it in the code with the gap's id.
3. Raise it. Both of this project's last two findings were raised and settled
   the same day.

## Vocabulary

`CONTEXT.md` is binding on identifiers, API paths, UI copy and error messages.
`pnpm gate:vocabulary` catches the unambiguous half. The other half is review:
a pull request that calls a contact a "recipient" or an organisation a "tenant"
gets a comment.

It sounds pedantic. The reason it is not: v1's frontend inherited a cold-email
vocabulary - "reply rate", "sequence", `{{first_name}}` - and described a
product this one is not. ADR 0056 threw the whole thing away.

## Migrations

```sh
pnpm db:generate      # after changing packages/db/src/schema
pnpm db:migrate
```

Commit the generated SQL **and** the `meta/` snapshot together. Never edit a
migration that has been applied anywhere but your own machine.

The banned `drizzle-kit` push command is not a shortcut for local work. It does
not apply RLS policies, so a database built by it has none - and then every
isolation test passes against a schema that is not the one that ships.
`pnpm gate:no-push` fails the build if it appears anywhere.

## Adding a table

1. Give it `organisation_id` via `organisationIdColumn()`.
2. Add `tenantPolicy('your_table')` to the table's extras array.
3. Call `.enableRLS()`.
4. Every index leads with `organisation_id`.
5. `pnpm db:generate`, then `pnpm db:migrate`, then `pnpm vitest run packages/db`.

If you skip any of it, the RLS enumeration test tells you which one. It is
written as an enumeration over `pg_class` rather than a list of table names
precisely because a list has to be updated by the person adding the table -
which is the person who just forgot.

**A table that is not organisation-scoped needs a reason**, and the reason has
to be one of ADR 0043's three exemptions. The list is exhaustive and adding a
fourth entry requires a new ADR. Two features have already needed one and
routed around it instead - slice 5's shared trial domain, and slice 1's
`api_key`, which puts the organisation reference in the key itself. Routing
around it is the expected response.

## Secrets

Never commit a credential, to `docs/legacy-v1-schema/` or anywhere. Encrypted
SOPS files are committed; the age private key is not. See `secrets/README.md`.

`SUPPRESSION_PEPPER` is the one that cannot be replaced. It can never be
rotated, and losing it does not raise an error - the platform simply resumes
sending to people who unsubscribed.

## Splitting the work

The natural seam after E0 is backend against frontend: one person takes
identity, audit, audience, campaigns and the send engine; the other takes the
dashboard against the API contract in `docs/spec/02-api.md`. E8 is the critical
path and deserves undivided attention.

Do not split by schema slice. Slices cut across modules and you would both be
editing the same migration files.

## Track P is not an engineering task

`P-1` (a company-owned Google Cloud project) and `P-2` (OAuth verification for
the sensitive `calendar.events` scope) need an account, not code, and P-2 is a
review queue measured in weeks to months. It does not get shorter by waiting
until the product works. Start it now; it runs underneath everything else.
