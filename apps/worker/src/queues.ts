/**
 * Queue names. ADR 0012 (BullMQ).
 *
 * `docs/spec/03-workers-and-jobs.md` specifies eight workers, ten
 * reconciliation jobs and two clearing jobs, each with a stated transaction
 * boundary. None of them exists yet - they belong to E3 onward.
 *
 * The names are declared here now so that the queue a ticket adds is added to
 * one list rather than typed as a string literal in two places, which is how a
 * producer and a consumer end up on different queues.
 */
export const QUEUES = {
  /**
   * The dispatcher. ADR 0043 exemption 1: choosing between organisations is
   * inherently cross-tenant, so this is one of the three places `app_worker`
   * and its BYPASSRLS may be used. The per-organisation body of whatever it
   * selects still runs inside `withOrg()` as `app_user`.
   */
  dispatch: 'dispatch',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
