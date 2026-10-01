# Specification: the HTTP surface

Four entry points, with different authentication and different rules. They are
listed separately because conflating them is how an unauthenticated webhook
path ends up inside the session-authenticated router.

| Surface | Prefix | Auth | Role | Runs as |
| --- | --- | --- | --- | --- |
| Dashboard | `/api/v1` | Better Auth session | user | `app_user` in `withOrg()` |
| Programmatic | `/api/v1` | `Authorization: Bearer gi_...` | api_key | `app_user` in `withOrg()` |
| Public | `/r`, `/u` | Signed token | recipient | `app_user` in `withOrg()` |
| Webhooks | `/hooks` | Provider signature | provider | `app_worker`, then `withOrg()` |

Validation is Zod at every boundary (ADR 0008), from `packages/shared`, so the
dashboard and the API validate against the same schema.

Paths and payload fields use `CONTEXT.md` vocabulary. `audience`, not `list`.
`contact`, not `recipient` or `lead`. `mailbox`, not `sending account`. This is
binding on the wire format, because a URL is the hardest thing in the product
to rename later.

## Conventions

- `POST` for anything that opens an audit trace. Every such response returns
  the `trace_id`, so a support conversation can start from a response body.
- Refusals that carry evidence — admission shortfall, entitlement shortfall,
  import rejections — return `409` with a typed body, never a bare `400`. The
  organiser needs to see that Thursday is short by 1,400 before choosing
  between connecting a mailbox, cutting the audience, and moving the event.
- Cursor pagination on every collection. `50,000`-contact audiences exist.
- Idempotency: a client-supplied `Idempotency-Key` header on `POST` where a
  double submission has a cost. The database constraint is still the guarantee
  (slice 4); the header is a convenience that turns a duplicate into the
  original response rather than an error.
- No endpoint returns another organisation's data, and the mechanism is RLS,
  not a `where` clause the handler remembered (ADR 0043).

## Dashboard API

### Organisation and access

    GET    /api/v1/organisation
    PATCH  /api/v1/organisation                name, slug, timezone (W29)
    GET    /api/v1/organisation/members        via Better Auth
    POST   /api/v1/organisation/members        invite; counts team_seat (stock)
    DELETE /api/v1/organisation/members/:id
    PATCH  /api/v1/organisation/members/:id    role change

Role changes emit `role_granted` / `role_revoked` in an `access_change` trace.

    GET    /api/v1/api-keys
    POST   /api/v1/api-keys                    counts api_key (stock)
    DELETE /api/v1/api-keys/:id                sets revoked_at; never deletes

`POST` returns the key **once**, in full, and never again. The response also
carries `key_prefix`, which is all any later read returns. Emits
`api_key_created`; the delete emits `api_key_revoked`.

### Mailboxes

    GET    /api/v1/mailboxes
    POST   /api/v1/mailboxes/connect/:provider   -> provider consent redirect
    GET    /api/v1/mailboxes/callback/:provider  <- consent return
    DELETE /api/v1/mailboxes/:id                 disconnect
    POST   /api/v1/mailboxes/:id/reauth          re-consent for needs_reauth

`connect` counts `connected_mailbox` (stock) **before** the redirect, so a
customer is not sent through a consent screen to be refused on return.

Emits `mailbox_connected` / `mailbox_disconnected` in a `connection_change`
trace, with the granted scopes in `detail`.

### Audiences and imports

    GET    /api/v1/audiences
    POST   /api/v1/audiences
    GET    /api/v1/audiences/:id
    GET    /api/v1/audiences/:id/members         cursor paginated

    POST   /api/v1/audiences/:id/imports         upload, returns import id
    POST   /api/v1/imports/:id/mapping           column mapping, ADR 0024
    POST   /api/v1/imports/:id/commit            starts the import job
    GET    /api/v1/imports/:id                   status and the five counters
    GET    /api/v1/imports/:id/rejections        cursor paginated
    GET    /api/v1/imports/:id/rejections.csv    the rejected-row download

Upload, mapping and commit are three calls because ADR 0024's mapping is a
decision the customer takes after seeing their own headers. The import job
begins at `commit` and nowhere else.

`commit` gates `imported_contact` (flow) and refuses with a count rather than
applying half the file. Emits `audience_imported` in an `audience_import`
trace, whose `trace_id` is written onto `audience_import`.

