# Use Zod for shared validation schemas

We will use Zod for request, form, import, and shared domain validation across the web frontend, API backend, and shared packages. The platform accepts risky customer-controlled inputs such as spreadsheet mappings, campaign scheduling fields, mailbox limits, role changes, unsubscribe requests, and provider metadata; shared schemas keep those boundaries explicit and testable.
