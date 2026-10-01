# Require stricter verification while sender reputation is unestablished

Date: 2026-09-03
Closes: W6
Refs: 0025, 0015, 0016, 0019

AMENDED IN PART by ADR 0055 on 2026-09-07. The bounce-history clause below
reads "anywhere in the platform's history"; ADR 0055 narrows it to within the
organisation, because a platform-wide check contradicts the cross-tenant
isolation ADR 0046 was written to guarantee. Every other requirement in this
ADR stands. Retained unedited otherwise as the original record.

ADR 0025 chose non-SMTP email intelligence as the default verification path,
which means invalid addresses are discovered through bounces rather than before
sending. ADR 0019's deliverability gate is bounce-driven, and ADR 0016's
warm-up limits are tightest on a new sending domain.

Composed, these place the weakest verification precisely at the moment
reputation is most fragile: the first sends from a fresh domain, where a small
number of bounces is a large proportion of volume and does disproportionate
damage. None of the three ADRs acknowledges the interaction.

While a sending domain is in warm-up, and for its first campaign:

- Contacts must pass a stricter verification bar before they may be planned:
  valid MX for the recipient domain, and no prior bounce recorded for the
  address anywhere in the platform's history. Addresses that only pass syntax
  and disposable-domain checks are held back rather than sent.
- The initial send cap is lower than the warm-up schedule would otherwise
  allow.
- The deliverability gate treats early bounce rate as a hard stop rather than a
  slow-down. On a domain with no reputation there is no benefit to continuing
  at reduced rate; the correct action is to stop and let the customer fix the
  list.

Both restrictions lift once the domain leaves warm-up with acceptable bounce
and complaint rates, at which point 0025's default verification applies as
written and 0019's normal graduated response resumes.

The deeper SMTP verification path in 0025's Option B remains optional and is
not made a prerequisite by this ADR. Holding back unverifiable addresses during
warm-up achieves the same protection without requiring outbound port 25.
