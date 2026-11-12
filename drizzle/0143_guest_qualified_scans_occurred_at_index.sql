-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "guest_qualified_scans_occurred_at_idx" ON "guest_qualified_scans" ("occurred_at");
