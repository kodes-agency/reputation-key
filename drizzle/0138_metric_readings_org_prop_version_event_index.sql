-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "metric_readings_org_prop_version_event_idx" ON "metric_readings" ("organization_id", "property_id", "definition_version_id", "event_at");
