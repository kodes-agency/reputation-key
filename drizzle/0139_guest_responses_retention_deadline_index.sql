-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "guest_responses_retention_deadline_idx" ON "guest_responses" ("retention_deadline");
