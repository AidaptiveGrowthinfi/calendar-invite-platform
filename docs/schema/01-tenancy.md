# Schema slice 1: tenancy and mailboxes

Derived from the ADRs, not from v1. Every column below traces to a decision;
where it does, the ADR is named.

## Conventions, applied to every slice

- Primary keys are `uuid` with `gen_random_uuid()`.
- Instants are `timestamptz` (ADR 0044). The single exception is a campaign's
  event time, which is local time plus zone - slice 3.
- Every organisation-scoped table carries `organisation_id uuid NOT NULL`, has
  RLS enabled and forced, and every index on it leads with `organisation_id`
  (ADR 0043).
- Enumerated values are Postgres enums, so an invalid state cannot be written.
- Encrypted material is `bytea`, never `text`, so it cannot be logged as a
  string by accident.

## organisation

The product owns this table. Better Auth owns `user`, `session`, `account`,
`organization`, `member`, and `invitation`; those are exempt from RLS under
ADR 0043 and are not modelled here.

The two are linked one-to-one by `auth_organization_id`. The seam exists so
that the table every RLS policy references is governed by this project's
migrations rather than a third-party library's, and so the auth library remains
replaceable. Session handling resolves the Better Auth organisation to this
row once per request, and it is this id that `withOrg()` puts into
`app.organisation_id`.

    id                    uuid pk
    auth_organization_id  text not null unique   -- Better Auth
    name                  text not null
    slug                  text not null unique
    status                org_status not null default 'active'
    timezone              text not null default 'Asia/Kolkata'   -- W29
    created_at            timestamptz not null default now()
    updated_at            timestamptz not null

    org_status: active | suspended | closed

`timezone` was added 2026-09-08, closing W29. Slice 4 computes
`mailbox_capacity_day.day` as "a date in the organisation's timezone" and slice
6 computes `usage_counter.period_start` the same way, and neither had a column
to read. Left as it was, both would silently have been UTC - which in the first
market shifts a mailbox's capacity-day boundary to 05:30 local and closes a
billing period mid-morning. Neither would look wrong on a screen, and both
would make a reconciliation job disagree with a human counting rows.

It is validated against `pg_timezone_names` and normalised to canonical form by
the **same** validator ADR 0044 requires for `campaign_revision.timezone` - one
validator with two callers, for the reason slice 2 gives for having one email
normaliser. It is not the same value as a campaign's zone and does not
substitute for it: an event has its own zone under 0044, and this is the
organisation's accounting day.

This table is NOT itself row-level secured. It is the anchor the policies
compare against; securing it would make the tenant lookup circular. Access to
it is by primary key from an authenticated session only.

## organisation_oauth_client

Optional, and empty for every customer at launch. Exists from the first
migration so that ADR 0048's customer-owned Cloud project option is reachable
without a migration later.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    provider              mailbox_provider not null
    client_id             text not null
    client_secret_enc     bytea not null         -- ADR 0049
    created_at            timestamptz not null default now()

    unique (organisation_id, provider)

RLS: enabled, forced.

## mailbox

A connected Google Workspace or Microsoft 365 account used to send invitations
(CONTEXT.md). Not a product user.

    id                        uuid pk
    organisation_id           uuid not null -> organisation
    provider                  mailbox_provider not null
    provider_account_id       text not null
    email                     text not null
    display_name              text
    provider_tenant_id        uuid null -> provider_tenant              -- 0066

    status                    mailbox_status not null default 'active'

    oauth_client_id           uuid null -> organisation_oauth_client   -- 0048
    scopes                    text[] not null
    access_token_enc          bytea                                     -- 0049
    refresh_token_enc         bytea
    token_expires_at          timestamptz

    calendar_sync_token       text                                      -- 0041
    calendar_synced_at        timestamptz

    daily_capacity_target     integer not null default 2000             -- 0047
    observed_capacity_ceiling integer                                   -- 0047
    throttle_state            throttle_state not null default 'none'
    throttled_until           timestamptz

    connected_at              timestamptz not null default now()
    created_at                timestamptz not null default now()
    updated_at                timestamptz not null

    unique (organisation_id, provider, provider_account_id)
    index  (organisation_id, status)

    mailbox_provider: google | microsoft
    mailbox_status:   active | needs_reauth | blocked | disconnected
    throttle_state:   none | throttled | recovering

