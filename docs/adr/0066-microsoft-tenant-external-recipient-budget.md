# Budget Microsoft native sending per tenant, not only per mailbox

Date: 2026-10-01
Amends: ADR 0047 in part
Closes: W30
Refs: 0010, 0019, 0047, 0048, 0058, 0043

ADR 0047 sourced its capacity numbers from Google only and applied the same
per-mailbox target, 2,000 external invitations a day, to Microsoft mailboxes
by default. Finding W30 raised that as a gap. This ADR supplies the Microsoft
section 0047 lacks.

It also corrects W30. W30 was raised on the strength of Microsoft's announced
per-mailbox External Recipient Rate limit - 2,000 external recipients per
rolling 24 hours, scheduled to reach existing tenants on 2026-10-01 (Microsoft
365 message center MC787382). Microsoft withdrew that limit in an update dated
2026-01-06: "we have decided not to proceed with the rollout of this limit."
The per-mailbox danger W30 described does not exist. A different one does, and
it is larger.

## The limits that apply to a Microsoft 365 mailbox

From Exchange Online limits (Microsoft Learn, updated 2026-09-09):

    Recipient rate limit      10,000 recipients / 24 h, per mailbox, rolling;
                              internal and external both count. When reached,
                              the mailbox cannot send until its 24-hour count
                              drops below the limit.
    Message rate limit        30 messages / minute, per mailbox. Excess is
                              throttled and carried into following minutes.
    TERRL                     Tenant External Recipient Rate Limit: external
                              recipients per tenant per 24 h, sliding window.
                              Trial tenants are capped at 5,000.
    onmicrosoft.com senders   100 external recipients per organisation per
                              rolling 24 h, NDR 550 5.7.236.

TERRL scales with the tenant's purchased email licences and has been enforced
since April-May 2025:

    TERRL = 500 x licences^0.7 + 9,500

    licences     1        5        10       25       100
    TERRL     10,000   11,043   12,006   14,259   22,059

Every native invitation the platform creates through Microsoft Graph is a
meeting message sent by Exchange from the organiser's mailbox, one per contact
under ADR 0010, so all of these limits apply to it.

## The danger is the tenant, not the mailbox

The per-mailbox limit gives 0047's default the same margin it gives Google:
2,000 is one fifth of 10,000. That stands.

TERRL does not scale with mailboxes. A five-licence customer has about 11,000
external recipients a day for the whole company. Connect three of its
mailboxes at the 2,000 default and the platform alone spends 6,000 of them,
before anyone at the company sends an ordinary email. Breaching TERRL blocks
external mail for the customer's entire tenant until the window clears: not a
throttled campaign, but a company that cannot email its customers. It is the
same class of customer-damaging failure 0047 was written to prevent, at a wider
blast radius.

It is also invisible to the platform. Exchange accepts the Graph event-create
call and fails delivery afterwards, returning a non-delivery report to the
organiser's mailbox. The platform holds `Calendars.ReadWrite` and no mail-read
scope, so it never sees the NDR. 0047's discover-and-reuse throttle handling
cannot discover a limit whose breach produces no signal it can read. The
control therefore has to be admission, before sending, not detection after.

## Decision

1. **The per-mailbox default stays 2,000 for Microsoft**, as for Google: one
   fifth of the documented per-mailbox ceiling. The default remains
   configuration per provider so it can diverge later without a migration.

2. **Microsoft mailboxes are grouped by tenant.** The mailbox records the Entra
   tenant id (the `tid` claim, already returned at OAuth connection) and
   belongs to a `provider_tenant` row, organisation-scoped.

3. **A tenant budget is an admission dimension.** Campaign approval under ADR
   0058 tests, per day, that the commitments of all the organisation's
   mailboxes in one Microsoft tenant fit within that tenant's budget, in the
   same transaction and under the same `FOR UPDATE` as the per-mailbox test.
   Locking extends to every mailbox-day of the tenant in the window, not only
   the mailboxes the plan uses, because a commitment on any of them spends the
   same budget. A refusal names the tenant and the per-day shortfall, with the
   same three remedies.

4. **The budget is half of TERRL**, configurable per tenant and never above
   it. The other half is left for the customer's own external mail, which the
   platform cannot see. Half is deliberately a round, explainable number rather
   than a fitted one; it is a tuning value, versioned like the gate's
   thresholds.

