CREATE TABLE "review_lifecycle_recovery_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recovery_generation" integer NOT NULL,
	"approval_id" varchar(160) NOT NULL,
	"approval_bundle_sha256" varchar(64) NOT NULL,
	"approver_identity" varchar(255) NOT NULL,
	"approval_key_id" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"data_cell_id" varchar(16) NOT NULL,
	"release_sha" varchar(40) NOT NULL,
	"release_manifest_sha256" varchar(64) NOT NULL,
	"restore_point_at" timestamp with time zone NOT NULL,
	"restore_database_service_name" varchar(255) NOT NULL,
	"railway_project_id" varchar(255),
	"railway_environment_id" varchar(255),
	"evaluated_at" timestamp with time zone NOT NULL,
	"source_policy_version" integer NOT NULL,
	"retention_policy_version" integer NOT NULL,
	"policy_sha256" varchar(64) NOT NULL,
	"report_sha256" varchar(64) NOT NULL,
	"report_expired" integer NOT NULL,
	"operator_id" varchar(255) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"state" varchar(32) NOT NULL,
	"checkpoint_created_at" timestamp with time zone,
	"checkpoint_review_id" uuid,
	"pages" integer DEFAULT 0 NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"rows_redacted" integer DEFAULT 0 NOT NULL,
	"legacy_google_replies_reconciled" integer DEFAULT 0 NOT NULL,
	"recovery_replayed" boolean,
	"error_code" varchar(160),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "review_lifecycle_recovery_state_valid" CHECK ("review_lifecycle_recovery_executions"."state" IN ('applying', 'lifecycle_applied', 'completed')),
	CONSTRAINT "review_lifecycle_recovery_cell_valid" CHECK ("review_lifecycle_recovery_executions"."data_cell_id" IN ('us', 'europe', 'global')),
	CONSTRAINT "review_lifecycle_recovery_generation_valid" CHECK ("review_lifecycle_recovery_executions"."recovery_generation" >= 1),
	CONSTRAINT "review_lifecycle_recovery_release_valid" CHECK ("review_lifecycle_recovery_executions"."release_sha" ~ '^[0-9a-f]{40}$' AND "review_lifecycle_recovery_executions"."release_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_lifecycle_recovery_digests_valid" CHECK ("review_lifecycle_recovery_executions"."approval_bundle_sha256" ~ '^[0-9a-f]{64}$' AND "review_lifecycle_recovery_executions"."policy_sha256" ~ '^[0-9a-f]{64}$' AND "review_lifecycle_recovery_executions"."report_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_lifecycle_recovery_window_valid" CHECK ("review_lifecycle_recovery_executions"."restore_point_at" <= "review_lifecycle_recovery_executions"."evaluated_at" AND "review_lifecycle_recovery_executions"."evaluated_at" <= "review_lifecycle_recovery_executions"."approved_at" AND "review_lifecycle_recovery_executions"."approved_at" < "review_lifecycle_recovery_executions"."expires_at"),
	CONSTRAINT "review_lifecycle_recovery_counts_valid" CHECK ("review_lifecycle_recovery_executions"."report_expired" >= 0 AND "review_lifecycle_recovery_executions"."pages" >= 0 AND "review_lifecycle_recovery_executions"."scanned" >= 0 AND "review_lifecycle_recovery_executions"."rows_redacted" >= 0 AND "review_lifecycle_recovery_executions"."legacy_google_replies_reconciled" >= 0),
	CONSTRAINT "review_lifecycle_recovery_checkpoint_valid" CHECK (("review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL) = ("review_lifecycle_recovery_executions"."checkpoint_review_id" IS NULL) AND ("review_lifecycle_recovery_executions"."state" = 'applying' OR "review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL) AND ("review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL OR "review_lifecycle_recovery_executions"."checkpoint_created_at" <= "review_lifecycle_recovery_executions"."evaluated_at")),
	CONSTRAINT "review_lifecycle_recovery_completion_valid" CHECK (("review_lifecycle_recovery_executions"."state" = 'completed') = ("review_lifecycle_recovery_executions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_approval_unique" ON "review_lifecycle_recovery_executions" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_bundle_unique" ON "review_lifecycle_recovery_executions" USING btree ("approval_bundle_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_cell_generation_unique" ON "review_lifecycle_recovery_executions" USING btree ("data_cell_id","recovery_generation");--> statement-breakpoint
CREATE INDEX "review_lifecycle_recovery_state_idx" ON "review_lifecycle_recovery_executions" USING btree ("data_cell_id","state");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_review_lifecycle_recovery_execution_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence is durable and cannot be removed';
  END IF;

  IF ROW(
    NEW."id",
    NEW."recovery_generation",
    NEW."approval_id",
    NEW."approval_bundle_sha256",
    NEW."approver_identity",
    NEW."approval_key_id",
    NEW."approved_at",
    NEW."expires_at",
    NEW."data_cell_id",
    NEW."release_sha",
    NEW."release_manifest_sha256",
    NEW."restore_point_at",
    NEW."restore_database_service_name",
    NEW."railway_project_id",
    NEW."railway_environment_id",
    NEW."evaluated_at",
    NEW."source_policy_version",
    NEW."retention_policy_version",
    NEW."policy_sha256",
    NEW."report_sha256",
    NEW."report_expired",
    NEW."operator_id",
    NEW."correlation_id",
    NEW."started_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."recovery_generation",
    OLD."approval_id",
    OLD."approval_bundle_sha256",
    OLD."approver_identity",
    OLD."approval_key_id",
    OLD."approved_at",
    OLD."expires_at",
    OLD."data_cell_id",
    OLD."release_sha",
    OLD."release_manifest_sha256",
    OLD."restore_point_at",
    OLD."restore_database_service_name",
    OLD."railway_project_id",
    OLD."railway_environment_id",
    OLD."evaluated_at",
    OLD."source_policy_version",
    OLD."retention_policy_version",
    OLD."policy_sha256",
    OLD."report_sha256",
    OLD."report_expired",
    OLD."operator_id",
    OLD."correlation_id",
    OLD."started_at"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery approval binding is immutable';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence time cannot move backwards';
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'applying' THEN
    IF NEW."recovery_replayed" IS DISTINCT FROM OLD."recovery_replayed"
       OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
       OR NEW."pages" < OLD."pages"
       OR NEW."scanned" < OLD."scanned"
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled" THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applying evidence cannot move backwards';
    END IF;
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id"
    ) AND (
      NEW."error_code" IS NOT NULL
      OR NEW."pages" <> OLD."pages" + 1
      OR NEW."scanned" <= OLD."scanned"
      OR NEW."scanned" > OLD."scanned" + 100
      OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
      OR NEW."checkpoint_created_at" IS NULL
      OR (
        OLD."checkpoint_created_at" IS NOT NULL
        AND ROW(NEW."checkpoint_created_at", NEW."checkpoint_review_id")
          <= ROW(OLD."checkpoint_created_at", OLD."checkpoint_review_id")
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery page evidence is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'lifecycle_applied' THEN
    IF NEW."recovery_replayed" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL
       OR NEW."error_code" IS NOT NULL
       OR NEW."checkpoint_created_at" IS NOT NULL
       OR NEW."checkpoint_review_id" IS NOT NULL
       OR NEW."scanned" < OLD."scanned"
       OR NEW."scanned" > OLD."scanned" + 100
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled"
       OR (
         NEW."scanned" = OLD."scanned"
         AND NEW."pages" <> OLD."pages"
       )
       OR (
         NEW."scanned" > OLD."scanned"
         AND NEW."pages" <> OLD."pages" + 1
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery apply transition is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'lifecycle_applied' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id",
      NEW."recovery_replayed",
      NEW."completed_at"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id",
      OLD."recovery_replayed",
      OLD."completed_at"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applied evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'completed' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled"
    ) OR NEW."recovery_replayed" IS NULL OR NEW."completed_at" IS NULL OR NEW."error_code" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery completion evidence is invalid';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "recovery_runs" AS recovery
      WHERE recovery."id" = NEW."id"
        AND recovery."data_cell_id" = NEW."data_cell_id"
        AND recovery."generation" = NEW."recovery_generation"
        AND recovery."source_release_sha" = NEW."release_sha"
        AND recovery."source_manifest_sha256" = NEW."release_manifest_sha256"
        AND recovery."restore_point_at" = NEW."restore_point_at"
        AND recovery."operator_id" = NEW."operator_id"
        AND recovery."correlation_id" = NEW."correlation_id"
        AND recovery."completed_at" = NEW."completed_at"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Review lifecycle recovery completion has no exact recovery run';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Review lifecycle recovery state may only advance';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "review_lifecycle_recovery_executions_mutation_guard"
BEFORE UPDATE OR DELETE ON "review_lifecycle_recovery_executions"
FOR EACH ROW EXECUTE FUNCTION "guard_review_lifecycle_recovery_execution_v1"();--> statement-breakpoint
CREATE TRIGGER "review_lifecycle_recovery_executions_truncate_guard"
BEFORE TRUNCATE ON "review_lifecycle_recovery_executions"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_review_lifecycle_recovery_execution_v1"();--> statement-breakpoint
ALTER TABLE "review_lifecycle_recovery_executions"
ENABLE ALWAYS TRIGGER "review_lifecycle_recovery_executions_mutation_guard";--> statement-breakpoint
ALTER TABLE "review_lifecycle_recovery_executions"
ENABLE ALWAYS TRIGGER "review_lifecycle_recovery_executions_truncate_guard";--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "review_lifecycle_recovery_executions" FROM PUBLIC;
