-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "resend_webhook_deliveries_retention_idx" ON "resend_webhook_deliveries" ("applied_at");
