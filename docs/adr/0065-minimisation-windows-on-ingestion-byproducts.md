# Keep minimisation windows on two ingestion byproducts

Date: 2026-09-08
Narrows: 0061
Closes: W28
Refs: 0021, 0024, 0032, 0046, 0055, 0061

ADR 0061 states, as a consequence rather than an aside, that no retention job
exists and there is nothing for one to do. Schema slices 2 and 5, written the
day before it, each specify one. Slice 2 gives
`audience_import_rejection.raw_row` a retention window deleted with its import
after a fixed period by a scheduled job, and puts the uploaded file itself in
object storage under a lifecycle rule. Slice 5 gives
`provider_webhook_event.payload` the same treatment, noting that it carries
recipient addresses.

The documents disagreed and the specification could not state its scheduled-job
inventory. This ADR resolves it in favour of the slices, and narrows ADR 0061
rather than superseding it, because 0061's decision is untouched.

**ADR 0061 is about a customer's product data.** Its argument is that how long
that data survives must not be a function of what a customer pays, and every
consequence it lists is of that kind: campaigns, audiences, send plans,
attempts, responses, attendance, audit. That guarantee stands exactly as
written. Nothing is deleted because of a plan tier, nothing is deleted because
a bill went unpaid, and a restored organisation finds its complete history.

`raw_row` and `payload` are not that. They are byproducts of an ingestion,
retained only so the platform can explain itself afterwards — a customer's
original spreadsheet line so a rejection download can show them what was wrong
with the row they actually wrote, and a provider's raw body so a delivery
outcome can be traced back to what the provider actually said. Both hold
personal data the platform has no sending use for, and `payload` holds
addresses belonging to people the customer never uploaded.

The deciding argument is ADR 0061's own. It invokes storage limitation under
GDPR and DPDP to require that indefinite retention be disclosed with its
criterion stated. That principle is what makes "for the life of the account" a
legitimate criterion for a customer's campaigns, and it is the same principle
that argues against holding a provider's raw webhook body forever. A retention
policy that cannot distinguish a customer's audience from a debugging artefact
is not a policy.

Decided:

- The two windows in slices 2 and 5 stand as written. Two scheduled jobs exist.
- The window applies to the **payload columns and the uploaded file**, not to
  the rows that carry them. An `audience_import_rejection` row keeps its
  `source_row_number`, `reason` and `reason_detail` after `raw_row` is cleared,
  and a `provider_webhook_event` keeps its identity, type, correlation and
  `state` after `payload` is cleared. The count of what was rejected and why is
  product data under 0061 and does not expire; the customer's original text
  does. This is the same separation ADR 0046 makes between a suppression record
  and the address that produced it.
- The window length is one number and is not fixed here, for the reason ADR
  0040 does not fix prices: it is a product and legal judgement, it belongs in
  the privacy policy alongside the disclosure 0061 already requires, and it is
  configuration rather than a migration. It is not a plan dimension and must
  never become one — that is precisely what 0061 forbids.
- The disclosure ADR 0061 requires is extended to cover this. Two retention
  statements, not one: indefinite for product data, a stated window for
  ingestion byproducts.

Consequences:

- ADR 0061's "no retention job exists" is narrowed to product data. It receives
  a pointer and no other edit, per ADR 0054.
- Two jobs join the maintenance queue. They are the only jobs in the system
  that delete anything on a schedule, and they are named so in
  `spec/03-workers-and-jobs.md` so that a third is a decision rather than a
  pattern being followed.
- The erasure path is untouched. ADRs 0046 and 0055 still own the only
  request-driven deletion, and "we never delete" is still the answer to a
  billing question and never to an erasure one. These jobs are a third thing
  again — neither a policy about a customer's data nor a data subject's right,
  but the platform declining to keep a byproduct it no longer needs.
