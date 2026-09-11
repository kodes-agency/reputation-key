-- First-enable lineage repair.
--
-- Before a property's first enable there is no `merchant_ai_enablement` row and
-- therefore no AI lineage. The review consumer nevertheless settled every
-- `review.created` it saw under an invented epoch 1 with `policy_disabled`.
-- The first enable then created the real epoch 1 with its watermark at the
-- allocator head, so those settlements sat at or below the watermark inside
-- the lineage's own head: `settled_analysis_count` exceeded the window's
-- expected count and every insights read for the property threw.
--
-- The consumer now acknowledges lineage-less events without a derivative, the
-- same way it acknowledges a below-watermark event. This removes the rows it
-- would never have written, then recounts the affected heads from the ledger
-- in a second statement: a data-modifying CTE's rows are invisible to its own
-- statement's subqueries.
DELETE FROM "ai_property_aggregate_settlements" AS settlement
USING "merchant_ai_enablement" AS enablement
WHERE enablement."organization_id" = settlement."organization_id"
  AND enablement."property_id" = settlement."property_id"
  AND enablement."review_analysis_epoch" = settlement."review_analysis_epoch"
  AND settlement."analysis_sequence" <= enablement."analysis_start_sequence";
--> statement-breakpoint
-- Recount every head at its property's current lineage epoch. A head whose
-- epoch spans several profile versions cannot attribute ledger rows per
-- profile; the ledger count is the exact upper bound for each head at that
-- epoch, and every observed deployment has one head per epoch.
UPDATE "ai_property_aggregate_heads" AS head
SET "settled_analysis_count" = LEAST(
  head."settled_analysis_count",
  (
    SELECT count(*)
    FROM "ai_property_aggregate_settlements" AS settlement
    WHERE settlement."organization_id" = head."organization_id"
      AND settlement."property_id" = head."property_id"
      AND settlement."source_epoch" = head."source_epoch"
      AND settlement."review_analysis_epoch" = head."review_analysis_epoch"
  )
)
FROM "merchant_ai_enablement" AS enablement
WHERE enablement."organization_id" = head."organization_id"
  AND enablement."property_id" = head."property_id"
  AND enablement."review_analysis_epoch" = head."review_analysis_epoch";
