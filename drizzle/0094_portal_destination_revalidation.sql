ALTER TABLE "portal_approved_destinations"
  ADD COLUMN "next_attempt_at" timestamp with time zone,
  ADD COLUMN "validation_failures" integer DEFAULT 0 NOT NULL;
