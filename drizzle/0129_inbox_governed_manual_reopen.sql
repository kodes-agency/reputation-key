ALTER TABLE "inbox_handling_cycles"
ADD COLUMN "manual_reopen_reason" varchar(48);--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles"
ADD COLUMN "manual_reopen_explanation" varchar(280);--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles"
ADD CONSTRAINT "inbox_handling_cycles_manual_reopen_valid"
CHECK (
  (
    "opened_reason" <> 'manual_reopen'
    AND "manual_reopen_reason" IS NULL
    AND "manual_reopen_explanation" IS NULL
  )
  OR
  (
    "opened_reason" = 'manual_reopen'
    AND "manual_reopen_reason" IS NOT NULL
    AND "manual_reopen_reason" IN (
      'guest_follow_up_still_needed',
      'internal_follow_up_still_needed',
      'new_information',
      'correcting_handling_status',
      'other'
    )
    AND (
      (
        "manual_reopen_reason" = 'other'
        AND "manual_reopen_explanation" IS NOT NULL
        AND length(btrim("manual_reopen_explanation")) BETWEEN 1 AND 280
      )
      OR
      (
        "manual_reopen_reason" <> 'other'
        AND "manual_reopen_explanation" IS NULL
      )
    )
  )
) NOT VALID;
