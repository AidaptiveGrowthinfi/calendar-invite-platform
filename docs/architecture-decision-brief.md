# Calendar Invite Campaign Platform - Architecture Decision Brief

This document summarizes the major product and technology decisions from the planning session. It is meant to be easy to explain to founders, product, engineering, and future team members.

## Product Direction

We are building a calendar invite campaign platform for webinar and event teams. The product helps customers send calendar invitations at scale, track responses, measure actual attendance, and follow up with the right audience segments.

The core technical challenge is not a normal dashboard. The hard parts are reliable send planning, provider limits, high-volume delivery, idempotent retries, attendance matching, deliverability, and auditability.

## Recommended Stack

| Area | Decision | Why |
| --- | --- | --- |
| Frontend | Next.js + TypeScript | Good fit for dashboard-heavy SaaS workflows such as campaign builder, audience import, send-plan review, analytics, and admin screens. |
| Backend | NestJS + TypeScript | Gives a two-person team strong structure for modules, provider clients, auth guards, workers, and tests. |
| Repo | pnpm monorepo | Keeps web, API, workers, shared schemas, and docs together while preserving clear boundaries. |
| Database | PostgreSQL | Owns durable product truth: campaigns, contacts, send plans, attempts, audit logs, billing limits, and attendance records. |
| ORM | Drizzle ORM | A typed SQL builder rather than an ORM with a query engine. Raw SQL is first-class, which suits a system whose hard paths are reservation locking, capacity counters, bulk import, and reconciliation. Declares row-level security policies and roles alongside the tables. |
| Jobs | BullMQ + Redis | Fits background work such as verification, send planning, invite sending, retries, throttling, attendance sync, and follow-up. |
| Validation | Zod | Shared schemas across frontend, backend, imports, and tests. |
| Auth | Better Auth | Handles app users, sessions, organisations, and role-based access. |
| Billing | Razorpay first | Better default for an India-based SaaS than Stripe, with Stripe kept as a future adapter. |
| Deployment | GitHub Actions + Docker Compose on VPS | Free, simple, and maintainable for a small team. |
| Observability | Sentry + structured logs | Needed because many failures happen asynchronously in workers and external providers. |

## Architecture Shape

We chose a modular monolith with background workers.

That means one backend application with clear internal modules, plus worker processes for slow or risky work. We are not starting with microservices because the team is small and the product boundaries are not stable yet.

Runtime shape:

- web
- api
- worker
- postgres
- redis
- caddy/nginx

The send plan lives in PostgreSQL. BullMQ only executes work derived from that plan. This keeps Redis from becoming the only place that knows who still needs an invitation.

## Sending Modes

We decided to implement both send modes in the MVP.

### Native Calendar Mode

Uses:

- Google Calendar API
- Microsoft Graph Calendar

Why:

Native calendar APIs give stronger event lifecycle control: create, update, cancel, track provider event IDs, and manage calendar-native behavior.

Native Calendar Mode is for expected, lower-volume event invitations sent from a real connected organiser mailbox. It is not a mechanism for bypassing mail-provider bulk-sending controls. Each contact receives a private invitation identity; the platform never exposes a campaign audience as an event attendee list.

Important rule:

Sending volume is capacity-gated.

The platform should not promise "50,000 invites in one day" for everyone. It should calculate what the customer's connected mailboxes can safely support and produce a same-day or multi-day plan.

### Calendar Email Mode

Uses:

- SendGrid first
- Mailgun/Brevo later through adapters

Why:

Calendar Email Mode sends email with calendar invite payloads. It can support much higher volume than native calendar APIs, but it needs stronger deliverability controls and our own tracking layer.

The app owns the calendar email templates and `.ics` generation. SendGrid is only the delivery pipe.

We will generate:

- HTML email
- plain-text email
- .ics calendar payload
- stable UID
- METHOD:REQUEST / CANCEL
- SEQUENCE
- ORGANIZER
- ATTENDEE
- timezone fields
- tracking tokens

## Deliverability

Deliverability is a first-class product feature, not an afterthought.

Calendar Email Mode must include:

- per-organisation sending domains
- SPF/DKIM/DMARC verification
- custom return-path
- branded tracking domain
- hosted RSVP domain
- one-click unsubscribe support
- bounce and complaint webhooks
- suppression enforcement
- warm-up limits
- adaptive throttling
- provider health checks
- Gmail Postmaster and DMARC aggregate-report monitoring
- recipient provider/MX delivery buckets
- per-organisation provider isolation and abuse controls
- signed, replay-safe webhook processing
- campaign health circuit breakers

We will not randomly rotate Google, Outlook, SendGrid, Mailgun, and Brevo to avoid spam filters. That can look like reputation evasion. Instead, we will use a provider router.

Provider routing will be based on:

- send mode
- verified organisation configuration
- provider health
- warm-up state
- rate limits
- failover rules
- deliverability signals

## Tracking and RSVP

Calendar Email Mode needs hosted RSVP tracking.

Each email should contain signed, branded links:

- Accept
- Decline
- Maybe
- Add to Calendar

This lets us reliably track user intent even when Gmail, Outlook, Apple Calendar, or other clients do not send native RSVP data back consistently.

We track:

- sent
- delivered
- bounced
- opened, best-effort
- accepted
- declined
- tentative
- no response
- unsubscribed
- attended
- accepted but did not attend

## Send Engine