5. **TERRL is computed from a licence count the organiser supplies.** Reading
   it directly needs admin-consented directory scopes the product does not
   otherwise need. Until the organiser supplies a count, the platform assumes
   the lowest documented TERRL, the 5,000 trial cap, giving a budget of 2,500 -
   enough for one mailbox at the default. The connection screen asks for the
   licence count and shows the resulting budget, so the conservative default is
   visible rather than mysterious.

6. **Admission by organisation-day is sufficient for the rolling window**,
   given the throttle's smoothing. TERRL and the recipient rate limit are
   rolling 24-hour windows; 0058 commits by organisation-day. Because ADR
   0019's throttle spreads each day's budget across the same send window every
   day, any 24-hour window covers at most one day's send window, so a day
   within budget cannot produce a rolling window over it. The throttle asserts
   this rather than assuming it: it does not dispatch for a tenant whose
   trailing-24-hour count would exceed the budget.

7. **The throttle also paces the message rate.** No more than 20 messages a
   minute per Microsoft mailbox, two thirds of the 30 a minute limit. 2,000 a
   day across an eight-hour window is about four a minute, so this binds only
   on bursts.

8. **`onmicrosoft.com` sending addresses are refused for native mode.** At 100
   external recipients a day per organisation, they cannot carry a campaign,
   and a mailbox that could send one invitation an hour should not appear to
   offer capacity.

9. **Signals that do reach the platform reduce the tenant, not the mailbox.** A
   Graph error indicating a sending limit, or a mailbox entering `blocked`, sets
   the tenant's throttle state and reduces every mailbox in it, released only
   through the Deliverability Gate's recovery policy, as 0019 requires.

## Accepted limitations

- **A tenant connected under two organisations is budgeted twice.** Row-level
  security (ADR 0043) correctly prevents one organisation seeing another's
  mailboxes, so neither budget knows about the other. An agency managing a
  client's tenant alongside the client is the realistic case. Detecting it
  needs a cross-tenant lookup that 0043 and 0055 deliberately forbid; it is
  not worth an exemption. The connection screen states that the budget
  assumes this organisation is the tenant's only sender on the platform.

- **A breach that slips past admission is still invisible.** Reading NDRs would
  need a mail-read scope on every connected mailbox, which widens what the
  platform can see well beyond calendars and complicates Google and Microsoft
  verification. Not adopted. Response sync (ADR 0041) is the indirect signal:
  a tenant whose invitations stop producing any responses at all is flagged for
  the organiser to check.

- **The licence count is attested by the customer and not verified.**
  Overstating it raises their own budget and puts their own tenant at risk.
  That is the customer's call to make, and the screen says so.

## Consequences

- Schema slice 1: `mailbox.provider_tenant_id`, and a new organisation-scoped
  `provider_tenant` table carrying the tenant id, declared licence count,
  budget fraction, computed budget, and throttle state. Google mailboxes leave
  `provider_tenant_id` null; nothing in this ADR applies to them.
- Planning (ADR 0058) gains a second capacity test at approval and a wider
  lock set. `reconcile-capacity` covers the tenant sum.
- Mailbox connection collects the licence count for Microsoft and rejects
  `onmicrosoft.com` sending addresses.
- ADR 0047 receives a pointer to this ADR and is otherwise unchanged, per ADR
  0054.

## Sources

- Exchange Online limits: https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits
- MC787382, External Recipient Rate limit, withdrawn 2026-01-06: https://mc.merill.net/message/MC787382
- Introducing Exchange Online Tenant Outbound Email Limits (TERRL), linked from
  the limits page: https://techcommunity.microsoft.com/blog/exchange/introducing-exchange-online-tenant-outbound-email-limits/4372797
- The TERRL formula and the April-May 2025 enforcement dates are taken from
  secondary write-ups of that announcement (e.g.
  https://support.knowbe4.com/hc/en-us/articles/40027061481363-Microsoft-Exchange-Online-Tenant-Outbound-Email-Limits),
  because the announcement itself could not be retrieved when this was written.
  The authoritative per-tenant number is the Tenant Outbound External
  Recipients report in the Exchange admin center; when an organiser can read it
  there, entering it directly is better than entering a licence count.
