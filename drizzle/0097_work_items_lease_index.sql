-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "work_items_lease_idx" ON "work_items" ("lease_expires_at", "id") WHERE "state" = 'running';
