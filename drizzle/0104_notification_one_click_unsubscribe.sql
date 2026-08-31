-- Persist the HMAC key version used to build an immutable digest provider
-- request. Existing batches and writes from an older rolling-deploy worker
-- receive a sentinel; the new worker reproduces their legacy header while new
-- batches pin an actual key version.

ALTER TABLE "notification_digest_batches"
  ADD COLUMN "unsubscribe_key_version" varchar(32) DEFAULT 'legacy' NOT NULL;
