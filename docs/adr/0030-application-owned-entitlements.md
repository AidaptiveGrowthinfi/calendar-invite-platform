# Keep product entitlements in the application

Razorpay will provide payment, invoice, and subscription state, but the platform will own product entitlements and usage limits in PostgreSQL. Limits such as team seats, connected mailboxes, native calendar invites, calendar email volume, attendance sync access, shared-domain trial volume, and sending domains must be enforced by the application so webhook delays, provider changes, or billing-provider failures do not directly define product behavior.
