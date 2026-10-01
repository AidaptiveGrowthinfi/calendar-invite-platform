# Security

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository — the
**Security** tab, then **Report a vulnerability**. That opens a private advisory
visible only to the maintainers.

If that is unavailable, email inboundgrowths@gmail.com.

Expect an acknowledgement within a few working days. This is a two-person team;
we will tell you honestly where a fix sits rather than leave you guessing.

## What this repository is

A pre-launch product. There is no production deployment and there are no
customers, so nothing reported here currently puts user data at risk. That will
change, and this file will not.

## What is deliberately public

The security design is in the open, and that is intentional rather than an
oversight. It rests on keys, not on the design being secret:

- **Tenant isolation** is PostgreSQL row-level security, forced, with a policy
  comparing `organisation_id` to a transaction-local setting. See
  `docs/adr/0043-tenant-isolation-via-row-level-security.md`. Knowing the
  mechanism does not weaken it.
- **Suppression entries** are HMAC-SHA256 keyed digests, not addresses. The
  construction is documented in
  `docs/adr/0046-suppression-stored-as-keyed-digest.md`. It is not reproducible
  without the pepper, which is not in this repository and never will be.
- **API keys** carry an organisation prefix, and the stored digest covers the
  whole presented string, so a valid secret re-prefixed to another organisation
  authenticates against nothing.
- **Provider tokens** are AES-256-GCM encrypted at rest in `bytea` columns.

`docs/adr/0049-secrets-managed-with-sops-and-age.md` states plainly what this
does and does not defend against. It does **not** defend against host
compromise, and that limit is recorded rather than assumed away.

## Secrets

Encrypted SOPS files are committed; the age private keys are not, and are held
on the deployment host and in a password manager.

If you believe a secret has been committed to this repository, report it
privately as above rather than opening an issue. One of them —
`SUPPRESSION_PEPPER` — cannot be rotated, so an exposure of that value needs a
different response from the others.

## Legacy v1

`docs/legacy-v1-schema/` documents a **grounded, decommissioned** predecessor
system. It has no users and is not running. Findings recorded there describe
that decommissioned system, not this one.
