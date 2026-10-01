# Read native calendar responses from the provider attendee status

Native Calendar Mode will ingest invitation responses by reading attendee
response state from the calendar providers themselves - Google Calendar
`attendees[].responseStatus` and Microsoft Graph `attendees[].status.response` -
rather than by reading the connected mailbox's incoming mail.

This keeps the platform's Google OAuth scope requirement at `calendar.events`,
which Google classifies as a sensitive scope requiring app verification. Reading
RSVP replies out of the mailbox would require a Gmail scope, which is a
restricted scope and additionally requires an annual third-party CASA security
assessment. The attendee field carries the same product signal at a materially
lower cost in money, review time, and ongoing compliance burden.

Ingestion is incremental, not polled per contact. Workers will use Google
Calendar `events.list` with a stored `syncToken` per connected mailbox, and the
equivalent Microsoft Graph delta query, so only changed events are fetched. A
`410 GONE` expired sync token triggers a full resync for that mailbox rather
than a silent gap. Provider push notifications may be layered on later as a
latency optimisation, but the sync token remains the source of truth because
push channels expire and can be missed.

Response state maps to the platform's own response vocabulary:
`needsAction` to no response, `accepted` to accepted, `declined` to declined,
and `tentative` / `tentativelyAccepted` to tentative. A response is durable
evidence attached to the Invitation Attempt and may arrive at any time,
including after the event, so ingestion must be idempotent and must not assume
responses stop arriving when the campaign completes.

This decision covers Native Calendar Mode only. Calendar Email Mode has no
provider-side attendee record and continues to rely on Hosted RSVP as decided
in ADR 0011.

Accepted limitations: no response signal is available while a mailbox is
disconnected or in `needs_reauth`, and responses recorded directly in a
recipient's own calendar client are only visible once the provider propagates
them to the organiser's event. Both are visible gaps in analytics rather than
silent data loss, and the platform will show response data as
provider-reported with a last-synced timestamp.
