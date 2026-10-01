# Architecture Review Findings

Working ledger of defects found in the pre-schema architecture docs.
Each item is closed by an ADR change, a new ADR, or an explicit "won't fix".

Status values: `open`, `decided`, `closed`, `wontfix`.

## A. Blocking product decisions

### W1 - MVP scope is 2-3x a two-person team
Status: deferred by owner 2026-09-03 - see note, possible mismatch
Refs: 0015, and the word "MVP" in ~30 ADRs

Both send modes, Google Calendar, MS Graph, SendGrid, Zoom/Teams/Meet,
Razorpay + entitlements, DNS/domain verification, hosted RSVP, email
intelligence, CSV/XLSX import, audit, API keys, admin observability,
staging + production. Native mode and calendar email mode share almost no
infrastructure - native is an OAuth mailbox pool with per-mailbox capacity;
email is domains, DNS, webhooks, warm-up, reputation, ICS, hosted RSVP.
Building both in parallel is two products and two failure domains.

Owner position 2026-09-03: deferred, on the grounds that scope depends on how
many warmed-up mailboxes are available.

Recorded mismatch: that reasoning answers send-volume scope, which is W4/W12.
W1 is about BUILD scope - the number of separate subsystems two people must
write, integrate, and operate. Mailbox count does not change how long SendGrid
plus DNS verification plus hosted RSVP plus warm-up plus Zoom/Teams/Meet
attendance plus Razorpay entitlements takes to build. Left deferred as
instructed; reopen if the schedule slips, because this is the finding that
predicts that slip.

### W2 - Consent source removal contradicts the rest of the risk posture
Status: closed 2026-09-03 - wontfix, accepted with residual risk
Refs: 0038, tension with 0010, 0015, 0018, 0020, 0022

