# Keep the send plan in PostgreSQL

The approved send plan will live in PostgreSQL, while BullMQ jobs will only execute work derived from that plan. Redis and BullMQ may be restarted, flushed, or retried without losing the product's truth about which contacts should be invited, which mailbox should send each invitation, when it should happen, and what attempt state was last recorded.
