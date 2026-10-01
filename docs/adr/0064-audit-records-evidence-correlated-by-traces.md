# Audit records evidence, correlated to system work by traces

Date: 2026-09-08
Refs: 0032, 0035, 0043, 0045, 0046, 0047, 0052, 0061

ADR 0032 requires organisation-scoped audit logs and lists what they cover. The
list mixes two kinds of event without noticing, and taken literally it does not
survive contact with ADR 0047's volumes.

Eleven of its thirteen items are **evidence**: user and role changes, mailbox
connections, sending domain verification, audience imports, campaign approvals,
send plan approval, pauses, unsubscribe and suppression changes, billing
changes, attendance sync, and API key lifecycle. Someone will one day need to
answer who authorised this, when, and whether an obligation was honoured.

Two are **work**: send plan generation, and invitation sends. A single
50,000-contact campaign produces 50,000 send events, 150,000 if it is
rescheduled twice under ADR 0045. Under ADR 0061 nothing is ever deleted, so
that table grows without bound in its least informative dimension.

The cost that decides this is not storage. An audit log's value is that it can
be shown not to have been edited, and a small append-only table can be
hash-chained cheaply. At tens of millions of rows per organisation it remains
theoretically possible and is not built in practice. Logging every send would
trade away the property that makes an audit log an audit log, in exchange for
rows nobody reads.

ADR 0045 has already decided most of this without it being noticed. Decision 4
states that send plans are immutable and versioned and that "per ADR 0032 the
plan is audit evidence, and which mailbox was to send to whom, and when must
remain answerable historically". The plan already is the audit record for
sending. An audit row per send would duplicate a decision already taken.

Decision, in two halves that only work together.

**1. The audit log records evidence.** Machine work stays where it is already
recorded — `send_plan` for what was to be sent, `invitation_attempt` for what
happened to each operation, `attendance_sync_run` for each sync, and ADR 0035's
structured logs and stored provider response codes for per-try detail.
`invitation_attempt` is retried in place and so is not itself an audit trail;
what it holds is the terminal outcome, the mailbox, the try count and the
provider's own error, which is what an auditor asking about a single recipient
actually needs.

**2. A trace links the two.** A trace is opened when an actor makes a decision,
and every record the decision causes carries its identifier — the audit events,
and the work rows in the tables above. Investigating stops being a scan of a
flat log at a timestamp and becomes "show me what this approval set in motion".
This is what makes half 1 acceptable: the audit log stays small without losing
the connection to what the system did with it.

A trace is **one decision and the work it authorised**, not the lifetime of an
object. Approving a campaign opens a trace which its plan, its sends and its
retries all carry. Rescheduling opens a *new* trace, because a person made a
new decision. That boundary is not invented here: ADR 0045 already models a
reschedule as a new plan version with its own approval and its own operations,
so the trace boundary falls exactly where a decision boundary already exists in
the schema. A trace covering a campaign's whole life would degenerate into
`campaign_id`, which the schema already has.

Consequences:

- A trace is **a column on rows that are already written**, never a stream of
  new rows describing each step. The second reading would reintroduce the
  50,000 rows this ADR exists to avoid, wearing a better interface.

- `invitation_attempt` does **not** carry a trace identifier. It carries
  `send_plan_id`, a plan has exactly one trace, so the trace is one join away.
  Adding the column would be a denormalisation on the largest table whose only
  benefit is saving a join on a query a person runs while investigating. An
  index on `(organisation_id, send_plan_id)` is added instead, which that table
  wanted anyway.

- A trace is not ADR 0035's request identifier and the two must not be
  conflated. A request identifier covers one HTTP call. A trace outlives the
  request that opened it by days and spans thousands of background jobs. The
  trace records the request identifier that started it, and that is the entire
  relationship between them.

- Actors are typed, with `system` as an explicit value. A null actor must never
  be read as "the system did it", because it is indistinguishable from having
  lost track of who did. Four kinds occur: a user, a worker, a recipient
  following a link, and a billing provider webhook.

- Events referencing a person hold identifiers, never addresses. Erasure under
  ADRs 0046 and 0055 deletes the contact row and leaves the audit event
  pointing at an identifier that no longer resolves, which is correct and
  costs nothing. An audit log that must be rewritten to satisfy an erasure
  request is not evidence, and this is the same collision 0046 resolved for
  suppression, resolved the same way.

- The chain is per organisation, not per trace. A per-trace chain would let an
  entire trace be removed without detection.

- ADR 0032 is not superseded, but its wording is narrowed: "invitation sends"
  is deliberately not an audit event. A future reader must not find 0032
  half-implemented and helpfully add it. This ADR is the pointer that prevents
  that.
