# Back up PostgreSQL from day one

Production will include automated encrypted PostgreSQL backups from the first deployment. Backups will run at least daily, retain a short recovery window, be stored outside the VPS, report success or failure, and be periodically restore-tested because contacts, campaigns, send plans, invitation attempts, provider event IDs, audit logs, billing entitlements, suppression state, and attendance analytics are product-critical records.
