# Require tests on the send path before it ships

Date: 2026-09-03
Closes: W20
Refs: 0014, 0045, 0043, 0019

The v1 codebase declares no test libraries and its test script is the default
placeholder that exits non-zero. The untested code is the send path, which ADR
0014 identifies as the safety-critical component of the system. This ADR states
what must be tested before that path carries real campaigns, so the requirement
is specific rather than an aspiration to "add tests".

The following are required, and are the definition of done for the send engine:

- Idempotency. The same operation identity submitted twice produces one
  provider call and one attempt record. This is ADR 0014's central claim and
  the one whose failure duplicates invitations in a recipient's calendar.
- The unknown outcome. A provider call that times out is recorded as unknown,
  not failed, and does not permit a second create for that contact. A test
  must exercise the timeout path directly, because this is the branch that
  produces duplicate events when it is wrong.
- Reservation under concurrency. Two workers competing for the same contacts
  reserve disjoint sets. Tested against a real PostgreSQL instance, not a mock,
  because the guarantee is the database's.
- Ordering. A reservation exists before any provider call, and a failure after
  the provider call leaves a recoverable record. This is the v1 defect recorded
  as W17b, where the invitation was sent and the database was not updated.
- Revision derivation. Given a contact's highest successfully received revision
  and the campaign's current revision, the operation derived is correct across
  create, update, cancel, and no-op, including the mid-send reschedule case in
  ADR 0045 where some contacts need a create and others an update.
- Suppression. A suppressed contact is excluded both at planning time and
  immediately before provider submission, per ADR 0015.
- Tenant isolation. A query issued without organisation context returns no
  rows, and every organisation-scoped table has row-level security enabled and
  forced, per ADR 0043. This test enumerates tables, so it fails when a new one
  is added without a policy.
- Capacity. Per-mailbox and platform-wide quota reservations are not exceeded
  under concurrent campaigns, per ADR 0047 and 0048.

Provider clients are exercised against recorded fixtures rather than live APIs,
with the error taxonomy from v1 - rate limiting, backend errors, transient
network failures, and authorisation failures - reproduced as fixtures, because
that classification was learned in production and should not be relearned.

This list is a floor, not a ceiling, and applies to the send path specifically.
Ordinary product surfaces are covered by normal judgement.