A duplicate `checksum_sha256` is **reported**, not blocked: re-uploading a
corrected file under the same name is normal, and a genuine re-upload of an
identical file is idempotent once deduplication runs.

    GET    /api/v1/audiences/:id/members?review_state=pending
    POST   /api/v1/audience-members/:id/review   approved | rejected

ADR 0024's borderline review. The planner excludes `pending` and `rejected`.

### Suppression

    GET    /api/v1/suppression                  masked addresses only
    POST   /api/v1/suppression                  manual add
    DELETE /api/v1/suppression/:id              manual removal

The list returns `masked_address` and never an address, because the platform
does not hold one (ADR 0046). Both writes emit `suppression_added` /
`suppression_removed`.

Erasure is deliberately not a self-serve endpoint in the MVP; it is a
support-assisted operation, and slice 7 records that an erasure naming an
uninvited attendee has no handle the schema can find.

### Campaigns

    GET    /api/v1/campaigns
    POST   /api/v1/campaigns                    creates campaign + revision seq 1
    GET    /api/v1/campaigns/:id
    PATCH  /api/v1/campaigns/:id                name, send_mode, meeting fields
    POST   /api/v1/campaigns/:id/revisions      reschedule or detail_change
    GET    /api/v1/campaigns/:id/revisions

A revision `POST` takes `reason` explicitly rather than inferring it from which
fields changed. Both reasons advance `seq`; only the organiser knows whether
moving an event by ten minutes is a reschedule. Emits into a
`campaign_reschedule` trace, whose id is written onto `campaign_revision`.

    POST   /api/v1/campaigns/:id/plans          compute a plan (draft)
    GET    /api/v1/campaigns/:id/plans
    GET    /api/v1/plans/:id                    items, per-day, per-mailbox
    POST   /api/v1/plans/:id/approve            THE transaction
    POST   /api/v1/campaigns/:id/pause
    POST   /api/v1/campaigns/:id/resume
    POST   /api/v1/campaigns/:id/cancel

`POST /plans` computes and returns the projected operation count and its cost
against both gates **without committing** — this is the number ADR 0045
requires be shown before a reschedule is confirmed, and running the gate at
approval is what lets the projection be truthful rather than optimistic.

`approve` is the single transaction described in `01-modules.md`. On refusal it
returns `409` with `admission_shortfall`: the per-day, per-mailbox deficit, and
which of the two gates refused. The plan is persisted as `refused`.

`resume` cannot succeed merely because it was called — ADR 0016's hysteresis
reads back over `campaign_health`, and a campaign paused by the gate resumes
only when the gate says so.

### Deliverability

    GET    /api/v1/sending-domains
    POST   /api/v1/sending-domains              counts sending_domain (stock)
    GET    /api/v1/sending-domains/:id          incl. DNS records, expected vs observed
    POST   /api/v1/sending-domains/:id/verify   triggers a check now
    DELETE /api/v1/sending-domains/:id

    GET    /api/v1/campaigns/:id/health         latest row + recent series
    GET    /api/v1/email-provider-accounts
    POST   /api/v1/email-provider-accounts

The domain detail response puts `expected_value` beside `observed_value` per
record, because the support question is never "is the domain verified" but
"what exactly did you expect and what exactly did you see".

`verify` emits `domain_verified` in a `domain_verification` trace when it
succeeds.

### Attendance and results

    GET    /api/v1/meeting-host-accounts
    POST   /api/v1/meeting-host-accounts/connect/:provider
    GET    /api/v1/meeting-host-accounts/callback/:provider
    DELETE /api/v1/meeting-host-accounts/:id

    POST   /api/v1/campaigns/:id/attendance/sync     automated run
    POST   /api/v1/campaigns/:id/attendance/import   manual file, ADR 0026
    GET    /api/v1/campaigns/:id/attendance/runs
    GET    /api/v1/campaigns/:id/attendance/unmatched
    POST   /api/v1/meeting-attendees/:id/match       resolves ambiguous

    GET    /api/v1/campaigns/:id/results

`results` returns the six segments, `no_show` as an explicitly labelled rollup,
the uninvited-attendee count as its own number, and `last_synced_at`. It never
returns a segment list containing both `no_show` and its members (W27).

