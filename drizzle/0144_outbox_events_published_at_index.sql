-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "outbox_events_published_at_idx" ON "outbox_events" ("published_at");
