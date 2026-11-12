-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "review_provider_snapshot_runs_completed_property_idx" ON "review_provider_snapshot_runs" ("organization_id", "property_id", "source_epoch") WHERE "state" = 'completed';
