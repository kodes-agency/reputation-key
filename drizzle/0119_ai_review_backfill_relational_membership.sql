CREATE TABLE "ai_review_analysis_backfill_run_memberships" (
	"run_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"ordinal" bigint NOT NULL,
	"review_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_backfill_memberships_pk" PRIMARY KEY("run_id","ordinal"),
	CONSTRAINT "ai_review_backfill_memberships_ordinal_safe" CHECK ("ai_review_analysis_backfill_run_memberships"."ordinal" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backfill_runs" DROP CONSTRAINT "ai_review_analysis_backfill_runs_counts_valid";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_backfill_runs_scope_idx" ON "ai_review_analysis_backfill_runs" USING btree ("id","organization_id","property_id");--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backfill_run_memberships" ADD CONSTRAINT "ai_review_backfill_memberships_run_scope_fk" FOREIGN KEY ("run_id","organization_id","property_id") REFERENCES "public"."ai_review_analysis_backfill_runs"("id","organization_id","property_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_backfill_memberships_review_idx" ON "ai_review_analysis_backfill_run_memberships" USING btree ("run_id","review_id");--> statement-breakpoint
CREATE INDEX "ai_review_backfill_memberships_scope_idx" ON "ai_review_analysis_backfill_run_memberships" USING btree ("organization_id","property_id","run_id","ordinal");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_legacy_ai_review_backfill_memberships_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF cardinality(NEW."review_ids") > 0
     AND current_setting(
       'repkey.ai_review_backfill_membership_writer',
       true
     ) IS DISTINCT FROM 'canonical-v1' THEN
    INSERT INTO "ai_review_analysis_backfill_run_memberships" (
      "run_id", "organization_id", "property_id", "ordinal", "review_id", "created_at"
    )
    SELECT NEW."id", NEW."organization_id", NEW."property_id",
           pinned."ordinality" - 1, pinned."review_id", NEW."created_at"
    FROM unnest(NEW."review_ids")
      WITH ORDINALITY AS pinned("review_id", "ordinality");
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_review_backfill_legacy_membership_mirror"
AFTER INSERT ON "ai_review_analysis_backfill_runs"
FOR EACH ROW
EXECUTE FUNCTION "mirror_legacy_ai_review_backfill_memberships_v1"();--> statement-breakpoint
-- AI-02 LEGACY MEMBERSHIP BACKFILL BEGIN
INSERT INTO "ai_review_analysis_backfill_run_memberships" (
  "run_id", "organization_id", "property_id", "ordinal", "review_id", "created_at"
)
SELECT run."id", run."organization_id", run."property_id",
       pinned."ordinality" - 1, pinned."review_id", run."created_at"
FROM "ai_review_analysis_backfill_runs" AS run
CROSS JOIN LATERAL unnest(run."review_ids")
  WITH ORDINALITY AS pinned("review_id", "ordinality");
-- AI-02 LEGACY MEMBERSHIP BACKFILL END
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_backfill_runs" AS run
    WHERE cardinality(run."review_ids") > 0
      AND (
        SELECT count(*)
        FROM "ai_review_analysis_backfill_run_memberships" AS membership
        WHERE membership."run_id" = run."id"
          AND membership."organization_id" = run."organization_id"
          AND membership."property_id" = run."property_id"
      ) <> run."requested_review_count"
  ) THEN
    RAISE EXCEPTION 'AI review-analysis relational membership backfill is incomplete';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_ai_review_backfill_membership_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "ai_review_analysis_backfill_runs" AS run
      WHERE run."id" = NEW."run_id"
        AND run."organization_id" = NEW."organization_id"
        AND run."property_id" = NEW."property_id"
        AND run."state" = 'running'
        AND run."emitted_review_count" = 0
        AND run."skipped_review_count" = 0
        AND NEW."ordinal" < run."requested_review_count"
    ) THEN
      RAISE EXCEPTION 'AI review-analysis membership may only be enrolled while opening a run'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AI review-analysis membership is immutable'
      USING ERRCODE = '55000';
  END IF;

  -- A direct delete still sees its owning run and is forbidden. An FK cascade
  -- from deleting the run/property no longer sees that parent and remains the
  -- lifecycle-safe way to erase the aggregate.
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_backfill_runs" AS run
    WHERE run."id" = OLD."run_id"
      AND run."organization_id" = OLD."organization_id"
      AND run."property_id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'AI review-analysis membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_review_backfill_membership_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_review_analysis_backfill_run_memberships"
FOR EACH ROW
EXECUTE FUNCTION "guard_ai_review_backfill_membership_v1"();--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backfill_runs" ADD CONSTRAINT "ai_review_analysis_backfill_runs_counts_valid" CHECK ("ai_review_analysis_backfill_runs"."requested_review_count" BETWEEN 1 AND 2147483647
        AND (cardinality("ai_review_analysis_backfill_runs"."review_ids") = 0
          OR cardinality("ai_review_analysis_backfill_runs"."review_ids") = "ai_review_analysis_backfill_runs"."requested_review_count")
        AND "ai_review_analysis_backfill_runs"."emitted_review_count" >= 0
        AND "ai_review_analysis_backfill_runs"."skipped_review_count" >= 0
        AND "ai_review_analysis_backfill_runs"."emitted_review_count" + "ai_review_analysis_backfill_runs"."skipped_review_count" <= "ai_review_analysis_backfill_runs"."requested_review_count"
        AND "ai_review_analysis_backfill_runs"."recovered_review_count" BETWEEN 0 AND "ai_review_analysis_backfill_runs"."emitted_review_count");--> statement-breakpoint
COMMENT ON COLUMN "ai_review_analysis_backfill_runs"."review_ids" IS 'AI-02 expand compatibility only: old and new binaries may read/write this dual-written copy during rollout; canonical authority is relational';
