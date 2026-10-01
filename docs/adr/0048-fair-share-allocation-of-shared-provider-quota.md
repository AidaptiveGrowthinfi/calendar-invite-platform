# Allocate shared provider quota by per-organisation fair share

Date: 2026-09-03
Closes: W4b
Refs: 0019, 0047, 0043

Google Calendar API quota is granted per Cloud project, and the platform has
one project. Every organisation therefore draws on a single shared counter, and
one organisation's large campaign consumes capacity every other organisation
needs. No data crosses between tenants, so this is not an isolation failure; it
is a capacity coupling, and without a decision it resolves itself as
first-come-first-served.

The throttle owns platform-wide provider quota as one more reservation
dimension alongside the limits already listed in ADR 0019, with a
per-organisation allocation. An organisation cannot exceed its share by
construction rather than by convention. The specific allocation is a tuning
value, not an architectural one, and is set once there is real traffic to
observe.

Two alternatives were considered and rejected.

Sharding across several platform-owned Cloud projects is rejected on policy
grounds first: Google treats multiple projects acting as one to circumvent
quota as a terms violation and enforces it, and the Workspace developer policy
carries an equivalent anti-circumvention clause. It is independently
unworkable, because each project would need its own OAuth client and its own
verification for the sensitive calendar.events scope, and refresh tokens are
bound to their issuing client - so no customer could ever be moved between
projects without being made to reconnect.

Customer-owned Cloud projects, where an organisation supplies its own OAuth
client, are not rejected but are not built now. This is the legitimate form of
per-customer isolation: the customer owns the project, so quota, billing, and
suspension risk are genuinely theirs, and no anti-circumvention clause applies
because the platform is not multiplying its own projects. The cost is heavy
onboarding - the customer configures a consent screen and, for external guests,
completes their own verification - which makes it enterprise-only in practice.

The Mailbox record will permit an organisation-supplied OAuth client from the
first schema version, as a nullable reference, so this remains reachable
without a migration. Nothing else is built for it now.

Source: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
