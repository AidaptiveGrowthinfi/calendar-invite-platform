# What the v1 Supabase extraction actually found

Extracted 2026-09-03 from project `esqkjstybahwwrtjwtln` via a temporary
read-only role, since dropped. Read-only catalog queries only.

## This is not the production database

The four functions v1's application code calls do not exist in this project,
in any schema:

    lock_recipients_for_batch_v2    called by scheduler.js:138
    complete_email_batch_v2         called by workers/email.worker.js:114
    cleanup_failed_batch            called by workers/email.worker.js:227
    get_campaigns_with_stats        called by controllers/campaign.controller.js:16

Only two functions exist, both predating them:

    increment_account_sent_safe(account_id uuid, amount integer)
    lock_recipients_for_batch(p_campaign_id uuid, p_account_id uuid, p_limit integer)

The data is a handful of test rows, not production traffic:

    campaigns         2   both status 'completed', created 2026-04-29 / 04-30
    recipients        7   all status 'invited'
    gmail_accounts    2
    campaign_senders  4
    event_batches     4
    batch_recipients  7

The `event_batches` and `batch_recipients` tables exist, so the v2 schema was
partially applied here - tables created, functions never added. The last code
commit is 2026-05-19, three weeks after the newest row.

Conclusion: this is a development or abandoned project. The production Supabase
project is elsewhere, presumably under the same departed teammate's account as
the Google Cloud project and the Render service (W23). The v2 function bodies
are not recoverable from here and should be treated as lost.

## What was recovered anyway, and it is worth having

The v1 ancestor of the reservation function shows the technique the v2 version
was built on, which is the reason W18 wanted it:

    update recipients set status = 'processing'
    where id in (
      select r.id from recipients r
      join campaigns c on c.id = r.campaign_id
      where r.campaign_id = p_campaign_id
        and r.assigned_gmail_account_id = p_account_id
        and r.status = 'pending' and c.status = 'running'
      limit p_limit
      for update skip locked
    )
    returning recipients.id, recipients.email, recipients.campaign_id;

`FOR UPDATE SKIP LOCKED` inside the subquery, with the status transition and
the RETURNING in one statement, is the correct shape for a work reservation
under concurrent workers. ADR 0014's reservation should follow it.

## A defect worth not inheriting

`increment_account_sent_safe` reads and then writes without locking the row:

    select sent_today, daily_limit into current_sent, limit_val
    from gmail_accounts where id = account_id;     -- no FOR UPDATE

    if (current_sent + amount) > limit_val then return false; end if;

    update gmail_accounts set sent_today = sent_today + amount ...

Two workers can both read `sent_today = 40` against a limit of 60, both find
`40 + 15 <= 60`, and both write - leaving 70. The daily cap is exceeded and the
function returns true to both callers.

This is exactly the class of race that ADR 0047's per-mailbox capacity
reservation and ADR 0019's atomic reservations exist to prevent, found in
working code. The fix is a locking read, or better, a single conditional
`UPDATE ... WHERE sent_today + amount <= daily_limit RETURNING`, which does the
check and the write in one statement.

## RLS

All six tables report `relrowsecurity = false` and `relforcerowsecurity =
false`, with zero policies. W21 confirmed empirically: v1 had no
database-level tenant isolation of any kind.
