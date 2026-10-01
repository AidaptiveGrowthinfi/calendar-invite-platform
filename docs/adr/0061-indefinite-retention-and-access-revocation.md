# Retain all data indefinitely; revoking access never deletes

Date: 2026-09-08
Supersedes: the retention dimension in 0040
Narrowed by: ADR 0065 (2026-09-08)
Refs: 0031, 0032, 0040, 0046, 0055, 0060

ADR 0040 listed "retention period for logs and analytics" as one of ten priced
plan dimensions, which made how long a customer's data survives a function of
what they pay. That is not the product.

Every organisation retains all of its data indefinitely, on every plan, whether
the plan is a paid subscription or an internal one. Nothing is deleted because
of a plan tier, and nothing is deleted because a bill went unpaid.

Revoking access is a gate, not a data operation. An organisation that is
`past_due`, `cancelled`, `expired`, or suspended internally loses the ability
to use the product. It loses no rows. When access is restored the organisation
finds its complete history — campaigns, audiences, send plans, attempts,
responses, attendance and audit — exactly as it was, and it is the same
organisation rather than a new one.

Consequences:

- ADR 0040's dimension list drops from ten to nine. `retention_days` is not a
  plan entitlement and does not appear in the `plan_dimension` enum. Removing
  it removes the only member of what slice 6 called the configuration kind, so
  plan dimensions are now two kinds - flow and stock - rather than three.

- No retention job exists. There is nothing for it to do.

  Narrowed by ADR 0065 (2026-09-08): this holds for a customer's product data,
  which is what this ADR is about. It does not hold for two ingestion
  byproducts - `audience_import_rejection.raw_row` and
  `provider_webhook_event.payload` - whose minimisation windows in schema
  slices 2 and 5 stand, and which are cleared by two scheduled jobs. W28.

- Slice 7 needs no sealed analytics roll-up. The question that slice was
  blocked on assumed source rows expire; they do not, so ADR 0026's segments
  are derived from `invitation_response` and the attendance sync whenever they
  are asked for, and a campaign from three years ago answers the same questions
  as one from last week.

- **ADR 0060's seal loses one of its three justifications.** It was argued
  partly on billing evidence having to outlive whatever retention applied to
  attempts, and that is now vacuous. Stating it plainly rather than quietly
  keeping the conclusion: the seal survives on the two remaining legs, and both
  are load-bearing on their own. Which plan version was in force during a past
  period is not otherwise reconstructable, because `subscription` holds only
  the current one and is updated in place. And a bill must not silently restate
  itself when attempts are corrected, backfilled, or reconciled after the fact.
  Neither depends on deletion.

- Erasure is unaffected and remains the only path that deletes anything. ADRs
  0046 and 0055 already define it: an erasure request deletes the contact row
  and its bounce state, and suppression survives as a keyed digest precisely so
  that honouring an unsubscribe does not require retaining an address. This ADR
  is about the platform's own retention policy. It is not an exemption from a
  data subject's request, and the two must not be conflated in code: "we never
  delete" is the answer to a billing question and never to an erasure one.

- Storage grows monotonically, and that is the accepted price. The largest
  table by far is `invitation_attempt`, one row per operation under ADR 0045,
  and nothing prunes it. At ADR 0047's volumes this is affordable, and it is
  what the guarantee costs.

- Indefinite retention has to be disclosed. Storage limitation under GDPR and
  DPDP requires a stated retention period or the criteria used to determine it;
  "for the life of the account" is a legitimate criterion, but it must appear
  in the privacy policy and the DPA rather than being an unwritten platform
  behaviour. Product and legal, not schema, and recorded here so it is not
  discovered during a customer's security review.

- Nothing in the schema keys off "this organisation was once suspended". A
  restoration is a change of `subscription.status` and nothing else. There is
  no re-onboarding flow, no archive to rehydrate, and no cold storage tier,
  because each of those would be a way for the guarantee to fail quietly.
