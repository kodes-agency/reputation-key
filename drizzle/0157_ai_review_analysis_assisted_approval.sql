-- AI-02: pause a complete first-enablement snapshot above the fixed 10,000
-- revision safety ceiling until an operator records ticketed approval.
--
-- The ceiling is never a LIMIT: membership remains the whole authorization-
-- bound snapshot. Existing untouched queued snapshots can be paused safely.
-- Existing over-ceiling work that already started is rejected for governed
-- review rather than receiving invented approval evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    WHERE enrollment."snapshot_revision_count" > 10000
      AND enrollment."state" NOT IN ('superseded', 'stalled')
      AND (
        enrollment."state" IN ('running', 'caught_up')
        OR enrollment."enrolled_revision_count" > 0
        OR EXISTS (
          SELECT 1
          FROM "ai_review_analysis_enrollment_replays" AS replay
          WHERE replay."enrollment_id" = enrollment."id"
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Over-ceiling Review Analysis enrollment already progressed; review it before retrying migration 0157'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments"
  ALTER COLUMN "state" TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments"
  ADD COLUMN "safety_ceiling" integer DEFAULT 10000 NOT NULL,
  ADD COLUMN "assisted_approval_required" boolean DEFAULT false NOT NULL,
  ADD COLUMN "assisted_approved_at" timestamp with time zone,
  ADD COLUMN "assisted_approved_by" varchar(255),
  ADD COLUMN "assisted_approval_evidence_digest" varchar(64),
  ADD COLUMN "assisted_approval_correlation_id" uuid;--> statement-breakpoint
DROP TRIGGER "ai_review_analysis_enrollment_guard"
  ON "ai_review_analysis_enrollments";--> statement-breakpoint
DROP INDEX "ai_review_analysis_enrollments_one_active";--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments"
  DROP CONSTRAINT "ai_review_analysis_enrollments_state_valid",
  DROP CONSTRAINT "ai_review_analysis_enrollments_terminal_valid",
  DROP CONSTRAINT "ai_review_analysis_enrollments_time_valid";--> statement-breakpoint
UPDATE "ai_review_analysis_enrollments"
SET "assisted_approval_required" = ("snapshot_revision_count" > 10000),
    "state" = CASE
      WHEN "snapshot_revision_count" > 10000 AND "state" = 'queued'
        THEN 'awaiting_assisted_approval'
      ELSE "state"
    END;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments"
  ADD CONSTRAINT "ai_review_analysis_enrollments_state_valid"
    CHECK ("state" IN (
      'awaiting_assisted_approval', 'queued', 'running', 'caught_up',
      'superseded', 'stalled'
    )),
  ADD CONSTRAINT "ai_review_analysis_enrollments_assisted_approval_valid"
    CHECK (
      "safety_ceiling" = 10000
      AND "assisted_approval_required" =
        ("snapshot_revision_count" > "safety_ceiling")
      AND (
        (
          "assisted_approved_at" IS NULL
          AND "assisted_approved_by" IS NULL
          AND "assisted_approval_evidence_digest" IS NULL
          AND "assisted_approval_correlation_id" IS NULL
        )
        OR (
          "assisted_approval_required"
          AND "assisted_approved_at" IS NOT NULL
          AND length("assisted_approved_by") BETWEEN 1 AND 255
          AND btrim("assisted_approved_by") = "assisted_approved_by"
          AND "assisted_approval_evidence_digest" ~ '^[0-9a-f]{64}$'
          AND "assisted_approval_correlation_id" IS NOT NULL
        )
      )
      AND (
        (
          "state" = 'awaiting_assisted_approval'
          AND "assisted_approval_required"
          AND "assisted_approved_at" IS NULL
        )
        OR (
          "state" IN ('queued', 'running', 'caught_up')
          AND (
            NOT "assisted_approval_required"
            OR "assisted_approved_at" IS NOT NULL
          )
        )
        OR "state" IN ('superseded', 'stalled')
      )
    ),
  ADD CONSTRAINT "ai_review_analysis_enrollments_terminal_valid"
    CHECK (
      (
        "state" IN ('awaiting_assisted_approval', 'queued', 'running')
        AND "caught_up_eligible_revision_count" IS NULL
        AND "caught_up_analysis_sequence" IS NULL
        AND "caught_up_revision_set_digest" IS NULL
        AND "caught_up_at" IS NULL
        AND "terminal_reason" IS NULL
        AND "terminal_at" IS NULL
      ) OR (
        "state" = 'caught_up'
        AND "caught_up_eligible_revision_count"
          BETWEEN 0 AND '9007199254740991'::bigint
        AND "caught_up_analysis_sequence"
          BETWEEN "analysis_start_sequence" AND '9007199254740991'::bigint
        AND "caught_up_revision_set_digest" ~ '^[0-9a-f]{64}$'
        AND (
          (
            "caught_up_eligible_revision_count" = 0
            AND "caught_up_revision_set_digest" =
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          ) OR (
            "caught_up_eligible_revision_count" > 0
            AND "caught_up_revision_set_digest" <>
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          )
        )
        AND "caught_up_at" IS NOT NULL
        AND "terminal_reason" = 'eligible_revision_set_caught_up'
        AND "terminal_at" = "caught_up_at"
      ) OR (
        "state" IN ('superseded', 'stalled')
        AND "caught_up_eligible_revision_count" IS NULL
        AND "caught_up_analysis_sequence" IS NULL
        AND "caught_up_revision_set_digest" IS NULL
        AND "caught_up_at" IS NULL
        AND "terminal_reason" ~ '^[a-z][a-z0-9_]{2,63}$'
        AND "terminal_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "ai_review_analysis_enrollments_time_valid"
    CHECK (
      "snapshot_captured_at" >= "created_at"
      AND "updated_at" >= "created_at"
      AND (
        "caught_up_at" IS NULL
        OR "caught_up_at" >= "snapshot_captured_at"
      )
      AND (
        "assisted_approved_at" IS NULL
        OR "assisted_approved_at" >= "snapshot_captured_at"
      )
      AND (
        "terminal_at" IS NULL
        OR "terminal_at" >= "snapshot_captured_at"
      )
    );--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_one_active"
  ON "ai_review_analysis_enrollments" USING btree (
    "organization_id", "property_id"
  )
  WHERE "state" IN (
    'awaiting_assisted_approval', 'queued', 'running'
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_ai_review_analysis_enrollment_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
       OR NEW."property_id" IS DISTINCT FROM OLD."property_id"
       OR NEW."authorization_lineage_id" IS DISTINCT FROM OLD."authorization_lineage_id"
       OR NEW."authorization_state_version" IS DISTINCT FROM OLD."authorization_state_version"
       OR NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
       OR NEW."review_analysis_epoch" IS DISTINCT FROM OLD."review_analysis_epoch"
       OR NEW."analysis_start_sequence" IS DISTINCT FROM OLD."analysis_start_sequence"
       OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
       OR NEW."trigger_event_envelope_id" IS DISTINCT FROM OLD."trigger_event_envelope_id"
       OR NEW."snapshot_revision_count" IS DISTINCT FROM OLD."snapshot_revision_count"
       OR NEW."snapshot_revision_set_digest" IS DISTINCT FROM OLD."snapshot_revision_set_digest"
       OR NEW."snapshot_captured_at" IS DISTINCT FROM OLD."snapshot_captured_at"
       OR NEW."safety_ceiling" IS DISTINCT FROM OLD."safety_ceiling"
       OR NEW."assisted_approval_required" IS DISTINCT FROM OLD."assisted_approval_required"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Review Analysis enrollment authority is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF OLD."state" IN ('caught_up', 'superseded', 'stalled') THEN
      RAISE EXCEPTION 'Terminal Review Analysis enrollment is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF (
      NEW."assisted_approved_at" IS DISTINCT FROM OLD."assisted_approved_at"
      OR NEW."assisted_approved_by" IS DISTINCT FROM OLD."assisted_approved_by"
      OR NEW."assisted_approval_evidence_digest"
        IS DISTINCT FROM OLD."assisted_approval_evidence_digest"
      OR NEW."assisted_approval_correlation_id"
        IS DISTINCT FROM OLD."assisted_approval_correlation_id"
    ) AND NOT (
      OLD."state" = 'awaiting_assisted_approval'
      AND NEW."state" = 'queued'
      AND OLD."assisted_approved_at" IS NULL
      AND OLD."assisted_approved_by" IS NULL
      AND OLD."assisted_approval_evidence_digest" IS NULL
      AND OLD."assisted_approval_correlation_id" IS NULL
      AND NEW."assisted_approved_at" IS NOT NULL
      AND NEW."assisted_approved_by" IS NOT NULL
      AND NEW."assisted_approval_evidence_digest" IS NOT NULL
      AND NEW."assisted_approval_correlation_id" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Review Analysis enrollment approval evidence is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."state" NOT IN (
         'awaiting_assisted_approval', 'queued', 'running', 'caught_up',
         'superseded', 'stalled'
       )
       OR (
         OLD."state" = 'awaiting_assisted_approval'
         AND NEW."state" NOT IN ('queued', 'superseded', 'stalled')
       )
       OR (
         OLD."state" <> 'awaiting_assisted_approval'
         AND NEW."state" = 'awaiting_assisted_approval'
       )
       OR (
         OLD."state" = 'awaiting_assisted_approval'
         AND NEW."state" = 'queued'
         AND (
           NEW."assisted_approved_at" IS NULL
           OR NEW."assisted_approved_by" IS NULL
           OR NEW."assisted_approval_evidence_digest" IS NULL
           OR NEW."assisted_approval_correlation_id" IS NULL
         )
       )
       OR (OLD."state" = 'running' AND NEW."state" = 'queued')
       OR NEW."enrolled_revision_count" < OLD."enrolled_revision_count"
       OR NEW."updated_at" < OLD."updated_at" THEN
      RAISE EXCEPTION 'Review Analysis enrollment transition is invalid'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "properties" AS property
    WHERE property."organization_id" = OLD."organization_id"
      AND property."id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment may only be lifecycle-erased'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_review_analysis_enrollment_guard"
BEFORE UPDATE OR DELETE ON "ai_review_analysis_enrollments"
FOR EACH ROW
EXECUTE FUNCTION "guard_ai_review_analysis_enrollment_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_ai_review_analysis_enrollment_membership_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting(
         'repkey.ai_review_enrollment_membership_writer',
         true
       ) IS DISTINCT FROM 'canonical-v1'
       OR NOT EXISTS (
         SELECT 1
         FROM "ai_review_analysis_enrollments" AS enrollment
         WHERE enrollment."id" = NEW."enrollment_id"
           AND enrollment."organization_id" = NEW."organization_id"
           AND enrollment."property_id" = NEW."property_id"
           AND enrollment."state" IN ('awaiting_assisted_approval', 'queued')
           AND enrollment."source_epoch" = NEW."source_epoch"
           AND NEW."ordinal" < enrollment."snapshot_revision_count"
           AND NEW."analysis_sequence" <= enrollment."analysis_start_sequence"
       ) THEN
      RAISE EXCEPTION 'Review Analysis membership may only be captured while opening its enrollment'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Review Analysis enrollment membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    WHERE enrollment."id" = OLD."enrollment_id"
      AND enrollment."organization_id" = OLD."organization_id"
      AND enrollment."property_id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
