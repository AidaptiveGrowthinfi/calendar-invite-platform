# Use a monorepo for product apps and shared packages

We will keep the product in one repository with separate applications for the web frontend and API backend, plus shared packages for common types, validation schemas, and configuration. This keeps CI/CD, cross-application changes, and shared domain language simple for a two-person team while still preserving clear application boundaries.
