ALTER TYPE "public"."google_content_approval_target_phase" ADD VALUE IF NOT EXISTS 'railway_closed_beta' BEFORE 'production_expand_canary';--> statement-breakpoint
ALTER TYPE "public"."google_content_environment_profile" ADD VALUE IF NOT EXISTS 'railway-closed-beta-1' BEFORE 'production';--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ALTER COLUMN "runtime_isolation_profile_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ALTER COLUMN "runtime_isolation_profile_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ADD COLUMN "railway_closed_beta_cohort" jsonb;--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ADD COLUMN "railway_closed_beta_cohort_sha256" varchar(128);--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ADD COLUMN "railway_closed_beta_residual_risk_sha256" varchar(128);--> statement-breakpoint
ALTER TABLE "capability_compliance_approvals" ADD CONSTRAINT "capability_compliance_approvals_phase_profile_check" CHECK ((
  ("target_phase" = 'railway_closed_beta'
    AND "environment_profile" = 'railway-closed-beta-1'
    AND "runtime_isolation_profile_version" IS NULL
    AND "runtime_isolation_profile_sha256" IS NULL
    AND "railway_closed_beta_cohort" IS NOT NULL
    AND "railway_closed_beta_cohort_sha256" IS NOT NULL
    AND "railway_closed_beta_residual_risk_sha256" IS NOT NULL)
  OR
  ("target_phase" <> 'railway_closed_beta'
    AND (("target_phase" = 'local_sandbox' AND "environment_profile" = 'sandbox')
      OR ("target_phase" IN ('production_expand_canary', 'production_final')
        AND "environment_profile" = 'production'))
    AND "runtime_isolation_profile_version" = 'google-content-egress-1'
    AND "runtime_isolation_profile_sha256" IS NOT NULL
    AND "railway_closed_beta_cohort" IS NULL
    AND "railway_closed_beta_cohort_sha256" IS NULL
    AND "railway_closed_beta_residual_risk_sha256" IS NULL)
));--> statement-breakpoint
