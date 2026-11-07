-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "audit_events_retention_idx" ON "audit_events" ("occurred_at", "id");
