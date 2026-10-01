# Schema slice 5: sending domains, campaign health, throttle

Derived from the ADRs, not from v1. Conventions from slice 1 apply unchanged.

This slice covers calendar email mode's sending identity (ADRs 0017, 0018,
0021), the deliverability gate and its evidence (0016), provider webhook
ingestion (0021, 0014), and the throttle's reservations (0019). Native calendar
mode uses none of it except the gate, which applies to both modes.

## The decision this slice rested on

Slice 4 left one question open: whether Campaign Health is a current state with
a history table, or an append-only series whose latest row is current. It is
the **append-only series**.

ADR 0016 makes the gate a state machine with recovery hysteresis, and says a
campaign cannot resume merely because a worker is retried. Hysteresis is a
function of prior states, so the history is not an archive of the decision -
it is an input to it. A design with a mutable current row and a separate
history table puts the input to the decision in the table nobody reads on the
hot path, which is how hysteresis quietly degenerates into "whatever the last
evaluation said".

One correction to how I framed the cost when raising this. I said the check
"may this campaign send now" becomes a latest-row lookup rather than a
single-row read, implying a scan. With the index below it is one descent to the
end of a covering index and a single row - materially the same cost as reading
a mutable row, and without the write contention a hot mutable row would create
between the evaluator and the dispatcher.

## sending_domain

ADR 0017. Each organisation owns its calendar email sending identity.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    domain                  text not null
    return_path_host        text
    tracking_host           text                       -- 0016, branded
    rsvp_host               text                       -- 0011

    status                  domain_status not null default 'unverified'
    verified_at             timestamptz
    last_checked_at         timestamptz

    warmup_state            warmup_state not null default 'warming'
    warmup_started_at       timestamptz
    warmup_daily_cap        integer
    reputation_signals      jsonb not null default '{}'

    provider_account_id     uuid null -> email_provider_account
    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, domain)
    index  (organisation_id, status)

    domain_status: unverified | pending | verified | failed | revoked
    warmup_state:  warming | established | suspended

RLS: enabled, forced.

The three host columns are separate because ADR 0016 requires branded tracking
and RSVP links on customer-owned HTTPS domains rather than generic redirect
domains, and ADR 0017 names return-path separately from the sending domain.
They are usually subdomains of `domain`, but they are stored rather than
derived: a customer may already use a subdomain for something else, and
guessing `track.<domain>` and finding it taken is a support incident on a
customer's live DNS.

`warmup_state` is what ADRs 0051 and 0055 read. While a domain is `warming`,
the stricter verification bar applies - valid MX and no prior bounce within the
organisation - and the deliverability gate treats early bounce rate as a hard
stop rather than a slow-down.

`last_checked_at` exists because ADR 0016 requires live DNS and authentication
checks as an ongoing health signal, not a launch-time checklist. A domain that
verified in March and had its DKIM record removed in June is not verified, and
the only thing that distinguishes the two is when the platform last looked.

### The shared trial domain

ADR 0018 permits a shared sending domain for low-volume trials, with strict
daily limits so one trial user cannot damage shared reputation.

It is not a special kind of row here. Per ADR 0017, internal use is represented
as one organisation using the company's verified domains, so the shared domain
is an ordinary `sending_domain` belonging to the platform's own organisation.
Organisations granted its use hold an allocation in their own tenant:

    shared_domain_allocation
      id                    uuid pk
      organisation_id       uuid not null -> organisation
      sending_domain_id     uuid not null           -- platform-owned domain
      daily_cap             integer not null        -- 0018, strict
      granted_at            timestamptz not null default now()
      revoked_at            timestamptz

      unique (organisation_id, sending_domain_id)

RLS: enabled, forced.

This shape was chosen to avoid inventing a platform-level, RLS-exempt table.
ADR 0043's exemption list is exhaustive and any addition to it requires a new
ADR, which a trial feature does not justify. The allocation row is
organisation-scoped and readable by the customer; the platform-owned
`sending_domain` row it points at is read only by `app_worker`, which already
holds `BYPASSRLS` as the dispatcher under 0043. No new exemption is created.

`daily_cap` is enforced through the same reservation mechanism as every other
limit, described under `delivery_bucket_window` below.

## sending_domain_dns_record

The individual records ADR 0016's gate checks, kept as rows rather than as a
blob so that "which record is wrong" is answerable.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    sending_domain_id       uuid not null -> sending_domain
    record_type             dns_record_type not null
    host                    text not null
    expected_value          text not null
    observed_value          text
    state                   dns_record_state not null default 'missing'
    last_checked_at         timestamptz
    verified_at             timestamptz

    unique (organisation_id, sending_domain_id, record_type, host)

    dns_record_type:  spf | dkim | dmarc | return_path | tracking | rsvp
    dns_record_state: missing | mismatched | valid | error

