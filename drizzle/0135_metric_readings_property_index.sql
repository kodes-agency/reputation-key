-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "metric_readings_property_idx" ON "metric_readings" ("property_id");
