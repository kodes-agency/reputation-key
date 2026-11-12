-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "scan_events_session_id_redaction_idx" ON "scan_events" ("created_at") WHERE "session_id" IS NOT NULL;
