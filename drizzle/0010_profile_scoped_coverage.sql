-- Profile-scoped analysis coverage.
--
-- `ai_property_aggregate_settlements` is deliberately independent of
-- `property_profile_version` so an epoch's idempotency survives a profile
-- rollover. Coverage, however, was derived from that ledger while the daily
-- aggregates and contributions it summarises are profile-scoped. A property
-- timezone or country change bumps `property_profile_version` WITHOUT bumping
-- the review-analysis epoch, so the newly created head inherited a complete
-- ledger count with no rows behind it and the insights report showed a
-- confidently empty window.
--
-- This counter is per head and never inherits: a rolled profile reports
-- incomplete (rendered provisionally) until its generation is rebuilt.
ALTER TABLE "ai_property_aggregate_heads"
  ADD COLUMN IF NOT EXISTS "settled_analysis_count" bigint DEFAULT 0 NOT NULL;

-- Existing heads DO have their data: they are the generation that recorded it.
-- Seed each from the ledger rows of its own epoch so the live deployment stays
-- complete across this migration rather than falsely reverting to provisional.
UPDATE "ai_property_aggregate_heads" AS head
SET "settled_analysis_count" = COALESCE(
  (
    SELECT count(*)
    FROM "ai_property_aggregate_settlements" AS settlement
    WHERE settlement."organization_id" = head."organization_id"
      AND settlement."property_id" = head."property_id"
      AND settlement."source_epoch" = head."source_epoch"
      AND settlement."review_analysis_epoch" = head."review_analysis_epoch"
  ),
  0
);

ALTER TABLE "ai_property_aggregate_heads"
  DROP CONSTRAINT IF EXISTS "ai_property_aggregate_heads_settled_count_valid";

ALTER TABLE "ai_property_aggregate_heads"
  ADD CONSTRAINT "ai_property_aggregate_heads_settled_count_valid"
  CHECK (
    "settled_analysis_count" >= 0
    AND "settled_analysis_count" <= 9007199254740991::bigint
  );
