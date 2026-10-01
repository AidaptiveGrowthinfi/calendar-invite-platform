# Use scoped API keys for programmatic access

The platform will use scoped API keys for programmatic access, separate from user dashboard sessions managed by Better Auth. API keys will be hashed at rest, shown only once on creation, scoped by capability, optionally expiring, rate-limited, revocable, audited, and tracked with last-used metadata so integrations and internal automation do not rely on user session credentials.