RLS: enabled, forced.

`expected_value` and `observed_value` sit side by side because the support
question is never "is the domain verified" - `sending_domain.status` answers
that - it is "what exactly did you expect and what exactly did you see". A
customer pasting a DKIM record into the wrong provider's DNS panel is the
common case, and a diff resolves it in one message.

## email_provider_account

ADR 0021. SendGrid first, behind an adapter interface.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    provider                email_provider not null
    subuser_name            text
    api_key_enc             bytea not null              -- 0033, 0049
    webhook_secret_enc      bytea not null              -- 0021, signature
    status                  provider_account_status not null default 'active'
    last_webhook_at         timestamptz                 -- 0016, freshness
    created_at              timestamptz not null default now()
    updated_at              timestamptz not null

    unique (organisation_id, provider, subuser_name)

    email_provider:          sendgrid | mailgun | brevo
    provider_account_status: active | degraded | disabled

RLS: enabled, forced.

The enum already carries Mailgun and Brevo because ADR 0021 requires they be
addable without changing the product model. Listing them costs nothing now and
means the first non-SendGrid customer is not blocked behind an enum migration.

`last_webhook_at` is the webhook-freshness signal ADR 0016 lists as a health
input. Silence from a provider is ambiguous - no bounces, or no delivery of
events - and the gate must not read the first as good news, which is the same
reasoning 0016 applies to low-volume Postmaster data.

Secrets are `bytea` and encrypted under ADR 0033 with keys managed per 0049,
consistent with mailbox tokens in slice 1.

## campaign_health

The append-only series. One row per assessment, and the latest row is the
current state.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    campaign_id             uuid not null -> campaign
    seq                     integer not null

    gate_state              gate_state not null
    previous_gate_state     gate_state
    reason                  text not null
    thresholds_version      integer not null

    auth_ok                 boolean not null
    webhook_lag_seconds     integer
    delivered_rate          numeric(5,4)
    hard_bounce_rate        numeric(5,4)
    deferral_rate           numeric(5,4)
    complaint_rate          numeric(5,4)
    unsubscribe_rate        numeric(5,4)
    sample_size             integer not null
    signals                 jsonb not null default '{}'

    evaluated_at            timestamptz not null default now()

    unique (organisation_id, campaign_id, seq)
    index  (organisation_id, campaign_id, seq desc)
        include (gate_state, evaluated_at)

    gate_state: blocked | warming | eligible | slowed | paused

RLS: enabled, forced.

Rows are never updated or deleted. The gate reads back over recent rows to
apply the recovery hysteresis ADR 0016 requires, which is why the series exists
rather than a mutable row.

`previous_gate_state` is stored even though it is derivable from the preceding
row. It makes a transition self-describing in a single row, so an audit answer
under ADR 0032 - "when did this campaign get paused, and what was it before" -
does not require reconstructing a sequence.

`thresholds_version` records which configured thresholds produced this verdict.
ADR 0016 gives the gate ownership of its thresholds, and thresholds will be
tuned; without this column, a historical assessment cannot be interpreted,
because the numbers it was judged against are gone.

`sample_size` is not optional and belongs beside every rate. ADR 0016 states
that a lack of low-volume Postmaster data must not be read as good reputation,
and the same trap applies to the platform's own rates: two hard bounces out of
three delivered is a 66% bounce rate that means nothing. A rate without its
denominator invites exactly the misreading 0016 warns against.

The promoted columns are the signals the gate evaluates on every pass. `signals`
holds the rest - Postmaster figures, DMARC aggregate summaries, per-bucket
detail - for the same reason `verification_signals` is jsonb in slice 2: the
signal set is external and will change, and no gate decision reads the json.

## provider_webhook_event

ADR 0021 requires signed event-webhook requests be verified before recording.
ADR 0014 requires ingestion be signature-verified, deduplicated, and
replay-safe.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    provider                email_provider not null
    provider_event_id       text not null
    event_type              text not null
    occurred_at             timestamptz not null
    received_at             timestamptz not null default now()

    campaign_id             uuid null -> campaign
    contact_id              uuid null -> contact
    state                   webhook_state not null default 'received'
    payload                 jsonb not null
    processed_at            timestamptz

    unique (organisation_id, provider, provider_event_id)
    index  (organisation_id, state, received_at)
        where state in ('received', 'quarantined')

    webhook_state: received | processed | quarantined | ignored

RLS: enabled, forced. Written by `app_worker` on ingestion.