Notes on specific columns.

`provider_account_id` is the uniqueness key, not `email`. A user can rename a
Workspace address while keeping the same account, and matching on the address
would create a duplicate mailbox holding a second copy of the same tokens.

`daily_capacity_target` defaults to 2000 per ADR 0047, one fifth of the
documented Workspace throttle point. `observed_capacity_ceiling` is null until
the platform has actually seen a throttle, at which point 0047 requires the
discovered value be stored and reused rather than rediscovered by breaching the
limit again. The effective ceiling is the lower of the two.

`throttle_state` and `throttled_until` carry the residual requirement from W4c.
The owner deferred the warm-up ramp because mailboxes are pre-warmed; detection
and back-off remain required, because pre-warming establishes reputation and
does not raise Google's external-invite limit.

`provider_tenant_id` is set for Microsoft mailboxes and null for Google ones
(ADR 0066). Exchange Online limits external recipients per tenant, so the
mailboxes of one Microsoft tenant share a budget no single mailbox row can
express. A Microsoft sending address on an `onmicrosoft.com` domain is refused
at connection.

`calendar_sync_token` is per mailbox per ADR 0041. A `410 GONE` clears it and
triggers a full resync rather than leaving a silent gap.

Tokens are `bytea` and encrypted under ADR 0033, with the key managed per ADR
0049. `needs_reauth` is a first-class status because v1 proved it is a normal
operating state, not an error.

## provider_tenant

ADR 0066. A Microsoft 365 tenant whose mailboxes this organisation has
connected. Added 2026-10-01 as a slice correction.

    id                        uuid pk
    organisation_id           uuid not null -> organisation
    provider                  mailbox_provider not null   -- 'microsoft' only today
    external_tenant_id        text not null               -- Entra 'tid' claim

    declared_licence_count    integer                     -- organiser-attested
    declared_terrl            integer                     -- read from EAC, preferred
    budget_fraction           numeric(3,2) not null default 0.50
    daily_budget              integer not null            -- derived, stored

    throttle_state            throttle_state not null default 'none'
    throttled_until           timestamptz

    created_at                timestamptz not null default now()
    updated_at                timestamptz not null

    unique (organisation_id, provider, external_tenant_id)
    check  (provider = 'microsoft')
    check  (budget_fraction > 0 and budget_fraction <= 1)

RLS: enabled, forced.

`daily_budget` is `budget_fraction` of the tenant's external recipient limit
(TERRL). The limit is `declared_terrl` when the organiser has copied it from the
Exchange admin center; otherwise it is computed from `declared_licence_count` as
`500 x licences^0.7 + 9500`; with neither, it is the 5,000 trial cap. It is
stored rather than derived on read because approval reads it inside a locking
transaction, and recomputed whenever either declared value changes.

The row is organisation-scoped like everything else. The same Microsoft tenant
connected under two organisations is two rows with two budgets that cannot see
each other. ADR 0066 accepts that rather than carving a cross-tenant lookup into
ADR 0043's isolation.

`throttle_state` here is the tenant-wide counterpart of `mailbox.throttle_state`:
a sending-limit signal from any of the tenant's mailboxes reduces all of them.

## api_key

ADR 0040 prices API keys and ADR 0032 audits their creation and revocation.
Added 2026-09-08, after slice 8 - it was the last table the ADRs required and
no slice had defined.

    id                    uuid pk
    organisation_id       uuid not null -> organisation
    name                  text not null
    key_prefix            text not null              -- display only
    key_digest            bytea not null             -- SHA-256 of the key
    scopes                text[] not null default '{}'

    created_by_user_id    text not null
    created_at            timestamptz not null default now()
    last_used_at          timestamptz
    revoked_at            timestamptz

    unique (organisation_id, key_digest)
    index  (organisation_id, revoked_at)
    index  (organisation_id, created_at desc)

RLS: enabled, forced.

The key is never stored. It is generated once, shown once, and only its digest
is kept. `key_prefix` holds the first few visible characters so a customer can
tell two keys apart in a list without the platform holding either.

