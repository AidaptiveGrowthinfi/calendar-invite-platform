# Specification: queues, workers, and scheduled jobs

ADR 0012 puts background work on BullMQ; ADR 0013 keeps the truth in
PostgreSQL and leaves Redis only executing. The practical form of that division
is the rule every worker below obeys:

**Redis may be flushed without losing the platform's truth about what was to be
done.** A queue entry is a hint that work exists. The work itself is a row in a
durable state, and a sweeper finds it again if the hint is lost.

Each worker states its trigger, its transaction boundary, what makes it
idempotent, and what happens when it fails. The transaction boundary is the
part that is easy to get wrong and expensive to discover later.

## Queues

| Queue | Concurrency | Notes |
| --- | --- | --- |
| `import` | low | CPU and object storage, not provider-bound |
| `plan` | low | Computation only; approval is synchronous in the API |
| `dispatch` | the throttle decides | The send path |
| `response-sync` | low | Per mailbox, incremental |
| `attendance-sync` | low | Per campaign, after the event |
| `webhook` | medium | Ingestion is already durable; this is processing |
| `health` | low | Gate evaluation |
| `dns` | low | Domain checks |
| `billing` | low | Period seal, provider reconciliation |
| `maintenance` | low | Reconciliation and verification jobs |

Concurrency on `dispatch` is not a queue setting anyone tunes by hand. The
throttle owns pacing (ADR 0019) and workers implement none of their own, so the
queue is drained as fast as reservations are granted and no faster.

## Workers

### `import` — audience import

Trigger: `POST /api/v1/imports/:id/commit`.

Steps, in order: fetch the file by checksum from object storage (OPEN-S4);
parse per `file_format`; apply `column_mapping`; for each row, normalise the
address through the **one** normaliser in `platform/crypto`; look up or create
the `contact`; run MX and provider detection and derive `delivery_bucket`; run
ADR 0025's non-SMTP intelligence; upsert `audience_member`; record rejections.

Transaction boundary: per batch, not per file and not per row. A crashed import
leaves a partially imported audience, which is correct — the rows that landed
are real contacts — and the counters are **recomputed at the end** rather than
incremented per row, so a crash cannot leave `member_count` permanently wrong.

Idempotency: the unique constraint on `(organisation_id, audience_id,
contact_id)`. A re-run updates the snapshot in place and counts the row as
`rows_duplicate`, moving `audience_import_id` to the import that most recently
supplied the values.

Gate: `imported_contact` (flow) is checked at commit, before the job runs, so
an import that would exceed the entitlement is refused with a count rather than
applied halfway.

On failure: `status = 'failed'` with `failure_reason`. The audience returns to
`ready` if it had members before, `failed` if it did not.

Check constraint to respect: `rows_total = rows_imported + rows_duplicate +
rows_rejected`. `rows_held` is a subset of `rows_imported`.

### `plan` — send plan computation

Trigger: `POST /api/v1/campaigns/:id/plans`.

Runs the eligibility query from slice 2 against the audience, derives the
operation per contact from `invitation_attempt` (create / update / cancel /
no-op, ADR 0045 decision 2), assigns mailboxes by provider match and fair share
(ADRs 0020, 0048), and lays operations across days within the window against
each mailbox's current effective ceiling.

Writes a `draft` plan and its projected counts. **It claims nothing.** Capacity
and entitlement are claimed only at approval, in the API's transaction, because
a plan that reserved capacity while sitting unapproved would strand it.

A contact whose latest create is `unknown` produces no operation and blocks
pending reconciliation (ADR 0014).

Mode split: in `native_calendar` mode every item carries a `mailbox_id`; in
`calendar_email` mode none does, and the check constraint enforces that against
`campaign.send_mode`.

### `dispatch` — the send path

This is the safety-critical worker. ADR 0052's list is its definition of done.

