-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "review_provider_subjects_last_seen_run_idx" ON "review_provider_subjects" ("last_seen_snapshot_run_id");
