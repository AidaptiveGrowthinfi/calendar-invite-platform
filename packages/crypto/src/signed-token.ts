/**
 * RSVP and unsubscribe token signing. Slice 5.
 *
 * Slice 5 decides that no per-token row is stored - the token carries its own
 * claims and a signature, and revocation is by key rotation. That makes the key
 * id part of the wire format: a verifier must know which key to check against,
 * and a token signed by a retired key must remain verifiable until the policy
 * says otherwise.
 *
 * The rotation policy itself is OPEN-S5 and is NOT decided here. This module
 * supports rotation; it does not schedule it. `retiredSigningKeys` is empty
 * until someone decides.
 *
 * Wire format, URL-safe and copy-pasteable out of an email client:
 *
 *     <keyId>.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
 *
 * The signature covers `keyId + "." + encodedPayload`, so a token cannot be
 * re-attributed to a different key by editing the first segment.
 *
 * The pepper from ADR 0046 is NOT usable here and the type system enforces it:
 * this module takes a `SigningKey`, and `validateKeyMaterial` rejects key
 * material that reuses the pepper as one.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SigningKey } from './keys';

export class InvalidSignedTokenError extends Error {
  constructor(reason: string) {
    super(`invalid signed token: ${reason}`);
    this.name = 'InvalidSignedTokenError';
  }
}

export type TokenPurpose = 'rsvp' | 'unsubscribe';

export interface TokenClaims {
  /** What the token authorises. A token issued for one purpose never works for the other. */
  readonly purpose: TokenPurpose;
  /** Seconds since the epoch. */
  readonly issuedAt: number;
  /** Seconds since the epoch, or null for a token that does not expire on its own. */
  readonly expiresAt: number | null;
  /** Opaque to this module: whatever slice 5's callers need to resolve the subject. */
  readonly subject: Readonly<Record<string, string>>;
}

const b64url = (b: Buffer): string => b.toString('base64url');

function signaturePart(key: SigningKey, signingInput: string): Buffer {
  return createHmac('sha256', key.secret).update(signingInput, 'utf8').digest();
}

export function issueSignedToken(key: SigningKey, claims: TokenClaims): string {
  if (key.id.includes('.')) {
    throw new InvalidSignedTokenError('key id must not contain a dot - it is the field separator');
  }
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signingInput = `${key.id}.${payload}`;
  return `${signingInput}.${b64url(signaturePart(key, signingInput))}`;
}

export interface VerifyOptions {
  readonly activeKey: SigningKey;
  readonly retiredKeys?: readonly SigningKey[];
  /** Defaults to now. Injectable so expiry is testable without faking the clock. */
  readonly at?: Date;
  /** The purpose the caller expects. A mismatch is a rejection, not a warning. */
  readonly expectedPurpose: TokenPurpose;
}

/**
 * Verifies a token and returns its claims.
 *
 * Every failure throws the same error type with a short reason. The reason is
 * for logs; it must not be echoed to the person clicking the link, because the
 * difference between "bad signature" and "expired" tells an attacker which
 * half of the token to keep working on.
 */
export function verifySignedToken(token: string, options: VerifyOptions): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidSignedTokenError('wrong number of segments');
  }
  const [keyId, payload, signature] = parts as [string, string, string];

  const candidates = [options.activeKey, ...(options.retiredKeys ?? [])];
  const key = candidates.find((k) => k.id === keyId);
  if (key === undefined) {
    throw new InvalidSignedTokenError('unknown key id');
  }

  const expected = signaturePart(key, `${keyId}.${payload}`);
  const presented = Buffer.from(signature, 'base64url');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new InvalidSignedTokenError('signature mismatch');
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
  } catch {
    throw new InvalidSignedTokenError('payload is not JSON');
  }

  if (claims.purpose !== options.expectedPurpose) {
    throw new InvalidSignedTokenError('purpose mismatch');
  }

  const nowSeconds = Math.floor((options.at ?? new Date()).getTime() / 1000);
  if (claims.expiresAt !== null && nowSeconds >= claims.expiresAt) {
    throw new InvalidSignedTokenError('expired');
  }

  return claims;
}
