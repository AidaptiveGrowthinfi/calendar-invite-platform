# Model reschedule and cancel as planned, capacity-gated operations

Date: 2026-09-03
Closes: W10
Refs: 0013, 0014, 0019, 0022, 0032, 0040

Rescheduling a campaign is not an update to a row. For a 20,000-contact
campaign it is a second full send cycle: one provider operation per contact,
consuming the same mailbox capacity and the same provider quota as the original
send, and requiring its own capacity plan, throttle budget, and gate
evaluation. Cancelling is the same. Both are modelled as planned work.

The case that shapes the design is reschedule during an in-flight send, which
is the normal case rather than an edge case: a large campaign runs over several
days under a multi-day plan, so when the organiser moves the event, some
contacts already hold an invitation and some have never been sent to. The first
group needs an update; the second needs a create. The schema must make that
split computable.

Decisions:

1. Campaign event details are versioned. A `campaign_revision` carries an
   incrementing sequence number covering title, times, timezone, location, and
   description. A reschedule creates a new revision. This sequence is what the
   iCalendar `SEQUENCE` property in ADR 0022 carries, and what a provider event
   update reflects.

2. Every Invitation Attempt records the revision it carried. The operation
   required for a contact is derived by comparing the highest revision that
   contact has successfully received against the campaign's current revision.
   This is what makes the in-flight split above computable rather than guessed.

3. An Invitation Attempt is one row per operation, not one row per contact.
   Its identity is campaign, contact, operation type, and revision - which is
   ADR 0014's idempotency key. Operation types are `create`, `update`, and
   `cancel`.

   A single mutable row per contact is rejected because it cannot represent a
   succeeded create with a failed update. That state is the most important one
   in the system: the recipient is holding an event at the wrong time, and the
   correct recovery is to retry the update, never to create a second event.

4. Send Plans are immutable and versioned. A reschedule produces a new plan
   version with its own capacity computation and approval rather than mutating
   an approved plan. Per ADR 0032 the plan is audit evidence, and "which
   mailbox was to send to whom, and when" must remain answerable historically.

5. Cancel is a delivery operation, not a deletion. Cancelling plans a `cancel`
   operation for every contact holding a successful create, and none for
   contacts never sent. Those operations are capacity-gated and quota-consuming
   like any other send. No attempt, plan, or contact row is deleted.

6. Reschedule is never modelled as cancel followed by create. That would
   discard the recipient's existing response, change the event UID, and break
   threading in the recipient's calendar client. A reschedule patches the
   stored provider event in place.

7. The provider event identifier is stored per contact on the first successful
   create, because update and cancel are impossible without it. Where a create
   ended in ADR 0014's `unknown` outcome, dependent operations for that contact
   block until reconciliation resolves the outcome. They do not proceed on an
   assumption.

Metering consequence, decided here because it has schema impact: usage is
metered per operation, not per contact. A campaign rescheduled twice consumes
roughly three times the invitations of one sent once, because that is what it
costs in mailbox capacity and provider quota. The plan limit dimensions in ADR
0040 therefore count operations. The projected cost of a reschedule is shown to
the organiser before confirmation, so it is a visible decision rather than a
surprise against a monthly limit.
