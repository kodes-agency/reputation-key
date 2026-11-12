-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "recent_activity_entries_created_at_idx" ON "recent_activity_entries" ("created_at");
