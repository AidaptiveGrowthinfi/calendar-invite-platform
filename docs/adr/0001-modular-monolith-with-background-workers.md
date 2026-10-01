# Use a modular monolith with background workers for the MVP

We will build the MVP as one TypeScript backend application with clear internal modules, one PostgreSQL database, and Redis-backed background workers for planning and sending calendar invitations. A separate microservice architecture would add operational overhead for a two-person team before the product has stable boundaries; the hard problem is reliable planning, idempotent sending, and auditability, not independent service deployment.