Reservation, one statement:

    update invitation_attempt
       set state = 'dispatched', dispatched_at = now(),
           try_count = try_count + 1
     where id in (
       select id from invitation_attempt
        where organisation_id = $org
          and state = 'reserved'
          and (next_retry_at is null or next_retry_at <= now())
        order by reserved_at
        limit $batch
        for update skip locked
     )
    returning *;

`FOR UPDATE SKIP LOCKED` in a subquery is what makes two workers reserve
disjoint sets. It is tested against a real PostgreSQL instance, never a mock,
because the guarantee belongs to the database and a mock would assert only that
the code called it.

Ordering, per attempt, and the order is the specification:

1. Take a throttle reservation for every applicable dimension (ADR 0019).
2. **Re-evaluate suppression** (ADRs 0015, 0039). A contact who unsubscribed on
   Tuesday must not receive an invitation on Thursday.
3. Confirm the derived operation is still correct against the campaign's
   current revision.
4. For `update` and `cancel`: require `campaign_member.provider_event_id` and
   `provider_mailbox_id`. The event lives in that mailbox's calendar and no
   other mailbox can patch it. A null `provider_event_id` blocks.
5. Call the provider.
6. Settle, in **one** transaction: terminal state on the attempt;
   `provider_event_id` and `provider_mailbox_id` onto `campaign_member` on a
   first successful create; `mailbox_capacity_day.consumed += 1`;
   `usage_counter.used += 1`; throttle window `consumed += 1`.

Step 1 before step 5 is W17b, the v1 defect where the invitation was sent and
the database was not updated. The reservation exists before any provider call
and a failure after the provider call leaves a recoverable record.

Outcome mapping:

| Provider result | State | Then |
| --- | --- | --- |
| Success | `succeeded` | Settle as above |
| Permanent rejection | `failed` | Classify, no retry |
| Rate limited | `reserved` | Back off; may set `mailbox.throttle_state` |
| Backend error, transient network | `reserved` | Back off, `next_retry_at` |
| Timeout, no response | **`unknown`** | Do not retry. Reconciliation only. |
| Retries exhausted, or campaign cancelled | `abandoned` | Terminal |

The `unknown` row is the branch that produces duplicate calendar events when it
is wrong. A create that ended `unknown` may have succeeded at the provider, so
`campaign_member.provider_event_id` stays null and every dependent operation
for that contact blocks until reconciliation resolves it. It is never resolved
by retrying.

`abandoned` is distinct from `failed` so that "we stopped trying" is not
recorded as "the provider rejected it" — the difference between a platform
problem and a recipient problem when someone asks six months later.

**OPEN-S2**: the backoff schedule per `error_class`, its ceiling, and the try
count that exhausts to `abandoned` are not decided anywhere. The taxonomy is
fixed (slice 4); the numbers are not.

Calendar email mode routes through `deliverability` for the provider account,
the sending domain, the template and ICS payload (ADR 0022), and the signed
RSVP and unsubscribe links, and records `provider_message_id` instead of
`provider_event_id`.

### `response-sync` — native calendar responses

Trigger: schedule, per active mailbox, plus on demand after a send window.

Incremental via `mailbox.calendar_sync_token` (ADR 0041). A `410 GONE` clears
the token and triggers a full resync rather than leaving a silent gap.

Maps provider vocabulary at the boundary and upserts `invitation_response` on
`(organisation_id, campaign_member_id)`, which is idempotent by construction.
An older `last_response_at` never overwrites a newer one. `last_synced_at` is
written on every run, including one that found nothing, because it is the only
thing distinguishing "nobody has responded" from "we have not been able to ask
since the mailbox needed reauthorisation".

A mailbox in `needs_reauth` is skipped, not failed.

### `attendance-sync`

Trigger: schedule after `campaign_revision.end_local` in its zone, plus
`POST /campaigns/:id/attendance/sync`, plus a manual import upload.

