-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "scan_events_created_at_idx" ON "scan_events" ("created_at");
