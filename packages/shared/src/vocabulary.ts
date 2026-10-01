/**
 * CONTEXT.md, encoded.
 *
 * `spec/00-overview.md` makes the vocabulary binding on identifiers, API paths,
 * UI copy and error messages, and gives the reason: v1's cold-email vocabulary
 * is what the frontend inherited, and ADR 0056 threw that away. A rule that
 * lives only in a markdown file is a rule somebody has to remember during
 * review, so the forbidden set is machine-readable and `scripts/gate-vocabulary.mjs`
 * checks it.
 *
 * CONTEXT.md remains the authority. This is a projection of it, and the pair
 * must be edited together.
 */

export interface Term {
  /** The term to use. */
  readonly use: string;
  /** Words CONTEXT.md lists under "Avoid" for this term. */
  readonly avoid: readonly string[];
}

export const VOCABULARY: readonly Term[] = Object.freeze([
  { use: 'organisation', avoid: ['account', 'tenant'] },
  { use: 'user', avoid: ['mailbox', 'sender'] },
  { use: 'mailbox', avoid: ['userAccount', 'sendingAccount'] },
  { use: 'audience', avoid: ['list', 'spreadsheet'] },
  { use: 'contact', avoid: ['recipient', 'lead'] },
  { use: 'suppressionList', avoid: ['unsubscribeList', 'blacklist'] },
  { use: 'campaign', avoid: ['blast'] },
  { use: 'sendPlan', avoid: ['queue'] },
  { use: 'invitationAttempt', avoid: ['sendJob', 'delivery'] },
  { use: 'nativeCalendarMode', avoid: ['apiMode', 'directMode'] },
  { use: 'calendarEmailMode', avoid: ['sendgridMode', 'icsMode'] },
  { use: 'hostedRsvp', avoid: ['trackingPage'] },
  { use: 'deliverabilityGate', avoid: ['spamCheck', 'emailChecklist'] },
  { use: 'campaignHealth', avoid: ['deliverabilityScore'] },
  { use: 'deliveryBucket', avoid: ['recipientDomainLimit'] },
  { use: 'brandedTrackingDomain', avoid: ['trackingUrl', 'redirectDomain'] },
  { use: 'sendingDomain', avoid: ['emailDomain'] },
  { use: 'calendarEmailTemplate', avoid: ['sendgridTemplate', 'emailDesign'] },
  { use: 'audienceImport', avoid: ['upload', 'spreadsheetImport'] },
  { use: 'meetingProvider', avoid: ['webinarTool', 'meetingType'] },
  { use: 'attendanceSync', avoid: ['reportImport', 'attendeeTracking'] },
]);

/**
 * Terms whose avoided form is too common in general programming to flag
 * mechanically. CONTEXT.md still forbids them in domain identifiers; the gate
 * cannot tell `list` the domain term from `list` the array operation, and a
 * gate that cries wolf gets disabled. These stay a review matter.
 */
export const NOT_MECHANICALLY_CHECKABLE: readonly string[] = Object.freeze([
  'list',
  'queue',
  'upload',
  'delivery',
  'account',
  'event',
  'schedule',
  'sender',
  /**
   * CONTEXT.md forbids "tenant" as a synonym for Organisation, and that stands:
   * a row belongs to an organisation, never to a tenant.
   *
   * But ADR 0043 is titled "tenant isolation", names the concept throughout,
   * and `spec/00-overview.md` repeats it. The mechanism has that name in every
   * source this project derives from, so `tenantPolicy` and `TenantContextError`
   * are the honest identifiers for it.
   *
   * The distinction a gate cannot make: "tenant" describing the isolation
   * mechanism is right; "tenant" describing a customer is wrong. Left to review.
   */
  'tenant',
  /**
   * Same shape of ambiguity. CONTEXT.md forbids "spreadsheet" as a synonym for
   * Audience, and that stands. But ADR 0024 makes the import source a CSV or
   * XLSX file, and that file IS a spreadsheet - describing where an address
   * came from is not naming the audience after it.
   */
  'spreadsheet',
]);

/**
 * Every term CONTEXT.md defines, lowercased. A word on this list is a correct
 * term SOMEWHERE, even where another entry lists it under "Avoid".
 *
 * CONTEXT.md's avoid lists are contextual, not global: "User - avoid Mailbox"
 * means do not call a user a mailbox. Mailbox is itself a defined term with its
 * own entry, and banning it outright would ban half of E4.
 */
const DEFINED_TERMS: readonly string[] = Object.freeze(VOCABULARY.map((t) => t.use.toLowerCase()));

/**
 * The subset the vocabulary gate enforces. THE single source - the gate imports
 * this rather than keeping its own copy.
 *
 * A word is enforced only when it is forbidden somewhere, correct nowhere, and
 * unambiguous enough to match mechanically.
 */
export const ENFORCED_FORBIDDEN: readonly string[] = Object.freeze(
  [...new Set(VOCABULARY.flatMap((t) => t.avoid))]
    .filter((w) => !NOT_MECHANICALLY_CHECKABLE.includes(w))
    .filter((w) => !DEFINED_TERMS.includes(w.toLowerCase()))
    .sort(),
);
