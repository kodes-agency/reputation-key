-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "audit_events_org_time_idx" ON "audit_events" ("organization_id", "occurred_at", "id");
