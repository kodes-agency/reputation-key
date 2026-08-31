-- IBX-01: preserve Google Review Response Target provenance at the Review
-- authority boundary. Existing facts remain explicitly unknown; timestamps
-- are never reconstructed from migration or fetch clocks.
ALTER TABLE "review_provider_snapshot_runs"
  ADD COLUMN "observation_origin" varchar(32) DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_provider_snapshot_runs"
  ADD CONSTRAINT "review_provider_snapshot_runs_observation_origin_valid"
  CHECK ("observation_origin" IN ('ongoing', 'historical_onboarding', 'legacy_unknown'));--> statement-breakpoint
ALTER TABLE "material_review_revisions"
  ADD COLUMN "response_target_eligibility" varchar(32) DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_review_revisions"
  ADD COLUMN "response_target_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "material_review_revisions"
  ADD CONSTRAINT "material_review_revisions_response_target_valid"
  CHECK (
    "response_target_eligibility" IN ('measured', 'legacy_unknown', 'historical_onboarding')
    AND (
      ("response_target_eligibility" = 'measured' AND "response_target_start_at" IS NOT NULL)
      OR
      ("response_target_eligibility" <> 'measured' AND "response_target_start_at" IS NULL)
    )
  );
