-- AI-02: make the Material Review Revision a database-enforced analysis fact.
--
-- This migration is deliberately check-only for existing data. A missing
-- revision is evidence that the Review cutover or an earlier AI write was
-- incomplete; inventing a historical business revision here would make that
-- corruption look authoritative. The deployment therefore stops before the
-- constraint is installed and requires a separately governed repair.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analyses" AS analysis
    LEFT JOIN "material_review_revisions" AS material_revision
      ON material_revision."organization_id" = analysis."organization_id"
     AND material_revision."property_id" = analysis."property_id"
     AND material_revision."review_id" = analysis."review_id"
     AND material_revision."source_epoch" = analysis."source_epoch"
     AND material_revision."revision" = analysis."source_revision"
    WHERE material_revision."review_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'AI Review Analysis has no exact Material Review Revision; repair the governed Review history before retrying migration 0156'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "ai_review_analyses"
  ADD CONSTRAINT "ai_review_analyses_material_review_revision_fk"
  FOREIGN KEY (
    "organization_id", "property_id", "review_id", "source_epoch", "source_revision"
  )
  REFERENCES "public"."material_review_revisions" (
    "organization_id", "property_id", "review_id", "source_epoch", "revision"
  )
  ON DELETE restrict
  ON UPDATE no action
  NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_review_analyses"
  VALIDATE CONSTRAINT "ai_review_analyses_material_review_revision_fk";
