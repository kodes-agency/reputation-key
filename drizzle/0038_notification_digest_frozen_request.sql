-- A digest batch the provider may already hold (a 5xx, a timeout or a reset
-- on its last attempt) must be retried with the same content under the same
-- idempotency key. The retry used to re-render the batch and close it when
-- the wording differed, which a repeat event coalescing into one of its lines
-- always causes, so the day's digest was lost. The frozen request is kept
-- while the batch is open and cleared when it closes. Nullable: batches
-- frozen before this column existed are re-rendered and compared as before.
ALTER TABLE "notification_digest_batches" ADD COLUMN "provider_request" jsonb;
