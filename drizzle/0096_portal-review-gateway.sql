ALTER TABLE "portals"
  ADD COLUMN "private_feedback_threshold" integer DEFAULT 3 NOT NULL;

ALTER TABLE "portals"
  ADD CONSTRAINT "portals_private_feedback_threshold_valid"
  CHECK ("private_feedback_threshold" BETWEEN 1 AND 5);