**The unique constraint is the replay defence.** Deduplication is the
database's job here for the same reason idempotency is in slice 4: a provider
retrying a delivery event twice must not record two hard bounces and suppress a
contact on the strength of a duplicate.

Signature verification happens before insert. An event whose signature does not
verify is not stored - it is rejected at the endpoint and logged - because
storing unverified provider claims in the same table as verified ones means
every downstream reader must remember to filter, and one that forgets is a
forged suppression.

The organisation is resolved from the campaign correlation metadata ADR 0021
attaches, before insert. An event that cannot be resolved to an organisation is
`quarantined` rather than dropped, because a webhook the platform cannot place
is a signal about a bug in correlation, and dropping it destroys the evidence.

`payload` is the provider's own body, retained under a retention window like
the import rejections in slice 2. It carries recipient addresses.

## delivery_bucket_window

ADR 0019's atomic reservations. Same shape as `mailbox_capacity_day` in slice
4, and deliberately so.

    id                      uuid pk
    organisation_id         uuid not null -> organisation
    sending_domain_id       uuid null -> sending_domain
    dimension               throttle_dimension not null
    dimension_key           text not null
    window_start            timestamptz not null

    reserved                integer not null default 0
    consumed                integer not null default 0
    limit_at_reserve        integer not null

    unique (organisation_id, dimension, dimension_key,
            sending_domain_id, window_start)
    check  (reserved >= 0)
    check  (consumed >= 0 and consumed <= reserved)

    throttle_dimension: organisation | sending_domain | delivery_bucket
                      | recipient_domain | provider_api | shared_domain

RLS: enabled, forced. Written by `app_worker`.

ADR 0019 lists several limit dimensions and says the throttle owns atomic
reservations for each, and that workers do not implement their own pacing.
One table with a `dimension` discriminator carries all of them, which is what
makes that ownership real: a new dimension is a new enum value, not a new code
path in a worker.

`dimension_key` is the value within the dimension - a delivery bucket
identifier from slice 2, a recipient domain, an organisation id. It is text
because the dimensions are not the same type, and it is never joined on; it is
matched exactly.

`delivery_bucket` is present as a dimension distinct from `recipient_domain`
because ADR 0019 requires both. Pacing on the domain alone lets fifty
separately named Google-hosted domains consume fifty independent budgets
against one provider that sees a single sender.

`shared_domain` is the dimension that enforces ADR 0018's strict trial cap,
with `dimension_key` set to the organisation holding the allocation. The cap is
therefore enforced by the same mechanism as every other limit rather than by a
special case in the trial path, which is the point: an abuse control that lives
in its own code path is one refactor away from not running.

Reservations are claimed and released exactly as the capacity balance in slice
4 is - `FOR UPDATE` on the window rows, reservation and work written in one
transaction, consumption incremented when the send settles - and carry the same
reconciliation obligation.

## Hosted RSVP and unsubscribe links are not stored

ADR 0016 specifies compact signed tokens on branded domains, and ADR 0011 uses
signed hosted RSVP links for accept, decline, tentative, and add-to-calendar.
There is no token table.

A token is an HMAC over the campaign member identity, the action, and an expiry,
verified on receipt. Storing one row per token would mean 50,000 rows per
campaign per action, written at send time on the hot path, to hold information
already recoverable from the token itself.

The consequence is accepted rather than overlooked: a signed token cannot be
revoked individually. Revocation is by rotating the signing key, which
invalidates every outstanding token for that key, and by the checks that run on
receipt anyway - the campaign must still exist, the member must still be in it,
and suppression is re-evaluated. An unsubscribe link that outlives its campaign
is not a problem; an unsubscribe link that cannot be honoured because its row
was archived is.

The result of following a link is recorded in `invitation_response` from slice
4 with `source = 'hosted_rsvp'`, or as a `suppression_entry` from slice 2 with
`source = 'unsubscribe_link'`. Both already exist.

## Resolved: the slice 6 question

Whether metered usage is read from `invitation_attempt` or accumulated into its
own usage ledger. Answered 2026-09-08, rejecting the framing: **a running
counter for enforcement and a sealed period for evidence**, with the attempt
table remaining the underlying truth while a period is open. ADR 0060.

Usage turned out to be two requirements wearing one word. Enforcement is asked
on the hot path and tolerates being slightly stale; evidence must outlive both
the attempt rows and the prices it was billed under. A per-operation ledger buys
the second by doubling writes on the send path to purchase an immutability
needed only once a month, at period close. The counter is the same
denormalisation as slice 4's capacity balance, with the same reconciliation
obligation; the seal is what capacity does not need, because last month's
mailbox capacity is not a fact anyone will ever query and last month's usage is.

See `06-billing.md`.
