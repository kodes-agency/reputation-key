-- A low-rated Google review may be given a shorter Response Target.
--
-- Urgency for an unanswered review comes from its Response Target, not from
-- Feed: ADR 0046 r.8 keeps provider ratings out of notification storage, so a
-- one-star review and a five-star one produced identical notices and identical
-- reminder schedules. The rating stays in Inbox, which already reads it for
-- list filters, and shortens the clock instead.
--
-- Both columns null is the default and the behaviour of every row written
-- before them: one target for every review, unchanged. A Property override
-- stays a private-feedback-only concept, so this is an Organization policy.
ALTER TABLE "inbox_response_target_organization_policies" ADD COLUMN "low_rating_threshold" integer;--> statement-breakpoint
ALTER TABLE "inbox_response_target_organization_policies" ADD COLUMN "low_rating_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "inbox_response_target_organization_policies" ADD CONSTRAINT "inbox_response_target_organization_policies_low_rating_valid" CHECK (("inbox_response_target_organization_policies"."low_rating_threshold" IS NULL) = ("inbox_response_target_organization_policies"."low_rating_duration_minutes" IS NULL)
        AND (
          "inbox_response_target_organization_policies"."low_rating_threshold" IS NULL
          OR (
            "inbox_response_target_organization_policies"."target_kind" = 'google_review_response'
            AND "inbox_response_target_organization_policies"."low_rating_threshold" BETWEEN 1 AND 5
            AND "inbox_response_target_organization_policies"."low_rating_duration_minutes" BETWEEN 1 AND "inbox_response_target_organization_policies"."duration_minutes"
          )
        ));
