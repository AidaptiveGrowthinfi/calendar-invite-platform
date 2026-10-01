# Define the native capacity model and volume targets

Date: 2026-09-03
Closes: W4, W12
Refs: 0010, 0019

ADR 0010 gates campaign throughput on "the safe capacity of the customer's
connected mailboxes" without saying what that capacity is or where the number
comes from. This ADR supplies the numbers and their sources, and states the
platform's volume targets so the planner and throttle can be validated and
load-tested against something.

Two independent limits apply, and they belong to different parties.

## The platform's limit: Google Calendar API quota

For Cloud projects created on or after 2026-05-01, which includes this
project's:

    10,000     requests / minute / project
       600     requests / minute / user / project
    1,000,000  requests / day / project   - a BILLING THRESHOLD, not a cap

The daily figure does not block requests. Google states that standard use of
the Calendar API is available at no additional cost and that usage under the
threshold is not billed; charges above it are planned for later in 2026 with at
least 90 days' notice. It is a cost boundary, not a capacity boundary.

Quota is evaluated over a sliding one-minute window, so a burst that exceeds a
per-minute limit rate-limits the following window until the average falls back
under. The throttle must therefore smooth, not merely cap.

Source: https://developers.google.com/workspace/calendar/api/guides/quota

## The customer's limit: Google Workspace use limits

    ~10,000  invitations to external guests in a "short period"
             -> external invitations throttled, and the user "might not be able
                to send any invitations to people outside their organization
                for a few hours"
    ~100,000 events created in a "short period" -> creation rate reduced
     ~2,000  emails to external guests via the Email guests feature

Source: https://knowledge.workspace.google.com/admin/calendar/avoid-calendar-use-limits

This is the limit that matters most, because breaching it throttles the
CUSTOMER's Workspace rather than the platform's project. It is a
customer-visible, customer-damaging failure, and the platform causes it.

Two properties make it impossible to plan against precisely. "Short period" has
no published denominator. And Google states that it does not publicise the exact
limits where stricter ones apply, which is the case for trial accounts and for
paid accounts during their first 60 days.

The platform therefore treats the published figure as an upper bound never to
be approached, not as a budget to consume.

## Volume targets

These are the numbers the planner, throttle, and load tests are built and
validated against:

    per mailbox        2,000 external invitations / day
    per platform     700,000 invitations / day before API charges apply
    campaign size     50,000 contacts, delivered over a multi-day plan
    reschedule        a full second cycle at the same cost (0045)

The per-mailbox figure is deliberately one fifth of the documented throttle
point. The margin exists because the real limit is undocumented for newer
accounts and because "short period" is undefined, so the platform cannot know
how close it is to the edge until it is over it.

For context on how conservative prior practice was: v1 capped each account at
60 recipients per day, roughly one thirtieth of this target and one
hundred-and-sixtieth of the documented limit. Native mode has substantially
more headroom than v1's behaviour implied.

## Throttle-signal handling

Because the true limit cannot be computed, it must be observed. Provider
throttling responses reduce the affected mailbox's effective ceiling
immediately and are released only through the Deliverability Gate's recovery
policy, as 0019 already requires for other signals. The observed ceiling and
current throttle state are stored per mailbox and reused across campaigns, so
a limit discovered once is not rediscovered by breaching it again.
