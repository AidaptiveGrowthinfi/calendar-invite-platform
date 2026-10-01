/**
 * platform/crypto - one home for every keyed operation.
 *
 * `spec/01-modules.md` gives this module two "must not" rules:
 *
 *   - Must not hold two email normalisers.
 *   - Must not use the suppression pepper for anything else.
 *
 * Both are enforced mechanically rather than by review:
 * `scripts/gate-one-normaliser.mjs` fails CI on a second normaliser anywhere in
 * the workspace, and `validateKeyMaterial` refuses key material that reuses the
 * pepper as a signing or encryption key.
 */

// The single email normaliser. ADR 0046, frozen.
export { normaliseEmailAddress, maskNormalisedAddress, InvalidEmailAddressError } from './email';

// Suppression. ADR 0046.
export {
  suppressionEntryFor,
  suppressionDigestMatches,
  digestOfNormalised,
  type SuppressionEntry,
} from './suppression';

// Provider token encryption at rest. ADR 0033.
export { encryptToken, decryptToken, TokenDecryptionError } from './token-encryption';

// RSVP and unsubscribe tokens. Slice 5, rotation policy OPEN-S5.
export {
  issueSignedToken,
  verifySignedToken,
  InvalidSignedTokenError,
  type TokenClaims,
  type TokenPurpose,
  type VerifyOptions,
} from './signed-token';

// API keys. Slice 1, ADR 0034.
export {
  generateApiKey,
  apiKeyDigest,
  apiKeyDigestMatches,
  parseApiKey,
  base62EncodeUuid,
  base62DecodeUuid,
  InvalidApiKeyError,
  type GeneratedApiKey,
  type ParsedApiKey,
} from './api-key';

// Key material.
export {
  validateKeyMaterial,
  KeyMaterialError,
  SUPPRESSION_PEPPER_BYTES,
  TOKEN_ENCRYPTION_KEY_BYTES,
  SIGNING_KEY_BYTES,
  type KeyMaterial,
  type SigningKey,
} from './keys';