Large sends must be visible, resumable, and idempotent.

Every invite operation uses a stable idempotency key based on identity, not timestamp.

Recommended identity:

- campaign_id + contact_id + operation_type

Calendar UID should also be stable:

- campaign_id + contact_id + product_domain

Timestamps are metadata only:

- created_at
- updated_at
- sent_at
- accepted_at
- cancelled_at

The send engine must support:

- per-mailbox limits
- per-provider limits
- per-recipient-domain and recipient-provider/MX-bucket pacing
- adaptive throttling
- jitter
- provider backoff
- retry safety
- durable send reservation, outbox, and reconciliation
- dashboard progress
- pause/resume behavior
- stored provider event IDs

## Audience Import and Email Verification

MVP audience import supports CSV and XLSX only.

It includes:

- column mapping
- deduplication
- email normalization
- recipient verification
- provider detection
- suppression check
- invalid/disposable exclusion
- borderline review
- rejected-row download

For verification, we chose non-SMTP email intelligence first.

Default checks:

- syntax validation
- DNS/MX lookup
- Google/Microsoft/other provider detection
- disposable domain check
- role email detection
- typo suggestions
- prior bounce history
- risk score

This does not require outbound port 25.

The existing `mailVerify` repo is kept as Option B for deeper SMTP verification, but it is not required for the default flow.

## Attendance

Attendance tracking should be automated in MVP.

Supported providers:

- Zoom
- Microsoft Teams
- Google Meet

Each campaign has one meeting provider and one meeting reference.

The meeting host account must be connected for automated attendance sync. If the user only pastes a meeting link and does not connect an authorised host account, the system falls back to manual CSV/XLSX import.

The platform will not create meetings in MVP. Customers use existing meeting links. This avoids meeting scheduling complexity and keeps the product focused on invite campaigns and attendance proof.

## Billing

Razorpay is the first billing provider.

Why:

The business is India-based, and Razorpay is a better default for Indian payment methods, subscriptions, payment links, and local onboarding.

Billing architecture:

- Razorpay = money state
- Our app = product entitlements and usage limits

The app owns:

- team seat limits
- connected mailbox limits
- native calendar invite limits
- calendar email volume limits
- attendance sync access
- sending domain limits
- shared trial-domain limits

We will use simple plan tiers first, not usage-based billing. Exact plan names, prices, and numeric limits can be decided later by the product owner, but the architecture will meter team seats, connected mailboxes, sending domains, monthly native calendar invites, monthly calendar email invites, monthly imported contacts, attendance syncs, shared trial-domain sends, API keys, and retention period for logs and analytics.

## Security

Security decisions confirmed:

- provider tokens encrypted at rest
- scoped API keys for programmatic access
- audit logs from day one
- tenant scoping on product data, enforced at the database
- tenant isolation enforced by PostgreSQL row-level security
- unsafe raw SQL banned
- parameterized raw SQL allowed only where needed
- dependency updates and security alerts required

Provider tokens include Google, Microsoft, Zoom, Teams, Google Meet, SendGrid, Razorpay, and future integrations.

API keys should be:

- hashed at rest
- shown only once
- scoped
- expiring where needed
- rate-limited
- revocable
- audited
- tracked with last-used metadata

## CI/CD and VPS

Deployment decision:

- GitHub Actions builds and tests
- Docker images are pushed to registry
- GitHub Actions SSHs into VPS
- Docker Compose pulls and restarts services

We will use staging before production.

Recommended branches:

- develop -> staging
- main -> production

Production must include:

- daily encrypted PostgreSQL backups
- off-VPS backup storage
- backup alerts
- restore testing
- health checks
- Sentry
- structured logs

## Updated Product Decision

### Consent Source

Decision:

The platform will not require a consent source before contacts can be imported, planned, or sent campaign invitations.

Why:

The product should keep campaign automation lightweight and avoid blocking sends on an extra audience-origin field.

Tradeoff:

Removing consent source increases reliance on deliverability controls, suppression handling, bounce and complaint monitoring, rate limits, and customer responsibility for lawful audience use.

This decision does not alter the product's intended use: campaigns are sent to audiences for which the customer already has permission to contact. The platform records delivery and opt-out evidence, but does not require a separate consent-source field as a launch prerequisite.

### Unsubscribe and Suppression

Decision:

When a contact unsubscribes from an organisation's campaigns, the platform permanently suppresses that contact for that organisation and prevents future sends across both native calendar mode and calendar email mode.

Why:

This prevents accidental re-contact through future imports, retries, follow-ups, or a different sending channel, and protects sender reputation.

## Open Decisions

Tracked in `open-decisions.md`, which is the single source. Findings still being
worked are in `architecture-review-findings.md`.

## Simple Explanation for the Team

The simplest way to explain the decision:

We are building a serious calendar campaign SaaS, not a basic email blaster.

The MVP will support both native Google/Microsoft calendar sending and high-volume calendar email sending through SendGrid.

Native mode gives better calendar control but is limited by mailbox capacity.

Calendar email mode gives scale, but needs deliverability controls, branded tracking, hosted RSVP, and careful throttling.

Postgres owns the truth. Redis/BullMQ runs jobs. GitHub Actions deploys Docker Compose to the VPS.

Razorpay handles billing, but our app owns plan limits.

The risky parts are sending reliability, deliverability, attendance sync, and auditability, so those are designed into the MVP from day one.
