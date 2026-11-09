-- An immediate email is rendered once, stored here before its first provider
-- attempt, and retried verbatim under the same idempotency key. It is cleared
-- when the row closes, so rendered mail is kept no longer than it can be sent.
-- Nullable: rows that have not been attempted are rendered at their first
-- attempt.
ALTER TABLE "notification_email_queue" ADD COLUMN "provider_request" jsonb;
