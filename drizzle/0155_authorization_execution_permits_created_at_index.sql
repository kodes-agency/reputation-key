-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "authorization_execution_permits_created_at_idx" ON "authorization_execution_permits" ("created_at");
