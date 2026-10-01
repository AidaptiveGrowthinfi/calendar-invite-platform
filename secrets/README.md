# Secrets

ADR 0049. SOPS with age. Encrypted files live here and are committed; the age
private key never is.

## One-time setup, per person

```sh
age-keygen -o ~/.config/sops/age/keys.txt
```

Send the **public** key (the `age1...` line printed as `# public key:`) to
whoever maintains `.sops.yaml`, and add it under `creation_rules`. Store the
private key in the team password manager as well as on disk — ADR 0049 requires
it to exist in two places, because W23 is the record of what happens when it
does not.

## Files

| File                  | Holds                                                   |
| --------------------- | ------------------------------------------------------- |
| `production.enc.yaml` | Production environment. Decrypted on the VPS at deploy. |
| `staging.enc.yaml`    | Staging (ADR 0037).                                     |

Neither exists yet. Nothing is encrypted until the age recipients in
`.sops.yaml` are real — the placeholder there is not a key.

## Usage

```sh
sops secrets/production.enc.yaml            # edit in place, re-encrypts on save
sops --decrypt secrets/production.enc.yaml  # print (do not redirect into the repo)
```

## The pepper

`SUPPRESSION_PEPPER` is subject to a rule the other secrets are not: it can
**never** be rotated. ADR 0046 computes suppression digests from it, and the
addresses that produced them are deliberately not kept, so there is nothing to
recompute from.

Losing it does not raise an error. The platform resumes sending to people who
unsubscribed, and nothing in the data shows it happened.

It is therefore part of backup and restore, and ADR 0036's restore rehearsal
must assert that a restored environment comes back with a **working** pepper —
not merely that the process starts. That assertion belongs to E0-5.
