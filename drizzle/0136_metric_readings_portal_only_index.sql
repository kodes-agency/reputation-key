-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "metric_readings_portal_only_idx" ON "metric_readings" ("portal_id");
