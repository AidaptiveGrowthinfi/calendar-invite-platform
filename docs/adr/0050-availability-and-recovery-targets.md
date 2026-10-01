# Set availability and recovery targets

Date: 2026-09-03
Closes: W11
Refs: 0035, 0036

The documents describe contacts, send plans, invitation attempts, provider
event identifiers, audit logs, suppression state, and attendance records as
product-critical, while running a single VPS with daily backups and no stated
recovery target. Daily backups alone imply a recovery point objective of up to
24 hours, which for send state means losing a day's record of who was already
invited - and re-sending to them, because the attempt rows are gone while the
calendar events are not.

Targets:

    RPO   <= 15 minutes, via WAL archiving and point-in-time recovery
    RTO   <= 4 hours, by manual restore
    No high-availability claim is made anywhere in the product or its marketing.

Continuous WAL archiving to off-VPS storage is added to the daily base backups
ADR 0036 already requires. The 15-minute objective is what archiving intervals
give without continuous streaming replication, which a single-VPS deployment
does not have.

The four-hour recovery objective assumes a human is available and the restore
procedure has been rehearsed. It is a manual restore of a single host, so it is
achievable but not automatic, and it is honest about that: this is a
single-server deployment with a documented recovery path, not a fault-tolerant
one. The restore testing in 0036 is what makes the number real rather than
aspirational, and a restore test that has not run within the retention window
invalidates this target.

The single VPS remains a single point of failure. That is accepted for the
current stage and is the first thing to revisit when either customer
commitments or revenue justify a standby.
