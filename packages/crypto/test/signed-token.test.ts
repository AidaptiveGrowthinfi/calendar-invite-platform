import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SigningKey } from '../src/keys';
import {
  InvalidSignedTokenError,
  issueSignedToken,
  verifySignedToken,
  type TokenClaims,
} from '../src/signed-token';

const activeKey: SigningKey = { id: 'k2', secret: randomBytes(32) };
const retiredKey: SigningKey = { id: 'k1', secret: randomBytes(32) };
const otherKey: SigningKey = { id: 'k2', secret: randomBytes(32) };

const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  purpose: 'unsubscribe',
  issuedAt: 1_760_000_000,
  expiresAt: null,
  subject: { campaignMemberId: 'cm-1' },
  ...over,
});

describe('RSVP and unsubscribe tokens - slice 5', () => {
  it('round-trips claims', () => {
    const token = issueSignedToken(activeKey, claims());
    const verified = verifySignedToken(token, { activeKey, expectedPurpose: 'unsubscribe' });
    expect(verified.subject).toEqual({ campaignMemberId: 'cm-1' });
  });

  it('is URL-safe, so it survives an email client and a redirect', () => {
    const token = issueSignedToken(activeKey, claims());
    expect(token).toBe(encodeURIComponent(token).replace(/%2E/gu, '.'));
  });

  it('rejects a token signed by a key the verifier does not hold', () => {
    const token = issueSignedToken(otherKey, claims());
    expect(() => verifySignedToken(token, { activeKey, expectedPurpose: 'unsubscribe' })).toThrow(
      InvalidSignedTokenError,
    );
  });

  it('rejects a tampered payload', () => {
    const token = issueSignedToken(activeKey, claims());
    const [keyId, , signature] = token.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify(claims({ subject: { campaignMemberId: 'cm-999' } })),
      'utf8',
    ).toString('base64url');

    expect(() =>
      verifySignedToken(`${keyId}.${forgedPayload}.${signature}`, {
        activeKey,
        expectedPurpose: 'unsubscribe',
      }),
    ).toThrow(/signature mismatch/u);
  });

  it('cannot be re-attributed to another key by editing the key id', () => {
    // The signature covers keyId + "." + payload, so swapping the first
    // segment invalidates it even when the verifier holds both keys.
    const token = issueSignedToken(activeKey, claims());
    const [, payload, signature] = token.split('.') as [string, string, string];

    expect(() =>
      verifySignedToken(`${retiredKey.id}.${payload}.${signature}`, {
        activeKey,
        retiredKeys: [retiredKey],
        expectedPurpose: 'unsubscribe',
      }),
    ).toThrow(/signature mismatch/u);
  });

  it('an unsubscribe token does not work as an RSVP token', () => {
    const token = issueSignedToken(activeKey, claims({ purpose: 'unsubscribe' }));
    expect(() => verifySignedToken(token, { activeKey, expectedPurpose: 'rsvp' })).toThrow(
      /purpose mismatch/u,
    );
  });

  it('honours expiry against an injected clock', () => {
    const expiresAt = 1_760_000_100;
    const token = issueSignedToken(activeKey, claims({ expiresAt }));
    const options = { activeKey, expectedPurpose: 'unsubscribe' } as const;

    expect(
      verifySignedToken(token, { ...options, at: new Date((expiresAt - 1) * 1000) }).expiresAt,
    ).toBe(expiresAt);

    expect(() => verifySignedToken(token, { ...options, at: new Date(expiresAt * 1000) })).toThrow(
      /expired/u,
    );
  });

  describe('rotation - the format supports it, the policy is OPEN-S5', () => {
    it('a token signed by a retired key still verifies while the key is held', () => {
      const token = issueSignedToken(retiredKey, claims());
      const verified = verifySignedToken(token, {
        activeKey,
        retiredKeys: [retiredKey],
        expectedPurpose: 'unsubscribe',
      });
      expect(verified.purpose).toBe('unsubscribe');
    });

    it('dropping a retired key revokes every token it signed', () => {
      const token = issueSignedToken(retiredKey, claims());
      expect(() => verifySignedToken(token, { activeKey, expectedPurpose: 'unsubscribe' })).toThrow(
        /unknown key id/u,
      );
    });
  });
});
