# Connect meeting host accounts separately from sending mailboxes

Date: 2026-09-08
Closes: W26
Refs: 0026, 0027, 0028, 0033, 0047, 0049

ADR 0027 requires the organisation to connect the account that hosts the
meeting before attendance can be synced automatically. ADR 0026 names Zoom,
Microsoft Teams and Google Meet as the providers. Schema slice 3 implemented
that requirement as `campaign.attendance_host_mailbox_id`, referencing
`mailbox`.

`mailbox` cannot hold a Zoom account. Its provider enum is `google | microsoft`
by construction, because a Mailbox is defined in `CONTEXT.md` as a connected
Google Workspace or Microsoft 365 account used to send invitations. So one
third of ADR 0026's providers is unreachable, and the column's name records the
assumption that made it unreachable.

A meeting host account is connected as its own thing, in its own table, and is
not a mailbox.

The tempting alternative is to widen `mailbox` with a `zoom` provider and let
the two roles share a table. It is rejected on three grounds, and the third is
the one that decides it:

1. Every capacity column on `mailbox` — `daily_capacity_target`,
   `observed_capacity_ceiling`, `throttle_state`, `throttled_until` — is
   meaningless for a Zoom account, which sends nothing. ADR 0047's throttle
   logic would have to learn to skip rows, which is how a shared table starts
   growing predicates that mean "this is really the other kind".

2. The lifecycles are unrelated. A mailbox in `needs_reauth` stops a send. A
   meeting host account in `needs_reauth` stops attendance sync after the event
   and stops nothing else. Merging them means one status column answering two
   questions that fail at different times for different reasons.

3. The scopes are not merely different, they are differently dangerous. Google
   Meet attendance is read through Workspace admin reporting, which is an
   administrator-level grant over the whole domain. Sending invitations needs
   `calendar.events` on one account. Putting both on one row invites one
   consent screen requesting both, and the platform would then hold admin-level
   access on every account connected merely to send from.

Accepted consequence: an organisation using Google for both connects the same
Google account twice, through two consent flows, holding two token sets. That
is more clicks and it is the right trade. The alternative buys one fewer click
by asking every sending mailbox to carry domain-wide admin scope, and ADR 0033
already treats provider tokens as material to be minimised rather than pooled.

Consequences:

- Slice 3's `attendance_host_mailbox_id` becomes `attendance_host_account_id`,
  referencing the new table. Null remains a supported state and still means
  what ADR 0027 says it means: the campaign is sendable and attendance falls
  back to manual import.
- Tokens are encrypted at rest under ADRs 0033 and 0049, exactly as mailbox
  tokens are. Nothing about this table is a weaker security position.
- ADR 0028 is unaffected. The platform still does not create meetings; it reads
  attendance for a meeting that already exists.
- A `custom` meeting provider has no host account and never syncs. That is not
  a degraded state, it is the documented one from 0027, and the schema records
  it as `attendance_state = 'manual'` rather than as a failure.