Requires `campaign.attendance_host_account_id`; a campaign without one is
`attendance_state = 'manual'` and is never automatically synced (ADR 0027).

Each run is a new `attendance_sync_run` row, never a mutation of the last.
Fetch participants; write `meeting_attendee` rows as the provider gave them;
match to `campaign_member` by exact email, then exact name; anything weaker or
multiply-matching is `ambiguous` and surfaced rather than guessed. Then upsert
`campaign_member_attendance`.

Metering: on the first run for this campaign reaching `succeeded` or `partial`,
increment `attendance_sync` (flow) and set `metered = true` on that run. The
boolean makes the seal reconstructable and a second charge impossible.

`partial` is terminal and truthful: a truncated participant list is usable data
presented as incomplete, not as complete and not as a failure.

A blank row — neither email nor display name — is counted in
`rejected_row_count` and discarded. It is a blank line in a spreadsheet, not a
contact the customer intended to import.

### `webhook` — provider event processing

Ingestion happened at the endpoint: verified, resolved to an organisation, and
inserted `received` (or `quarantined`). This worker processes what was stored.

Per event: apply the delivery outcome to `contact.bounce_state`,
`bounce_count`, `last_bounce_code`, `complained_at`; add a `suppression_entry`
on a hard bounce or complaint (ADR 0039); feed the campaign health signal; set
`processed_at` and `state = 'processed'` or `'ignored'`.

Idempotent through the unique constraint and through `state`: an event already
`processed` is a no-op. Suppression is idempotent through
`(organisation_id, digest)`, which matters because provider webhooks retry.

`email_provider_account.last_webhook_at` is advanced on every accepted event.
It is a health input, because silence from a provider is ambiguous — no
bounces, or no delivery of events — and the gate must not read the first as
good news.

### `health` — campaign health evaluation

Trigger: schedule per sending campaign, plus on webhook volume, plus on
demand.

Reads authentication state, webhook freshness, and the delivery, bounce,
deferral, complaint and unsubscribe rates with their denominators, then appends
one `campaign_health` row: `gate_state`, `previous_gate_state`, a human
`reason`, `thresholds_version`, and `sample_size` beside every rate.

Recovery applies hysteresis over the recent series (ADR 0016): a campaign does
not resume merely because a worker was retried. While the sending domain is
`warming`, early bounce rate is a hard stop rather than a slow-down (ADRs 0051,
0055).

Rows are never updated or deleted.

**OPEN-S3**: the threshold values. The structure is decided; the numbers are
not, and `thresholds_version` exists so that a historical verdict stays
interpretable once they are.

### `dns` — sending domain checks

Trigger: schedule per domain, plus `POST /sending-domains/:id/verify`.

Checks SPF, DKIM, DMARC, return-path, tracking and RSVP records; writes
`observed_value` beside `expected_value` per record; updates
`sending_domain.status` and `last_checked_at`.

`last_checked_at` is the point of the job. A domain that verified in March and
had its DKIM record removed in June is not verified, and the only thing that
distinguishes the two is when the platform last looked (ADR 0016).

### `billing` — period seal and provider reconciliation

Trigger: schedule, at and after `subscription.current_period_end`.

Seal, in one transaction:

    read usage_counter for (organisation, period_start)
    read plan_entitlement for the subscription's plan_version at period end
    insert usage_period + one usage_period_line per flow dimension
    advance subscription.current_period_start / _end

Idempotent by `unique (organisation_id, period_start)`, so a retried or late
run is a no-op rather than a second invoice. Counter rows are **not** deleted
after sealing.

The lines copy `limit_value` and `is_unlimited` from the entitlement, recording
what the quantity was measured against at seal time — a different fact from
what the plan version says today, and the fact a billing dispute turns on. The
price is not copied, because `plan_version` is immutable and never deleted.

A plan change mid-period seals the current period and opens a new one on the
new version.

## Scheduled jobs

