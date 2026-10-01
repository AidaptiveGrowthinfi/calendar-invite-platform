# Use PostgreSQL for durable state and Redis for background jobs

We will use PostgreSQL as the source of truth for organisations, users, mailboxes, contacts, campaigns, send plans, invitation attempts, provider event IDs, and audit logs. Redis will be used for queueing, retries, backoff delays, and worker coordination only; it will not own product-critical truth, because the platform must always be able to prove whether a contact was invited, skipped, retried, or blocked.
