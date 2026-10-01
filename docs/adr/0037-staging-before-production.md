# Use staging before production

The VPS deployment will include a staging environment before production so the team can test deployments, OAuth flows, provider integrations, billing webhooks, SendGrid behavior, attendance sync, and worker jobs without affecting real customer campaigns. CI/CD will deploy a non-production branch to staging and the main branch to production, with separate databases, Redis state, secrets, provider keys, and strict low sending limits.