### Why a plain digest here and an HMAC in ADR 0046

ADR 0046 deliberately refuses a plain SHA-256 for suppression, because the
space of email addresses is small and enumerable, so an unkeyed digest is
recoverable by brute force. None of that applies to a 256-bit random secret.
There is nothing to enumerate, so a plain digest is sufficient.

That difference is worth stating rather than copying 0046's construction for
symmetry, because 0046's pepper **can never be rotated** - it is a permanent,
unrotatable secret whose loss silently destroys every suppression record. A
second one, taken on for a table that does not need it, would be a second
permanent liability bought for the appearance of consistency.

### The key carries its organisation, so authentication needs no RLS exemption

An API request arrives with a key and nothing else. Finding which organisation
it belongs to is a lookup that has no tenant context yet, which under ADR 0043
would be a cross-tenant read - and 0043's exemption list is exhaustive, so this
would have required a new ADR to add a fourth exemption on the authentication
path, of all places.

It does not need one. The key carries its own organisation reference:

    gi_<base62(organisation_id)>_<random secret>

Authentication parses the prefix, opens `withOrg()` on that organisation, and
looks up the digest of the whole presented key **under RLS as `app_user`**. A
forged or altered organisation reference selects zero rows, which is exactly
the loud-empty-result failure mode ADR 0043 designs for rather than a silent
cross-tenant read.

The organisation reference is not a secret. It is already in
`app.organisation_id` on every request and on every row of every secured table.
What authenticates is the second half, and the digest covers the whole string
so a valid secret presented under another organisation's prefix does not match.

### Revocation, and why there is no `revoked_by`

A revoked key is never deleted. ADR 0061, and it is also what makes the
question "what did the person who left have access to, and when was it taken
away" answerable at all.

`revoked_at` is a state the authentication path reads on every request.
*Who* revoked it is deliberately not a column here: slice 8 records
`api_key_revoked` with a typed actor, and a nullable `revoked_by_user_id` would
mean both "the system revoked it" and "we lost track of who did", which is the
ambiguity ADR 0064 exists to prevent. `created_by_user_id` stays, matching
every other creatable table in the schema.

`last_used_at` is written opportunistically rather than in the request's
transaction - at most once per key per few minutes. It is the one column here
whose staleness costs nothing and whose write would otherwise happen on every
authenticated call.

`scopes` is `text[]`, matching `mailbox`. The scope vocabulary is a product
decision nobody has taken; until it is, an empty array means full access within
the organisation. Recorded so that the empty default is read as "not yet
defined" rather than "no access".

### Where this table is enforced and observed

The `api_key` plan dimension in slice 6 is a **stock** dimension: creating a key
counts live keys - `revoked_at is null` - against the entitlement, under
`FOR UPDATE` on the subscription row, which is what the second index above is
for. Creation and revocation are audit events under slice 8, with `api_key` as
the `audit_subject`.

## RLS pattern, applied to every secured table

    alter table <t> enable row level security;
    alter table <t> force  row level security;

    create policy tenant_isolation on <t>
      using      (organisation_id = current_setting('app.organisation_id', true)::uuid)
      with check (organisation_id = current_setting('app.organisation_id', true)::uuid);

`with check` is not optional. Without it a caller can pass the `using` predicate
on read and still insert or update a row into another organisation.

In Drizzle these are declared with `pgPolicy` beside the table and generated by
`drizzle-kit generate`. `drizzle-kit push` is banned - it does not apply
policies (ADR 0042).

Access goes through `withOrg(orgId, fn)`, which opens a transaction, issues
`SET LOCAL app.organisation_id`, and runs the callback. `SET LOCAL` is
transaction-scoped and therefore safe under transaction-mode pooling.

Roles per ADR 0043: `app_user` runs the API and is subject to RLS; `app_worker`
holds `BYPASSRLS` and is used only by the dispatcher and shared quota
accounting; the migration owner is separate from both.

## Resolved: the slice 2 question

Whether `contact` is deduplicated per organisation or per audience. Answered
2026-09-07: **per organisation**, with the per-import values carried on
`audience_member` rather than on the contact. Suppression, bounce, and
verification state attach to a person who persists across campaigns. See
`02-audience.md`.
