# Meter usage with a running counter and a sealed billing period

Date: 2026-09-08
Refs: 0029, 0030, 0031, 0040, 0043, 0045, 0052, 0058, 0059

ADR 0031 requires the platform to meter usage internally. ADR 0040 fixes the
dimensions it meters. Neither says where the meter's numbers live, and there is
an obvious argument that they need not live anywhere: ADR 0045 already writes
one `invitation_attempt` row per operation, and 0040 counts operations, so
every fact the meter needs is on disk and a derived count cannot drift.

That argument fails, but not for the reason it first appears to. It fails
because "usage" is two requirements wearing one word.

**Live enforcement** answers "is this organisation within its plan right now",
is asked on paths that must not be slow, and tolerates being a few operations
stale. **Billing evidence** answers "what did this organisation owe for March
2027", is asked rarely, must be answerable years later under the plan and
prices then in force, and must survive whatever retention ADR 0040's retention
dimension eventually applies to attempts. A derived count over a table subject
to retention satisfies the first and cannot satisfy the second.

Decision: meter with two mechanisms, each sized to its requirement.

1. **A running usage counter** — one row per organisation, per billing period,
   per metered flow dimension — incremented in the same transaction that
   settles the operation it counts. This is the same denormalisation as ADR
   0058's capacity balance, taken for the same reason, and it carries the same
   reconciliation obligation: its invariant against `invitation_attempt` is
   checked by a scheduled job and by a test under ADR 0052, and a divergence
   alerts rather than self-correcting.

2. **A sealed billing period** — written once at period close, immutable
   afterwards, recording the quantity for each dimension, the entitlement it
   was measured against, and the plan version in force. This, not the counter
   and not the attempt table, is the billing record. Once sealed, a period's
   numbers do not change if attempts are later pruned, if a plan is repriced,
   or if the counter is found to have drifted — a drift discovered after a seal
   is corrected by an adjustment, visibly, not by rewriting history.

Only flow dimensions are metered. ADR 0040's list mixes three kinds, and
treating them alike would build machinery for dimensions that do not need it:

- Flow dimensions accumulate over a period — native invites, calendar email
  invites, imported contacts, attendance syncs, shared trial-domain sends.
  These get a counter and a sealed line.
- Stock dimensions are a ceiling on what currently exists — team seats,
  connected mailboxes, sending domains, API keys. These are enforced by
  counting live rows at the moment one is created. The count is small, the
  event is rare, and a counter here would be a drift risk bought for nothing.
- Retention period is not a limit at all. It is a configuration value the
  retention job reads from the entitlement.

The flow gate is taken where ADR 0058's capacity gate is already taken. A
campaign's projected operation count is checked against the organisation's
remaining entitlement at approval, in the same transaction as the capacity
admission, and refused with its shortfall in the same way. Per-send increments
are then bookkeeping rather than a gate. This follows from 0058's own
reasoning: a campaign that will exhaust the plan's monthly invites two thirds
of the way through is the same failure as one that will exhaust its mailbox
capacity, and it should be refused at the same moment, not discovered on the
morning of the webinar. ADR 0045 already requires the projected cost of a
reschedule be shown before confirmation; this is where that number comes from.

Consequences:

- The seal becomes billing-critical infrastructure. A period that is not sealed
  cannot be invoiced, so an unsealed closed period alerts. The seal is
  idempotent — one period per organisation, enforced by a unique constraint —
  so a late or retried run is safe.
- Plan versions are immutable and are never pruned. Immutability is enforced by
  a trigger rejecting update and delete, not by convention, for the reason ADR
  0043 gives about conventions: a rule that lives only in review is a rule that
  eventually does not run. The sealed period therefore references its plan
  version rather than copying its price, and prices in force at the time remain
  answerable through that reference.
- Entitlements are read from the local plan version, never from the billing
  provider, which is ADR 0030 restated as a schema rule. A Razorpay webhook
  changes the subscription's plan version; until it does, the local row governs
  product behaviour, and a provider outage changes nothing a user can see.
- Repricing creates a new plan version. It never edits an existing one, which
  is ADR 0054's rule about decisions applied to prices, for the same reason.
- The counter row is per organisation per period per dimension, which makes it
  hotter than the per-mailbox-per-day capacity row it sits beside. At ADR
  0047's volumes this does not matter and the arithmetic is worth stating
  rather than waving away: 50,000 operations settled inside a single day is
  under one update per second to that row, against a single-row update rate
  Postgres serves in the thousands. If a future volume changes that, the fix is
  to shard the counter, not to abandon it.
- No cache, per ADR 0059. The counter is the fast read; that is its job.

Amended by ADR 0061 (2026-09-08): data is retained indefinitely, so this
decision's argument that billing evidence must outlive attempt retention no
longer holds. The seal stands on its two remaining justifications - the plan
version in force during a past period is not otherwise reconstructable, and a
bill must not restate itself when attempts are corrected after the fact.
