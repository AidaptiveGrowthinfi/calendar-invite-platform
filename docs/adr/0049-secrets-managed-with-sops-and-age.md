# Manage secrets with SOPS and age, not plaintext .env

Date: 2026-09-03
Closes: W8
Refs: 0033, 0036, 0046

ADR 0033 accepted that provider tokens are encrypted at rest while the
encryption key lives in a .env file on the same VPS as the encrypted data.
Against host compromise that buys close to nothing, and the ADR offered "a
managed KMS can replace this later" without a threat model.

Two developments make this worth fixing now rather than later. ADR 0046
introduces a suppression pepper whose loss is silent and unrecoverable: without
it the platform does not error, it simply resumes sending to people who
unsubscribed, with nothing to detect. And the v1 experience in W23 showed
exactly how secrets are lost in practice - not by attack, but by a departing
teammate and an inaccessible hosting account.

Secrets are encrypted with SOPS using age keys and committed to the repository
in encrypted form. The age private key is held on the VPS and in the team's
password manager, never in the repository. Decryption happens at deploy time.

This is chosen over a managed secret manager because it fits the existing
Docker Compose on VPS deployment without adding a hosted dependency or a
runtime network call on the boot path, and over plaintext .env because the
current arrangement has no recovery story and no access record.

What it does and does not defend against, stated plainly since 0033 omitted it:

- Defends against secret loss through personnel change or lost hosting access,
  which is the failure that actually occurred in v1. Encrypted secrets are in
  git history; the age key is in two places by policy.
- Defends against accidental disclosure. A secret pasted into a log, an issue,
  or a support message is ciphertext.
- Defends against repository compromise alone. Ciphertext without the age key
  is not useful.
- Does NOT defend against host compromise. An attacker with root on the VPS can
  read the decrypted values from the running process, as they could before.
  Reducing that requires a managed KMS with per-operation authorisation and is
  explicitly out of scope; it is recorded here so the limit is known rather
  than assumed away.

The suppression pepper from 0046 is subject to an additional rule: it can never
be rotated, so it is included in backup and restore procedures and verified
during the restore testing ADR 0036 requires. A restore that silently comes
back without a working pepper is a correctness failure, not an availability
one, and the restore test must assert it.
