-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "scan_events_ip_hash_redaction_idx" ON "scan_events" ("created_at") WHERE "ip_hash" IS NOT NULL;