Every other ADR is explicitly anti-abuse ("not a bulk-email bypass", "not
reputation evasion", "honest sender identity"). 0038 drops the one field
recording why a recipient may be contacted, and is the only ADR justified by
convenience rather than risk. A calendar invite writes to the recipient's
calendar, so it is more intrusive than email. Collides with 0018: the shared
trial domain is the highest-abuse surface paired with the lowest-friction
consent story.

### W3 - Permanent suppression vs right to erasure
Status: closed 2026-09-03 -> ADR 0046
Refs: 0039, 0040

0039 says suppression is permanent. GDPR/DPDP erasure requests say delete.
Storing a plaintext address forever to honour an unsubscribe is itself
processing. Needs a deliberate mechanism, not a slogan.

DECIDED 2026-09-03: store the suppression entry as a hash, not a plaintext
address. Rationale from the owner: the platform never needs to mail a
suppressed contact again, so it never needs to read the address back - only to
recognise it. Erasure and permanent suppression stop conflicting, because the
retained artefact is a one-way fingerprint rather than contact data.

This works because the only operation suppression needs is membership: hash
the incoming address at import or send time, look it up. That is unaffected.

Three consequences that must be settled in the ADR, because two of them are
irreversible:

1. Plain digest is not enough. An unsalted SHA-256 of an email address is
   brute-forceable - the address space is small and enumerable - so regulators
   treat it as pseudonymised personal data, which leaves the erasure conflict
   exactly where it was. Use HMAC-SHA256 under a server-held pepper so the
   digest is not reproducible without the key. Note the coupling to W8: the
   pepper is another secret on the same host as the data, and losing it
   destroys every suppression record irrecoverably. It must be in backups and
   must never rotate.

2. Normalisation freezes permanently at first write. Whatever rules produce
   the string that gets hashed - lowercasing, trimming, Gmail dot and plus
   handling - can never change afterwards, because old digests cannot be
   recomputed. A later "improvement" to normalisation silently orphans every
   existing suppression and re-enables sending to people who unsubscribed.
   The rules must be written down in the ADR as a frozen specification.

3. The list becomes unreadable to its owner. Customers cannot be shown who is
   on their suppression list, and support cannot answer "why did this person
   not receive it" by browsing. Recommended: store a masked display form
   alongside the digest - first two characters, domain retained - which keeps
   the UI and support usable without retaining a resolvable address. Answering
   "is this specific person suppressed" still works, by hashing the candidate.

Scope: per organisation, per 0039. The digest is keyed by organisation, so the
same address suppressed in one organisation is unaffected in another.

WRITTEN UP 2026-09-03 -> ADR 0046. Two refinements made while writing it:
the organisation id is part of the HMAC message rather than only a column, so
suppression lists cannot be correlated across tenants even by a holder of the
key and the database; and Gmail dot/plus normalisation is explicitly excluded,
because it cannot be determined from the domain (a Google Workspace custom
domain collapses dots while looking ordinary) and freezing a wrong guess is
permanent in both directions. The general escape hatch is recorded there:
extend by adding a second digest column, never by redefining the first.

## B. Contradictions and under-specification in existing ADRs

### W4 - Native mode capacity is asserted, never defined
Status: closed 2026-09-03 -> ADR 0047
Refs: 0010

"Capacity-gated" never says gated by what numbers or sourced from where.
The uncovered risk is not quota: creating thousands of single-attendee
events from one mailbox is itself an abuse signal to Google/Microsoft, and
the account suspended is the CUSTOMER's Workspace, not our campaign. That is
a customer-catastrophic failure mode with no ADR.

Sourced numbers added 2026-09-03. Google Calendar API, for Cloud projects
created on or after 2026-05-01 - which includes the new project from W23:

    10,000 requests / minute / project
       600 requests / minute / user / project
    1,000,000 requests / day / project   <- billing threshold, CANNOT be raised

Quota is a sliding one-minute window, so a burst over the limit rate-limits the
following window until the average falls back under.

Corrected 2026-09-03 after reading the source page directly: the 1M/day figure
is a BILLING THRESHOLD, not a blocking limit. It does not stop requests. Google
states "all standard use of the Google Calendar API is available at no
additional cost" and "usage under this threshold doesn't incur extra charges";
charges are "planned to incur ... later in 2026" with at least 90 days' notice.
An earlier version of this finding described it as a hard ceiling that could
not be raised. It is not a ceiling at all - it is the point at which a future
variable cost begins.

The two per-minute figures are the ones enforced today. At roughly 1.2-1.5
calls per invitation once response sync (0041) is counted, ~1M requests/day is
near 700k invitations/day platform-wide - the level at which API spend starts
appearing, not at which sending stops.

Source: https://developers.google.com/workspace/calendar/api/guides/quota

The customer-side Workspace limits, found 2026-09-03:

    ~10,000  invites to external guests in a "short period"
             -> external invitations throttled, "might not be able to send any
                invitations to people outside their organization for a few
                hours"
    ~100,000 events created in a "short period" -> creation rate reduced
     ~2,000  emails to external guests via the Email guests feature

Source: https://knowledge.workspace.google.com/admin/calendar/avoid-calendar-use-limits

Two consequences.

First, v1's 60/day/account was conservative by more than two orders of
magnitude against a real limit near 10,000 external invites. Native mode has
far more headroom than v1's behaviour implied, which materially strengthens the
case for carrying it as a primary mode rather than a boutique one. W12's
throughput targets should be set from this, not from v1.

Second, and this is the actual danger the finding named: Google states "we
don't publicize the exact limits where stricter ones apply", and stricter,
unpublished limits apply to trial accounts and to paid accounts for their first
60 days. So for precisely the newly-signed customer, safe capacity CANNOT be
computed from documented numbers. "Short period" is also undefined, so even the
published figure has no denominator.

This makes the capacity model necessarily empirical rather than arithmetic:
each newly connected mailbox starts low, ramps on observed success, and backs
off hard on the first throttling signal, with the throttled resource being the
customer's Workspace rather than the platform's quota.

### W4c - Warm-up is specified for domains, not for mailboxes
Status: deferred by owner 2026-09-03 - mailboxes will be pre-warmed
Refs: 0019, W4

0019's warm-up and adaptive-throttle language is written around sending
domains, bounce and complaint rates, and email reputation - the Calendar Email
Mode failure model. Native Calendar Mode's failure model is different: the
signal is provider throttling, the resource is a customer-owned Workspace
mailbox, and the true limit is undocumented for new accounts (W4).

Nothing in the ADRs currently ramps a newly connected mailbox. A customer who
connects a fresh Workspace account and launches a large campaign is the exact
path to a throttled customer Workspace, and 0019 as written does not prevent
it because it is watching bounce rates rather than provider throttle responses.

Needs either an extension of 0019 or a separate ADR covering per-mailbox
capacity discovery: initial conservative ceiling, ramp schedule, throttle-signal
detection, back-off, and how the discovered ceiling is stored and reused.

Owner position 2026-09-03: deferred. All mailboxes will be pre-warmed before
connection, so the ramp half of this finding does not apply. Accepted - a
pre-warmed mailbox is an established account, which also puts it outside the
stricter-limits-for-new-accounts window in W4.

Residual, not deferred: throttle-signal detection and back-off are still
required. Pre-warming establishes reputation; it does not raise Google's
external-invite limit, and "short period" has no published denominator, so a
pre-warmed mailbox can still be throttled by a large enough campaign. The
schema should therefore still carry per-mailbox observed-capacity and
throttle-state fields even though no ramp schedule is built. Cost is a few
columns; the alternative failure is a throttled customer Workspace.

### W4b - Shared provider quota is a multi-tenant coupling
Status: closed 2026-09-03 -> ADR 0048
Refs: 0019, 0010, W4, W7

The 1M/day Calendar API threshold is per Cloud project and the platform has
one, so every organisation draws from a single counter. One customer's large
campaign consumes capacity every other customer needs. This is not a tenancy
leak - no data crosses - but it is a noisy-neighbour capacity problem, and no
ADR mentions it.

Options considered 2026-09-03:

1. Shard across several platform-owned Cloud projects. REJECTED, not merely
   impractical. Google treats multiple projects acting as one to circumvent
   quota as a terms violation and enforces it; the Workspace developer policy
   carries an equivalent anti-circumvention clause. Independently unworkable:
   each project needs its own OAuth client and its own verification for the
   sensitive `calendar.events` scope, and refresh tokens are bound to their
   issuing client, so a customer could never be moved between projects without
   reconnecting.

2. Fair-share reservation inside the throttle. RECOMMENDED. 0019 already gives
   the throttle atomic capacity reservations per applicable limit; add
   platform-wide provider quota as one more dimension with a per-organisation
   allocation. One organisation then cannot exceed its share by construction,
   and noisy-neighbour becomes a tunable scheduling policy rather than an
   infrastructure limit. Cost is one counter and a fairness rule.

3. Customer-owned Cloud project, bring-your-own OAuth client. The legitimate
   form of per-customer isolation: the customer owns the project, so quota,
   billing, and suspension risk are genuinely theirs, and no anti-circumvention
   clause applies because the platform is not multiplying its own projects.
   Cost is heavy onboarding - the customer configures a consent screen and,
   for external guests, completes their own verification. Enterprise-only in
   practice. Not building it now, but the Mailbox record should permit an
   organisation-supplied OAuth client so this stays reachable without a
   migration.

Recommendation: adopt 2 now, keep 3 reachable in the schema, never do 1.

Sources:
  https://developers.google.com/workspace/workspace-api-user-data-developer-policy
  https://github.com/ThioJoe/YT-Spammer-Purge/discussions/937

### W5 - Native mode response ingestion is undefined
Status: decided -> ADR 0041
Refs: 0011 (covers calendar email mode only)

DECIDED 2026-09-02: read responses from provider attendee status
(Google `responseStatus`, Graph `status.response`) via incremental sync token,
not from the mailbox. Keeps OAuth at the `calendar.events` sensitive scope and
avoids the restricted-scope CASA security assessment. See ADR 0041.

When a recipient RSVPs to a native calendar event, the response lands in the
customer's connected mailbox / calendar, not in our platform. No ADR says how
we read it, how often, or what happens when the mailbox is disconnected.

### W6 - Verification weakness peaks exactly when reputation is most fragile
Status: closed 2026-09-03 -> ADR 0051
Refs: 0025 vs 0015, 0016, 0019

Non-SMTP verification means bad addresses are discovered via bounces. The
deliverability gate is bounce-driven and warm-up-limited. So the weakest
verification sits at the moment reputation is most fragile: first sends on a
fresh domain. The two ADRs never acknowledge they interact.

### W7 - Tenant scoping is stated as a rule, not built as a mechanism
Status: closed 2026-09-03 -> ADR 0043, and ADR 0042 replacing the access layer
Refs: 0007

With Prisma plus sanctioned raw SQL escape hatches, "every product query must
preserve tenant scoping" is a code-review convention. One missed WHERE in a
planner query is a cross-tenant data leak. Needs an enforcement mechanism
(RLS, or a single query chokepoint), decided before the schema.

Correction 2026-09-03: an earlier framing of this finding described the workers
as round-robin and therefore broadly cross-tenant. That is v1's design
(`Bulk-Calendar-Invites/docs/PROJECT_ARCHITECTURE.md`), not project1's. No
project1 ADR mentions round-robin.

Under 0013 the send plan records which mailbox sends each invitation, decided
at plan time; under 0019 the throttle owns capacity reservations and workers
implement no pacing of their own. A plan belongs to one campaign and a campaign
to one organisation, so planning and sending are both single-tenant. v1 chose
live assignment because it had no persisted plan.

The genuinely cross-tenant surface is therefore two named things:

1. The dispatcher deciding which campaign's work runs next.
2. Shared provider quota. Google Calendar API quota is per Cloud project and
   the platform has one, so every organisation draws from one counter.

Delivery Buckets are not in this set. Pacing is per sending identity, so two
organisations sending to Gmail recipients must not share a bucket - their
sender reputations are independent.

This matters to the decision: an RLS-exempt set of two enumerable components is
auditable, where "the workers" was not.

DECIDED 2026-09-03 -> ADR 0043. Row-level security is the mechanism, with a
`withOrg` chokepoint for ergonomics. Three exhaustive exemptions: the
dispatcher, shared provider quota accounting, and Better Auth's own tables.
Forgetting tenant context returns zero rows rather than another organisation's
data.

Consequent decision -> ADR 0042: Drizzle ORM replaces Prisma. Prisma cannot
declare RLS policies or roles in its schema, so policies would have lived in
migrations disconnected from the tables and a remembered test would have been
the only guard. Drizzle declares them alongside the tables and treats an
unpolicied table as default-deny. The independent argument is that this
system's hard queries are hand-written SQL - reservation locking, capacity
counters, bulk import, reconciliation - which is where Prisma is weakest and
which ADR 0007 had already carved out. Taken now because it is only cheap
before the first table exists.

Operational note carried into 0042: `drizzle-kit push` does not apply RLS
policies and is banned in this project, including in development.

### W8 - Secrets and key management hand-waved
Status: closed 2026-09-03 -> ADR 0049
Refs: 0033

Docker Compose on a VPS means the token-encryption key lives in a .env file
on the same host as the encrypted tokens, so encryption-at-rest buys little
against host compromise. "A managed KMS can replace this later" is an
acceptable answer; the absent threat model is not.

### W24 - Platform-wide bounce check contradicts tenant isolation
Status: closed 2026-09-07 -> ADR 0055
Refs: 0051 vs 0046, 0043
Found while modelling schema slice 2, not during the original review pass.

ADR 0051 gates warm-up sending on "no prior bounce recorded for the address
anywhere in the platform's history". ADR 0046 keys the suppression digest on
`organisation_id` specifically so that the same address in two organisations
produces two unrelated digests, and states that lists cannot be correlated
across tenants even by someone holding the key and the database.

A platform-wide bounce lookup is exactly that correlation: it tells any
organisation whether some other organisation has mailed an address and been
rejected. Neither ADR cites the other, so the contradiction survived both
reviews.

Resolved toward isolation. Bounce history is organisation-scoped, ADR 0051's
clause is narrowed, and a platform-level bounce ledger is ruled out without an
ADR superseding 0055. The protection given up is narrow - it applies only
during warm-up, only to addresses this organisation has never mailed, and only
to those another organisation has already bounced - and 0051's other controls,
the MX requirement, the lower initial cap, and the hard stop on early bounce
rate, are unaffected.

### W25 - Concurrent campaigns share mailboxes with no defined mechanism
Status: closed 2026-09-07 -> ADR 0058
Refs: 0052 vs 0047, 0048
Raised by the product owner 2026-09-07 in plain terms: webinar 2 must not
interfere with webinar 1, and starting it should check whether enough mailbox
capacity exists.

ADR 0047 sets a per-mailbox daily target. ADR 0048 allocates the platform's
shared Calendar API quota between organisations. Neither covers two campaigns
in the SAME organisation drawing on the same mailboxes at the same time, which
is ordinary operation rather than an edge case - a multi-day send under 0047's
50,000-contact target is still running when the next webinar is planned.

The gap is visible in the test plan. ADR 0052 requires a test that "per-mailbox
and platform-wide quota reservations are not exceeded under concurrent
campaigns, per ADR 0047 and 0048" - a test for a mechanism neither cited ADR
defines. 0047's only mention of campaigns sharing a mailbox is that throttle
STATE is reused across them, which is a different thing from budgeting capacity
across them.

Without a decision it resolves as first-come-first-served at send time, and the
failure mode is the bad one: a campaign is approved, starts sending, and runs
out of mailbox capacity part-way through, stranding contacts uninvited on the
morning of the webinar when no remedy is left.

Closed by making capacity a reservation held by the approved plan, and approval
an admission decision against what is uncommitted.

### W26 - Attendance host reference cannot represent a Zoom account
Status: closed 2026-09-08 -> ADR 0062
Refs: 0027, 0026, 0033 vs schema slice 3, slice 1
Found while modelling schema slice 7, not during the original review pass.

ADR 0026 names Zoom, Microsoft Teams and Google Meet as the attendance
providers. ADR 0027 requires the hosting account be connected before automated
sync is possible. Schema slice 3 implemented that as
`campaign.attendance_host_mailbox_id`, referencing `mailbox`.

`mailbox_provider` is `google | microsoft`, and that is not an oversight in
slice 1 - `CONTEXT.md` defines a Mailbox as a connected Google Workspace or
Microsoft 365 account used to send invitations. So the column could never hold
a Zoom account, and a third of 0026's stated provider support was unreachable
from the schema. ADR 0033 lists Zoom among the providers whose tokens are
encrypted at rest, so a Zoom connection was always intended; it simply had no
table.

Read before writing, per the method note under W22: slice 1's enum and slice 3's
reference were both read in full rather than inferred from the column name.

Resolved by a separate `meeting_host_account` table rather than by widening
`mailbox`. The deciding argument is scope blast radius: Google Meet attendance
is read through Workspace admin reporting, which is a domain-wide
administrator grant, and merging the tables invites one consent screen that
attaches admin scope to every account connected merely to send from. The
accepted cost is that an organisation using Google for both connects the same
account twice.

### W27 - ADR 0026's analytics segments overlap and omit tentative
Status: closed 2026-09-08 -> ADR 0063
Refs: 0026 vs 0041, 0011, 0027
Found while modelling schema slice 7.

ADR 0026 says the worker updates analytics for "attended, no-show,
accepted-but-missed, declined, and no-response segments". Three defects, all in
the same sentence.

They overlap. Someone who accepted and did not attend is both
`accepted-but-missed` and a no-show, so summing the five double-counts - and
the total is the number a results screen makes most prominent.

They omit `tentative`. ADR 0041 maps both `tentative` and `tentativelyAccepted`
to a tentative response state and ADR 0011 offers it as an RSVP action, and
slice 4 stores it. A person who answered tentatively and did not attend is in
none of the five, so they disappear from analytics meant to account for every
invited person.

They conflate absent with unknown. ADR 0027 permits a campaign with no usable
host access to send anyway and fall back to manual import, so "no attendance
data" is a normal state rather than an error. Reporting it as absence tells the
organiser nobody came to a webinar the platform never measured.

Resolved by defining the segments as a six-way partition over response and a
three-valued attendance state, with `no_show` demoted to a rollup defined once
so it cannot be listed beside the segments it contains. The partition identity -
the segments sum to the campaign's member count - is asserted by a test, which
is what will catch the next state added to `response_state` without a matching
segment.

### W28 - Retention windows in slices 2 and 5 contradict ADR 0061
Status: closed 2026-09-08 -> ADR 0065
Refs: ADR 0061 vs schema slice 2, slice 5
Found while writing the specification, 2026-09-08.

ADR 0061 states, as a consequence rather than an aside: "No retention job
exists. There is nothing for it to do." Two schema slices, both written the day
before it, say the opposite about two specific columns.

Slice 2, on `audience_import_rejection.raw_row`: "it carries a retention
window: deleted with its import after a fixed period, by a scheduled job rather
than by intent." The same paragraph puts the uploaded file itself in object
storage "under a lifecycle rule". Slice 5, on `provider_webhook_event.payload`:
"retained under a retention window like the import rejections in slice 2. It
carries recipient addresses."

So the specification cannot state the scheduled-job inventory. Either two jobs
exist that ADR 0061 says do not, or two slices describe behaviour that was
removed and nobody noticed, in which case personal data the platform has no
sending use for is kept forever.

The two are not obviously the same question, and that is what makes this a
decision rather than a correction. ADR 0061 is about **plan-tier retention**:
its argument is that how long a customer's data survives must not be a function
of what they pay, and every consequence it lists is about a customer's own
product data - campaigns, audiences, attempts, responses, attendance, audit.
`raw_row` and `payload` are neither. They are byproducts of an ingestion the
platform keeps only to explain itself afterwards, one holding the customer's
original spreadsheet line and the other a provider's body containing recipient
addresses.

Recommendation: a new ADR narrowing 0061 rather than superseding it -
indefinite retention is the guarantee over a customer's product data, and two
named byproduct payloads carry minimisation windows. Per ADR 0054, 0061 gets a
pointer and no other edit. The supporting argument is 0061's own: it invokes
storage limitation under GDPR and DPDP to require that indefinite retention be
disclosed, and that same principle is what argues against holding a provider's
raw webhook body forever.

The cost of the alternative - deleting the two windows from the slices and
keeping everything - is one paragraph of disclosure and unbounded growth on two
tables nobody queries. The cost of this recommendation is two scheduled jobs
and an ADR. Either is defensible; the current state, where the documents
disagree, is not.

Resolved 2026-09-08 by ADR 0065, taking the recommendation: 0061 is narrowed
rather than superseded, both windows stand, and 0061 carries a pointer and no
other edit per ADR 0054. One refinement the ADR adds beyond what was proposed
here - the window clears the **payload columns**, not the rows. A rejection
keeps its row number and reason after `raw_row` is cleared, and a webhook event
keeps its identity, type and correlation after `payload` is cleared, because
the count of what was rejected and why is product data under 0061 and does not
expire. Same separation ADR 0046 makes between a suppression record and the
address that produced it.

The window length is deliberately not fixed: it is configuration and a privacy
policy line, not a migration, and it must never become a plan dimension.

### W29 - `organisation` has no timezone, and two slices depend on one
Status: closed 2026-09-08 -> schema slice 1 corrected
Refs: schema slice 1 vs slice 4, slice 6
Found while writing the specification, 2026-09-08.

Slice 4, on `mailbox_capacity_day`: "`day` is a date in the organisation's
timezone". Slice 6, on `usage_counter`: "`period_start` is the date of
`subscription.current_period_start` in the organisation's timezone."

Slice 1's `organisation` has seven columns - `id`, `auth_organization_id`,
`name`, `slug`, `status`, `created_at`, `updated_at` - and none of them is a
timezone. Nothing else in the schema can supply one. `campaign_revision.timezone`
is per event under ADR 0044, and capacity days and billing periods are neither
per campaign nor per event, so it cannot be borrowed from there.

The consequence if it is left as is: both are silently computed in UTC. For a
platform whose first market is `Asia/Kolkata` that shifts a capacity day by
five and a half hours, so a mailbox's day boundary falls in the middle of the
business afternoon, and a billing period closes mid-morning. Neither would look
wrong on a dashboard; both would make a reconciliation job disagree with a
human counting rows.

This is the same class as W26: the column name read correctly and the source
was never checked against it. Recorded rather than quietly patched, because
"the data model is complete" was stated on 2026-09-08 and this is a gap in it.

Recommendation, and it is small: `timezone text not null default 'Asia/Kolkata'`
on `organisation`, validated against `pg_timezone_names` and normalised to
canonical form by the same validator ADR 0044 already requires for
`campaign_revision`. One validator, two callers, consistent with the single
normaliser rule slice 2 sets for email. Schema slices are editable, so this is
a slice correction and not an ADR.

Applied to slice 1 on 2026-09-08 with the default. Carried in ticket E1-1,
which owns the validator that both this column and `campaign_revision.timezone`
call.

## C. Missing decisions that will shape the schema

### W9 - Timezone and DST semantics
Status: closed 2026-09-03 -> ADR 0044

Listed only as an .ics field. Actually a bug class: event TZ vs recipient TZ,
DST transitions between send and event, floating vs zoned times, what the
stored canonical form is.

DECIDED 2026-09-03 -> ADR 0044. The organiser's timezone defines the event.
Stored as local wall-clock time plus an IANA zone, never as a UTC instant,
because tzdata changes would otherwise silently move a booked event. Instants
elsewhere stay `timestamptz`. Recipient timezones are not stored - calendar
clients render zoned events locally. Alias normalisation and rejection of
non-existent local times are validation requirements.

### W10 - Reschedule and cancel at scale
Status: closed 2026-09-03 -> ADR 0045
Refs: 0022 mentions SEQUENCE only

Rescheduling a 20k-contact campaign is a second full send cycle with its own
capacity plan, throttle, and gate evaluation. Unmodelled. Same for cancel.

DECIDED 2026-09-03 -> ADR 0045. Campaign event details are versioned; every
attempt records the revision it carried; attempts are one row per operation,
not per contact; send plans are immutable and versioned; cancel is a delivery
operation rather than a deletion; reschedule patches the provider event instead
of cancel-then-create; the provider event id is required before any dependent
operation, and an `unknown` create blocks rather than guesses.

The shaping case is reschedule during an in-flight multi-day send, where some
contacts need an update and some a create. That split is why attempts carry a
revision reference.

Metering taken by recommendation, reversible: usage counts operations rather
than contacts, so a twice-rescheduled campaign costs roughly 3x. Flagged
because it changes 0040's limit dimensions and was not separately confirmed.

### W11 - No availability target; single VPS is a SPOF
Status: closed 2026-09-03 -> ADR 0050
Refs: 0036 covers backups only

Docs call contacts, send plans, attempts, and audit logs "product-critical"
while running one VPS with no RTO/RPO, no failover, no restore-time target.

### W12 - "High volume" is never a number
Status: closed 2026-09-03 -> ADR 0047

No throughput, concurrency, queue-depth, or campaign-size targets anywhere.
Without a target the capacity planner and throttle cannot be validated or
load-tested, and "can our mailboxes support this campaign" has no yardstick.

## D. Documentation hygiene

### W13 - ADRs edited in place; no status, date, or supersedes
Status: closed 2026-09-03 -> ADR 0054

The 2026-08-27 pass rewrote 0010, 0014, 0015, 0016, 0019, 0020, 0021, 0022,
0035 in place. The record of what changed and why is gone, which is the main
reason to keep ADRs. No ADR carries status, date, context, or consequences.

### W14 - Two sources of truth for open decisions
Status: closed 2026-09-03 - brief now points to open-decisions.md

architecture-decision-brief.md has an "Open Decisions" section duplicating
open-decisions.md. Already identical; will drift.

### W15 - Code fences used as bullet lists
Status: closed 2026-09-03 - 24 blocks converted

The brief uses ```txt blocks as lists throughout. Hurts readability and diffs.

### W16 - "No architecture-level open decisions remain" is not true
Status: closed 2026-09-03 - open-decisions.md rewritten
Refs: brief, open-decisions.md

Contradicted by W1-W12 above, and cannot be true before a data model exists.

## E. Findings from the existing Bulk-Calendar-Invites v1 codebase

Added 2026-09-02 after inspecting C:/growthInfi/Bulk-Calendar-Invites.
That repository is a working v1 of this product: Google OAuth, AES-256-GCM
token encryption, BullMQ scheduler and worker, round-robin sender assignment,
atomic batch locking by Postgres RPC, retry classification, and account
lifecycle states. Native mode is a port, not a greenfield build.

### W17 - Per-contact events vs batched attendees
Status: RESOLVED 2026-09-03 - premise was wrong, not a blocker
Refs: 0010 vs Bulk-Calendar-Invites `scheduler.js`, `workers/email.worker.js`

Original claim: v1 creates ONE calendar event carrying up to `BATCH_SIZE = 50`
recipients in `attendees[]`, while ADR 0010 requires one private event per
contact, so 0010 costs a 50x throughput reduction against an unchanged
60-per-day account cap.

The 50x figure was wrong. It assumed v1's `daily_limit` counts events. It
counts recipients. Evidence, all from v1 source:

    scheduler.js:132   remainingLimit   = daily_limit - sent_today
    scheduler.js:135   currentBatchLimit= min(BATCH_SIZE, remainingLimit)
    scheduler.js:138   lock_recipients_for_batch_v2(p_limit: currentBatchLimit)
                       -> the limit is applied to the RECIPIENT query

    email.worker.js:119  complete_email_batch_v2(p_amount: emails.length)
                       -> sent_today increments by recipient count, not by 1

`gmail.controller.js:340` caps `daily_limit` at 60, default 50. So v1's actual
ceiling was 60 recipients per account per day - identical to what ADR 0010
produces. Batching never bought throughput. It bought API calls: one
`events.insert` per 50 recipients instead of 50.

Consequences:

- ADR 0010 stands unchanged. It costs nothing v1 was actually getting.
- This is not a blocking product decision. Removed from the blocker set.
- The API-call saving only becomes relevant far above 60/account/day, and at
  that volume the binding constraint is Google's limit on invitations to
  external guests, which is counted per guest and so does not move when you
  batch. Batching relieves the quota that was never binding.
- The real open question was never batching. It is W4/W12: what is the true
  per-account ceiling? v1's 60 was self-imposed and never tested against
  Google's actual limit, so v1's production data cannot answer it either.

Carried forward into W4: the capacity model needs a documented, sourced number
per provider, not an inherited guess.

AMENDED 2026-09-03 - the tradeoff is real, in a different currency.

The correction above stands where it applied: batching does not raise
per-mailbox throughput, because Workspace invitation limits count guests, not
events. But against the platform-wide 1M requests/day Calendar API threshold
now documented in W4, per-contact events cost 50x the API calls batching would,
and that threshold is shared across all customers and cannot be raised.

So W17 was never a customer-throughput question. It is a platform COST
question - and, per the W4 correction, not a ceiling question either, because
the daily threshold bills rather than blocks:

    batched:      1 events.insert per 50 recipients
    per-contact:  1 events.insert per recipient  (ADR 0010)

ADR 0010 is unchanged and should be. The point of recording this is that the
price of per-contact privacy is now visible and quantified - a future variable
API cost, beginning above ~700k invitations/day platform-wide, with at least 90
days' notice before it starts - which is a better reason to keep 0010 than the
assumption that it was free. Feeds the fair-share
allocation in W4b and the plan limit dimensions in 0040.

### W17b - v1 can send an invitation and fail to record it
Status: closed 2026-09-03 - covered by 0014, tested per 0052
Refs: `workers/email.worker.js:126-134`, ADR 0014

v1 calls `createCalendarEvent` first, then `complete_email_batch_v2`. Its own
comment on the failure branch reads: "In this rare case, the email was sent
but DB didn't update." The invitation is real, the record is not, and recovery
is left to the scheduler pausing the account.

This is exactly the send-then-record ordering ADR 0014's reservation and
outbox model exists to prevent: reserve before the provider call, treat a
failure after it as `unknown` rather than failed, reconcile against stored
provider event IDs. Noted because it is the concrete failure the ADR is
abstract about, and because porting v1's worker without porting 0014's
ordering would reintroduce it.

### W18 - Send-critical RPC definitions are not in version control
Status: partly closed 2026-09-03 - v2 bodies unrecoverable, technique recovered
Refs: Bulk-Calendar-Invites; 0013, 0014

`lock_recipients_for_batch_v2`, `complete_email_batch_v2`,
`cleanup_failed_batch`, and `get_campaigns_with_stats` exist only inside
Supabase. No migration files are committed. The atomic reservation logic that
ADR 0014 treats as safety-critical exists in exactly one place, unversioned
and unreviewable. Extract to committed migrations before anything else.

Confirmed 2026-09-02 by local search: zero `.sql` files in the v1 repository,
and no `.env` files on disk. The function names appear only as string literals
in `backend/scheduler.js`, `backend/workers/email.worker.js`, and the v1
architecture doc. There is no local copy of the bodies at all.

Extraction staged at `docs/legacy-v1-schema/` - see its README and EXTRACT.sql.
Requires someone with Supabase project access to run it.

### W19 - Live duplicate-send hazard in v1
Status: wontfix 2026-09-03 - v1 grounded, not being deployed again
Refs: Bulk-Calendar-Invites `backend/server.js`, `backend/docker-compose.yml`

`server.js` starts the scheduler and imports the worker in-process, while
docker-compose also defines separate `scheduler` and `worker` services.
Running all three executes scheduling and sending more than once. Flagged in
v1's own PROJECT_ARCHITECTURE.md and still unresolved.

### W20 - No tests on the send engine
Status: closed 2026-09-03 -> ADR 0052
Refs: Bulk-Calendar-Invites `backend/package.json`

`npm test` is the default placeholder that exits 1. There are no test
libraries declared. The untested code is the send path, which ADR 0014 makes
the safety-critical component of the system.

### W21 - v1 runs with no database-level tenant isolation
Status: wontfix 2026-09-03 - v1 grounded; project1 covered by 0043
Refs: 0007, W7, Bulk-Calendar-Invites `backend/lib/supabase.js`

v1 connects with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses row-level
security entirely. Every query is trusted application-side with no database
guard. This is the same defect as W7, already in production. The migration to
self-hosted Postgres is the cheapest opportunity to fix it.

### W22 - Frontend stack conflicts with ADR 0004
Status: closed 2026-09-03 -> ADR 0053, superseding 0004
Status: CORRECTED 2026-09-07 -> ADR 0056, superseding 0053
Refs: 0004 vs C:/growthInfi/Frontend

An existing React 19 + Vite + Tailwind 4 SPA has working Campaign,
CampaignDetails, Settings, Sidebar, and protected-route screens. ADR 0004
specifies Next.js, which means discarding working UI. Either revisit 0004 or
budget the rebuild explicitly; do not leave the conflict unstated.

CORRECTION 2026-09-07. "Working screens" was wrong. The finding was written
from the file listing rather than from the source, and ADR 0053 inherited the
error as its opening premise.

Read in full on 2026-09-07, `C:/growthInfi/Frontend` is 796 lines that make no
API call of any kind - no `fetch`, no HTTP client, no API base URL - and render
hardcoded arrays on every screen. The three route guards import
`../auth/useAuth`, which does not exist, and nothing imports the guards, which
is why the build still passes. `/campaign` is a `ToolRedirect` out to another
application; `CampaignDetails.jsx`, the only substantial file, is never routed.
The vocabulary throughout - replies, reply rate, sequences, `{{first_name}}`
templating - is a cold-email sequencer, not a calendar invitation product.

The stack decision is unaffected and stands on its deployment argument, which
0053 also made and which the product owner confirmed on 2026-09-07: both tiers
self-host on one VPS under 0006, so a Vite build is static files the existing
reverse proxy serves and Next.js would mean a second Node process for nothing.

What changes is cost. The dashboard is a greenfield build. The estimate behind
the W1 deferral was implicitly crediting screens that do not exist, which is
the second recorded reason to reopen W1.

Method note, recorded because it generalises: this finding and W17 both
asserted a defect from structure - a file listing, an assumed column meaning -
rather than from reading the source, and both were wrong in the direction that
made the finding look more serious. Read the code before writing the finding.
### W18b - The retained Supabase project is not the production database
Status: closed 2026-09-03 - see legacy-v1-schema/FINDINGS.md
Refs: W18, W23

Extraction run 2026-09-03 against project `esqkjstybahwwrtjwtln`. None of the
four functions v1's code calls exist there, in any schema. Only their
predecessors do. The data is 2 campaigns, 7 recipients and 2 accounts, newest
row 2026-04-30, against a last code commit of 2026-05-19.

This is a development or abandoned project. The production Supabase project is
elsewhere, presumably under the departed teammate's account alongside the
Google Cloud project and the Render service.

This corrects an earlier statement in W23 that Supabase was "the only
recoverable asset". It was not. No part of v1's production infrastructure is
under company control, and the v2 function bodies are lost rather than at risk.

Recovered anyway, and the reason the exercise still paid: the v1 ancestor
`lock_recipients_for_batch` shows the reservation technique the v2 version was
built on - `FOR UPDATE SKIP LOCKED` in a subquery, with the status transition
and RETURNING in a single statement. That is the shape ADR 0014's reservation
should take, and it was the actual objective of W18.

Also recovered: a race in `increment_account_sent_safe`, which reads
`sent_today` without `FOR UPDATE` and then writes, so two concurrent workers can
both pass the daily-limit check and both increment, exceeding the cap. Recorded
because it is the exact failure ADR 0047 and 0019 exist to prevent, found in
working production-intended code, and because a port of v1 would inherit it.

### W23 - v1 production infrastructure is not under company control
Status: partly resolved - continuity risk closed, data exposure open
Refs: Bulk-Calendar-Invites git history; W18, W21

Every commit on Bulk-Calendar-Invites is authored from a departed teammate's
personal Gmail account; last commit 2026-05-19. The code is safe - the remote
is the Growth-Infi GitHub org. The infrastructure is not: the Google Cloud
project, Supabase project, and Render service were almost certainly created
under that personal account, and current team access is unconfirmed.

Consequences:

- Continuity: CLOSED. v1 is not live. It is grounded - no users are being
  served, so there is nothing to keep running and nothing to migrate off. The
  inaccessible Render service is dead weight, not a liability.
- Offboarding: the Supabase service role key bypasses RLS entirely (W21), so
  retained access means unrestricted read/write on production customer data,
  including connected-mailbox OAuth tokens.
- Verification: a project under a personal Gmail cannot use the Internal user
  type, which requires a Workspace organisation. v1 therefore either completed
  External verification, or has been running in Testing mode all along with a
  100-user cap and 7-day refresh-token expiry. Observed reconnection frequency
  in production distinguishes the two.

Decision: do not attempt to inherit the existing Google Cloud project. Create
a new one under the GrowthInfi Workspace organisation and begin External
verification early, in parallel with the build, since it is wall-clock time
that overlaps development. Treat v1's project as legacy.

CONFIRMED 2026-09-02: team has Supabase access only. Google Cloud and Render
are both inaccessible.

- Google Cloud: accepted, new project under a company-controlled account.
- Render: `ENCRYPTION_KEY` is lost, so the AES-256-GCM encrypted OAuth tokens
  in `gmail_accounts` are permanently undecryptable. This costs nothing:
  Google refresh tokens are bound to the issuing OAuth client, so moving to a
  new client invalidates them regardless. Users reconnect either way.
- Render: no action needed. v1 is grounded, so the inability to deploy,
  restart, or read logs costs nothing. Leave it; it will lapse on its own.
- Supabase: believed to be the only recoverable asset. This turned out to be
  wrong - see W18b. The retained project is a development one; production is
  also outside company control. Nothing of v1's infrastructure was recovered.

CONFIRMED 2026-09-03: v1 is not live. It is grounded.

What this changes:

- No migration path to design. The v1 database is a reference artifact and a
  source of historical evidence, not a system to cut over from. Nothing needs
  to be preserved for running customers, because there are none.
- No pressure to match v1 behaviour. project1 is free to adopt the per-contact
  event model (W17) without breaking anyone.
- The offboarding exposure below is now about data at rest, not live systems.
  Still real, still worth closing, but it is a cleanup task rather than an
  incident.
- The extraction stays worth doing. It is the RPC logic (W18) and the send
  history (below) that have value, and both die with the Supabase project.

Second reason to extract, beyond W18: the v1 database holds real production
send history - actual daily limits in use, batch throughput, failure and block
rates. That is empirical input for the capacity model that W4 and W12 say is
missing and that W17 needs. Analysis queries to be written once
`02-columns.tsv` confirms real column names.


## F. Not defects, recorded so they are not re-litigated

- Postgres owns the send plan, Redis only executes (0013). Correct.
- Idempotency keyed on identity, not timestamps; timeout is `unknown` (0014). Correct.
- No random provider rotation, named as reputation evasion (0020). Correct.
- Delivery Buckets keyed on provider/MX, not domain name (0019). Correct.
- Deliverability gate as a state machine with hysteresis (0016). Correct.
- Domain glossary with explicit "Avoid" terms (CONTEXT.md). Keep doing this.
