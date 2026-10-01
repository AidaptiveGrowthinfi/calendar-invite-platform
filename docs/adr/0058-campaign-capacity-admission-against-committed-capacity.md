# Admit a campaign against uncommitted mailbox capacity

Date: 2026-09-07
Closes: W25
Refs: 0047, 0048, 0052, 0057, 0019

ADR 0047 gives each mailbox a daily capacity target. ADR 0048 allocates the
platform's shared Calendar API quota between organisations. Neither says what
happens when one organisation runs two campaigns at once against the same
mailboxes, which is the ordinary case: a webinar is planned while a previous
one is still sending.

ADR 0052 already requires a test that "per-mailbox and platform-wide quota
reservations are not exceeded under concurrent campaigns", so the test plan
assumes a mechanism the decision record never defines.

Mailbox capacity is a reservation, not a rate limit checked at send time.

An approved send plan commits capacity: for each mailbox and each day in its
window, the plan holds a claim on part of that mailbox's daily target. Planning
a second campaign computes against what is left after existing commitments, not
against the full target. A mailbox committed to 1,800 of its 2,000 invitations
on Thursday offers 200 on Thursday to the next campaign, not 2,000.

Approval is therefore an admission decision. A campaign is admitted when a plan
exists that fits its audience into uncommitted capacity across the days between
approval and the event. If no such plan exists, approval is refused and the
shortfall is shown - how many invitations do not fit, and on which days - with
the three remedies stated: connect more mailboxes, reduce the audience, or move
the event later. Refusing at approval is the point of the design. The failure
this prevents is a campaign that starts confidently and strands several thousand
contacts uninvited on the morning of the webinar, when nothing can be done.

Consequences:

- Capacity commitments are held in Postgres beside the plan, per ADR 0013, and
  are the same record the dispatcher decrements as it sends. There is not a
  planning number and a separate sending number that can disagree.
- Releasing capacity is part of cancellation. A cancelled or completed campaign
  returns its unused commitments so a later campaign can use them.
- A mailbox whose observed ceiling drops under ADR 0047's throttle handling, or
  which enters `needs_reauth`, reduces capacity that is already committed. The
  affected plans are re-evaluated and the organiser is told, rather than the
  shortfall being discovered silently at send time. This is the same signal path
  ADR 0019 already owns.
- The reservation is per organisation and sits underneath ADR 0048's
  cross-organisation allocation. Both must pass. 0048 stops one tenant starving
  another; this ADR stops one campaign starving the next campaign in the same
  tenant.
