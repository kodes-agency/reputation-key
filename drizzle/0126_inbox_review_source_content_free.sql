ALTER TABLE "inbox_items"
ADD CONSTRAINT "inbox_items_review_source_content_free"
CHECK (
  "source_type" <> 'review'
  OR (
    "rating" IS NULL
    AND "snippet" IS NULL
    AND "reviewer_name" IS NULL
  )
) NOT VALID;--> statement-breakpoint
UPDATE "inbox_items"
SET
  "rating" = NULL,
  "snippet" = NULL,
  "reviewer_name" = NULL,
  "updated_at" = NOW(),
  "command_revision" = LEAST(
    "command_revision" + 1,
    '9007199254740991'::bigint
  )
WHERE "source_type" = 'review'
  AND (
    "rating" IS NOT NULL
    OR "snippet" IS NOT NULL
    OR "reviewer_name" IS NOT NULL
  );--> statement-breakpoint
ALTER TABLE "inbox_items"
VALIDATE CONSTRAINT "inbox_items_review_source_content_free";
