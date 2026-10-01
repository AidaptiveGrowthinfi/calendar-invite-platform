# Lock plan limit dimensions before pricing

The architecture will support simple subscription plan tiers whose exact names, prices, and numeric limits can be decided later by the product owner. The product will meter and enforce plan dimensions for team seats, connected mailboxes, sending domains, monthly native calendar invites, monthly calendar email invites, monthly imported contacts, attendance syncs, shared trial-domain sends, API keys, and retention period for logs and analytics.

Partially superseded by ADR 0061 (2026-09-08): retention period is not a plan
dimension. All data is retained indefinitely on every plan, and revoking access
never deletes. The remaining nine dimensions stand.
