# Define attendance segments as a partition, with no-show as a rollup

Date: 2026-09-08
Closes: W27
Supersedes: the segment list in 0026
Refs: 0011, 0026, 0027, 0041, 0061, CONTEXT.md

ADR 0026 says the worker will "update analytics for attended, no-show,
accepted-but-missed, declined, and no-response segments". Those five are not a
partition, and a dashboard built from them literally will be wrong in two ways.

**They overlap.** Someone who accepted and did not attend is both
`accepted-but-missed` and a no-show. Summing the five double-counts them, and
the count that looks most authoritative on a results screen — the total — is
the one that breaks first.

**They omit `tentative`.** ADR 0041 maps both `tentative` and
`tentativelyAccepted` to a `tentative` response state, ADR 0011 offers tentative
as an RSVP action, and slice 4 stores it in `response_state`. A person who
answered tentatively and then did not attend falls into none of ADR 0026's five
segments, so they vanish from the analytics that are supposed to account for
every invited person.

A third problem is not in 0026's list but is created by the same framing:
**absent and unknown are not the same thing.** ADR 0027 says a campaign with no
usable host access remains sendable and falls back to manual import, so a
campaign may legitimately have no attendance data at all. Treating missing data
as absence reports every invitee as a no-show and tells the organiser their
webinar failed.

Decision: a segment is a function of two values already stored — the response
state on `invitation_response` and the attendance state on
`campaign_member_attendance` — and the segments partition the invited
membership exactly once.

    attendance = unknown                    -> unknown
    attendance = attended                   -> attended
    attendance = absent, response = accepted    -> accepted_but_missed
    attendance = absent, response = tentative   -> tentative_missed
    attendance = absent, response = declined    -> declined_absent
    attendance = absent, response = no_response -> no_response_absent

Every campaign member lands in exactly one. The six sum to the campaign's
member count, and that identity is asserted by a test.

`no_show` is not a segment. It is a rollup — every member whose attendance is
`absent`, which is the last four rows above — and it is defined once, in one
place, so that it cannot be added to the segments it contains. This is the
`CONTEXT.md` discipline applied to reporting: `no_show` is a legitimate term
the organiser will use and the product should show, but it is a name for a
union rather than a peer of the things it unions, and the forbidden usage is
listing it alongside them.

Attendance itself is three-valued — `unknown`, `attended`, `absent` — for the
reason slice 4 gives about `last_synced_at`: the schema must distinguish "this
person did not come" from "we were never able to ask". A boolean would collapse
them, and the collapse is silent and always in the direction that makes the
customer's results look worse.

Consequences:

- Segments are derived on read, not stored. ADR 0061 removed retention, so the
  source rows are always present, and ADR 0059 rules out a cache in the MVP.
  Nothing needs to be materialised, and a stored segment would be a
  denormalisation with no reader that a re-sync could silently invalidate.
- `attended` deliberately ignores the response. Someone who declined and turned
  up anyway attended, and reporting them as declined would misstate the only
  fact the organiser actually cares about.
- Attendees the platform never invited are not in any segment, because segments
  partition the invited membership. They are counted separately and reported
  separately; they are a real and interesting number, and folding them into
  `attended` would make attendance exceed the invitation count.
- A campaign in `attendance_state = 'not_configured'`, `'pending'` or `'failed'`
  reports every member as `unknown`. The results screen says so rather than
  showing zeroes, and this is the state ADR 0035 wants visible.
