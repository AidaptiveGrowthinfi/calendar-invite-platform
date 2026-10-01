# Use BullMQ for background jobs

We will use BullMQ with Redis for background job orchestration in the MVP. The platform needs durable worker flows for audience verification, provider detection, send planning, invitation sending, retries, mailbox backoff, response syncing, attendance import, and follow-up workflows; BullMQ fits the NestJS, TypeScript, Docker Compose, and VPS deployment model without introducing a heavier workflow engine too early.