Both sync paths emit `attendance_synced`, whose trace id is written onto
`attendance_sync_run`.

### Billing

    GET    /api/v1/plans                        the catalogue, public product info
    GET    /api/v1/subscription                 plan, status, period, entitlements
    GET    /api/v1/usage                        current counters against limits
    GET    /api/v1/usage/periods                sealed periods
    GET    /api/v1/usage/periods/:id            lines, with the limits as measured
    POST   /api/v1/subscription/checkout        -> Razorpay
    POST   /api/v1/subscription/cancel          sets cancel_at_period_end

`GET /usage` reads `usage_counter`, which is the fast read (ADR 0059 — there is
no cache and none is needed).

### Audit

    GET    /api/v1/audit/traces
    GET    /api/v1/audit/traces/:id             events + the work rows it caused
    GET    /api/v1/audit/events

Reconstructing a trace is a handful of indexed reads merged in the application:
the trace row, its events, and the work rows in the five tables carrying
`trace_id` — `audience_import`, `campaign_revision`, `send_plan`,
`attendance_sync_run`, `usage_period`. `invitation_attempt` reaches its trace
through `send_plan_id` in one join, deliberately.

Slice 8 says there is no audit UI in the MVP. These endpoints exist because the
API is how support answers a question; the screens are not in scope.

## Programmatic API

ADR 0034. Same paths, same handlers, different authentication.

`Authorization: Bearer gi_<base62(organisation_id)>_<secret>`. Authentication
parses the prefix, opens `withOrg()` on that organisation, and reads the digest
of the whole presented key as `app_user` under RLS. A forged or altered
organisation reference selects zero rows.

**Scope enforcement is OPEN-S1.** `api_key.scopes` is `text[]` with the
vocabulary undefined, and an empty array means full access within the
organisation. Until a vocabulary is decided, keys are issued with an empty
array and every authenticated key reaches every endpoint its organisation can.
The middleware seam exists from the first version so that adding scopes later
is a decision and a migration, not a refactor.

## Public pages

Backend-rendered (ADR 0056), served both from the platform's own host and from
a customer's `rsvp_host` / `tracking_host` where configured (ADR 0016).

    GET    /r/:token                accept | decline | tentative | add-to-calendar
    POST   /r/:token                records the response
    GET    /u/:token                unsubscribe confirmation
    POST   /u/:token                records the suppression
    GET    /r/:token/calendar.ics   add-to-calendar

The token is an HMAC over the campaign member identity, the action, and an
expiry (slice 5). There is no token row to look up. On every request, in order:

1. Verify the signature and the expiry.
2. Resolve the organisation from the token and open `withOrg()`.
3. Confirm the campaign still exists and the member is still in it.
4. Re-evaluate suppression.
5. Act, inside a `recipient` audit trace.

Step 3 and step 4 are what make step 1's un-revocability acceptable. An
unsubscribe link that outlives its campaign is not a problem; an unsubscribe
link that cannot be honoured is.

An unsubscribe is a `POST`, never a bare `GET`, because mail scanners follow
links. The `GET` renders a confirmation.

## Webhooks

    POST   /hooks/email/:provider    SendGrid first (ADR 0021)
    POST   /hooks/billing/razorpay   ADR 0029

**Signature verification happens before anything is written.** An event whose
signature does not verify is rejected at the endpoint and logged, never stored
(slice 5).

The organisation is resolved from the correlation metadata ADR 0021 attaches,
before insert. An event that cannot be resolved is written `quarantined` rather
than dropped, because a webhook the platform cannot place is a signal about a
bug in correlation.

Both endpoints return `2xx` as soon as the event is durably recorded and
process asynchronously. A provider that retries because processing was slow is
a provider that delivers the same event twice, and the unique constraint on
`(organisation_id, provider, provider_event_id)` is the replay defence — a
retried delivery event must not record two hard bounces and suppress a contact
on the strength of a duplicate.

Razorpay events open a `billing_change` trace with `actor_type =
'billing_provider'` and emit `subscription_changed`. They update
`subscription`; they never gate the send path, which reads only local
entitlements (ADR 0030).

## Health

    GET    /health/live
    GET    /health/ready     API, worker, Redis, PostgreSQL (ADR 0035)

Unauthenticated, and returns no tenant data.
