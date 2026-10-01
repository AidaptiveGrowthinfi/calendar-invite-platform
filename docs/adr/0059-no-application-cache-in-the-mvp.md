# Do not add an application cache in the MVP

Date: 2026-09-07
Refs: 0002, 0012, 0013, 0019, 0047, 0058

ADR 0002 says Redis is for "queueing, retries, backoff delays, and worker
coordination only" and will not own product-critical truth. It does not say
whether Redis may also be used as an application cache, and the omission is
the kind that gets resolved six months later by someone adding a `redis.get`
to a hot path. It is resolved here: no application cache in the MVP, and the
conditions under which one may be added are stated so the answer is a decision
rather than a habit.

## Why not

The send path's correctness properties are all properties of one PostgreSQL
transaction.

ADR 0058's capacity balance is trustworthy specifically because it is written
in the same transaction as the plan rows it counts, so no reader can observe
the two disagreeing. ADR 0014's idempotency is a unique constraint, enforced at
insert. Suppression is a join, evaluated immediately before provider submission
per ADR 0015. Each of these becomes false the moment a copy of it lives
somewhere the transaction does not reach. The failure modes are not slow pages:
they are a second calendar event in a recipient's calendar, and an invitation
sent to someone who unsubscribed.

The throttle in ADR 0019 is the case that most looks like a Redis workload -
high-frequency counter increments across several limit dimensions. It stays in
PostgreSQL anyway. 0019 gives the throttle ownership of atomic capacity
reservations, and 0002 forbids Redis owning product-critical truth. A
reservation lost to a Redis restart means over-sending, which throttles the
customer's own Workspace - the customer-visible, customer-damaging failure
ADR 0047 exists to prevent.

Scale does not argue for a cache either. Both tiers are self-hosted on one VPS
under ADR 0006, so PostgreSQL is a local socket away with no network hop, and
MVP read volume is far below where a cache pays for its invalidation bugs.

## What is not affected

Redis and BullMQ keep exactly the remit ADR 0002 and 0012 give them: queues,
retries, backoff, worker coordination, and the scheduling of the jobs in ADR
0012's list. BullMQ's own internal state is not a cache and is not at issue.

This ADR also does not concern the browser. HTTP caching headers, and whatever
the React application holds in memory during a session, are outside it.

## When a cache may be added, and in what order

The real pressure will come from dashboard aggregates - counting invitation
attempts by state across a 50,000-contact campaign on every page load. That is
a genuine cost and it is not a Redis problem first. In order:

1. Fix it in PostgreSQL: an index, or a better query.
2. Maintain a counter inside the transaction that changes it, which is the
   pattern ADR 0058 already establishes for the capacity balance.
3. Only then a cache, and only for a read model that is derived,
   reconstructable from PostgreSQL, explicitly TTL'd, and never read by the
   send path.

Step 3 requires an ADR superseding this one, naming the specific read model.
A blanket "we now use Redis for caching" does not satisfy it, because the
whole risk here is generality: the danger is not a cached dashboard count, it
is the next engineer inferring from its presence that caching is available for
the capacity balance.