Every job below **alerts on divergence and never self-corrects**. A balance
that quietly repairs itself hides the bug that caused it, and in `billing` it
would also silently restate a customer's bill.

| Job | Checks | Failure consequence |
| --- | --- | --- |
| `sweep-reserved` | Attempts in `reserved` past `next_retry_at` with no queue entry | Silent stall: work that was committed but never enqueued |
| `reconcile-unknown` | Attempts in `unknown`; asks the provider whether the event exists | Contacts blocked indefinitely, or a duplicate if resolved by retry |
| `reconcile-capacity` | `mailbox_capacity_day.committed` against approved `send_plan_item` rows, less releases | Over- or under-admission of the next campaign |
| `reconcile-usage` | `usage_counter.used` against terminal `invitation_attempt` rows in the period | A wrong bill |
| `reconcile-throttle` | `delivery_bucket_window.reserved` against outstanding work | Pacing drift; reputation damage |
| `seal-alarm` | A closed period with no `usage_period` row | **Revenue that does not get billed** |
| `verify-audit-chain` | Recompute every organisation's chain in `org_seq` order | Tamper-evidence lost silently |
| `check-capacity-drop` | Mailboxes whose ceiling fell below what is committed | A shortfall discovered at send time |
| `refresh-tokens` | Mailbox and host-account tokens near expiry | Mass `needs_reauth` mid-campaign |
| `stale-webhook` | `email_provider_account.last_webhook_at` beyond threshold | Health read from absent data |

`seal-alarm` runs on a schedule that leaves a person time to act before the
invoice is due. It is the same obligation shape as `reconcile-capacity` with a
sharper consequence: a divergent capacity balance is a bug, an unsealed period
is money.

`verify-audit-chain` walks an organisation's events in `org_seq` order and
recomputes each hash. A mismatch identifies the first altered or missing row.
It alerts; a chain that silently re-links is a chain that hides the edit it was
built to reveal.

`check-capacity-drop` exists because a mailbox that throttles or drops to
`needs_reauth` reduces capacity **already committed** under ADR 0058. The
affected plans are re-evaluated and the organiser is told; the row records the
overcommit rather than hiding it.

### The two jobs that delete

ADR 0065, narrowing ADR 0061. These are the **only** jobs in the system that
delete anything on a schedule, and they are named here so that a third is a
decision rather than a pattern being followed.

| Job | Clears | Keeps |
| --- | --- | --- |
| `clear-import-payloads` | `audience_import_rejection.raw_row`, and the uploaded file in object storage | The rejection row: `source_row_number`, `reason`, `reason_detail`. What was rejected and why is product data under ADR 0061 and does not expire. |
| `clear-webhook-payloads` | `provider_webhook_event.payload` | The event's identity, type, `occurred_at`, correlation and `state`. Deduplication still works after the payload is gone, which is what the unique constraint is on. |

Both clear a **column**, never a row. This is the same separation ADR 0046
makes between a suppression record and the address that produced it, and it is
what keeps ADR 0061's guarantee intact: the customer's own record of what
happened survives, and only the raw text the platform no longer needs does not.

The window length is configuration, not a migration, and it is a privacy-policy
line rather than a schema fact (ADR 0065). **It is not a plan dimension and
must never become one** — that is precisely what ADR 0061 forbids.

Neither job touches product data, and neither is the erasure path. Erasure is
request-driven and belongs to ADRs 0046 and 0055.

## Where `app_worker` is used, and where it is not

`app_worker` holds `BYPASSRLS` and is used **only** for:

- The dispatcher's choice of which organisation's work runs next.
- Shared provider quota accounting against the Cloud project.
- Reading the platform-owned `sending_domain` behind a
  `shared_domain_allocation`.

Everything else — the entire per-organisation body of every job above — runs
inside `withOrg()` as `app_user`, under RLS. A worker that has selected an
organisation has tenant context and has no reason to bypass anything.
