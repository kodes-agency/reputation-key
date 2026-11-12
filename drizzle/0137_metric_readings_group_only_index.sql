-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "metric_readings_group_only_idx" ON "metric_readings" ("group_id");
