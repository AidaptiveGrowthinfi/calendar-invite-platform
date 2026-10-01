/**
 * The provider error taxonomy.
 *
 * Slice 4 fixes these five values on `invitation_attempt.error_class`. The
 * classification was learned in v1 production and `spec/05-invariants-and-tests.md`
 * requires it reproduced as recorded fixtures rather than relearned.
 *
 * The retry schedule per class is **OPEN-S2** — the taxonomy is decided, the
 * numbers are not. Nothing here may invent them. `retryPolicy` is the single
 * configuration seam the backlog names as the workaround; it is deliberately
 * left unpopulated so that a missing decision fails loudly at the call site
 * rather than quietly acquiring a default.
 */

export const PROVIDER_ERROR_CLASSES = [
  'rate_limited',
  'backend_error',
  'transient_network',
  'auth_failure',
  'permanent_rejection',
] as const;

export type ProviderErrorClass = (typeof PROVIDER_ERROR_CLASSES)[number];

/**
 * Whether a class is retryable at all. This much *is* decided: an auth failure
 * and a permanent rejection are not transient, and retrying them burns quota
 * against a call that cannot succeed.
 *
 * How many times and how far apart is OPEN-S2.
 */
export const RETRYABLE: Readonly<Record<ProviderErrorClass, boolean>> = Object.freeze({
  rate_limited: true,
  backend_error: true,
  transient_network: true,
  auth_failure: false,
  permanent_rejection: false,
});

export interface RetryPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
}

/** OPEN-S2. Populated from configuration; there is no default and must not be one. */
export type RetryPolicyByClass = Readonly<Partial<Record<ProviderErrorClass, RetryPolicy>>>;
