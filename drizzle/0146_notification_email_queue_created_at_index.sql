-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "notification_email_queue_created_at_idx" ON "notification_email_queue" ("created_at");
