CREATE TABLE "ai_review_analysis_enrollment_memberships" (
	"enrollment_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"ordinal" bigint NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_enrollment_memberships_pk" PRIMARY KEY("enrollment_id","ordinal"),
	CONSTRAINT "ai_review_enrollment_memberships_fence_safe" CHECK ("ai_review_analysis_enrollment_memberships"."ordinal" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollment_memberships"."source_epoch" BETWEEN 0 AND 2147483647
        AND "ai_review_analysis_enrollment_memberships"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollment_memberships"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "ai_review_analysis_enrollment_replays" (
	"enrollment_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_analysis_enrollment_replays_pk" PRIMARY KEY("enrollment_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "ai_review_analysis_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"authorization_state_version" integer NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"trigger_event_envelope_id" uuid NOT NULL,
	"state" varchar(16) NOT NULL,
	"snapshot_revision_count" bigint NOT NULL,
	"snapshot_revision_set_digest" varchar(64) NOT NULL,
	"snapshot_captured_at" timestamp with time zone NOT NULL,
	"enrolled_revision_count" bigint DEFAULT 0 NOT NULL,
	"caught_up_eligible_revision_count" bigint,
	"caught_up_analysis_sequence" bigint,
	"caught_up_revision_set_digest" varchar(64),
	"caught_up_at" timestamp with time zone,
	"terminal_reason" varchar(64),
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_analysis_enrollments_state_valid" CHECK ("ai_review_analysis_enrollments"."state" IN ('queued', 'running', 'caught_up', 'superseded', 'stalled')),
	CONSTRAINT "ai_review_analysis_enrollments_fence_safe" CHECK ("ai_review_analysis_enrollments"."authorization_state_version" BETWEEN 1 AND 2147483647
        AND "ai_review_analysis_enrollments"."source_epoch" BETWEEN 0 AND 2147483647
        AND "ai_review_analysis_enrollments"."review_analysis_epoch" BETWEEN 1 AND 2147483647
        AND "ai_review_analysis_enrollments"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_review_analysis_enrollments_snapshot_valid" CHECK ("ai_review_analysis_enrollments"."snapshot_revision_count" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("ai_review_analysis_enrollments"."snapshot_revision_count" = 0 AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR ("ai_review_analysis_enrollments"."snapshot_revision_count" > 0 AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND "ai_review_analysis_enrollments"."enrolled_revision_count" BETWEEN 0 AND "ai_review_analysis_enrollments"."snapshot_revision_count"),
	CONSTRAINT "ai_review_analysis_enrollments_terminal_valid" CHECK ((
        "ai_review_analysis_enrollments"."state" IN ('queued', 'running')
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_at" IS NULL
      ) OR (
        "ai_review_analysis_enrollments"."state" = 'caught_up'
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" BETWEEN "ai_review_analysis_enrollments"."analysis_start_sequence" AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("ai_review_analysis_enrollments"."caught_up_eligible_revision_count" = 0 AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR ("ai_review_analysis_enrollments"."caught_up_eligible_revision_count" > 0 AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NOT NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" = 'eligible_revision_set_caught_up'
        AND "ai_review_analysis_enrollments"."terminal_at" = "ai_review_analysis_enrollments"."caught_up_at"
      ) OR (
        "ai_review_analysis_enrollments"."state" IN ('superseded', 'stalled')
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" ~ '^[a-z][a-z0-9_]{2,63}$'
        AND "ai_review_analysis_enrollments"."terminal_at" IS NOT NULL
      )),
	CONSTRAINT "ai_review_analysis_enrollments_time_valid" CHECK ("ai_review_analysis_enrollments"."snapshot_captured_at" >= "ai_review_analysis_enrollments"."created_at"
        AND "ai_review_analysis_enrollments"."updated_at" >= "ai_review_analysis_enrollments"."created_at"
        AND ("ai_review_analysis_enrollments"."caught_up_at" IS NULL OR "ai_review_analysis_enrollments"."caught_up_at" >= "ai_review_analysis_enrollments"."snapshot_captured_at")
        AND ("ai_review_analysis_enrollments"."terminal_at" IS NULL OR "ai_review_analysis_enrollments"."terminal_at" >= "ai_review_analysis_enrollments"."snapshot_captured_at"))
);
--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backfill_run_memberships" ADD COLUMN "source_revision" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_scope_unique" ON "ai_review_analysis_enrollments" USING btree ("id","organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_ai_consent_evidence_scope_unique" ON "merchant_ai_consent_evidence" USING btree ("authorization_lineage_id","state_version","organization_id","property_id");--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollment_memberships" ADD CONSTRAINT "ai_review_enrollment_memberships_scope_fk" FOREIGN KEY ("enrollment_id","organization_id","property_id") REFERENCES "public"."ai_review_analysis_enrollments"("id","organization_id","property_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollment_replays" ADD CONSTRAINT "ai_review_analysis_enrollment_replays_enrollment_fk" FOREIGN KEY ("enrollment_id","organization_id","property_id") REFERENCES "public"."ai_review_analysis_enrollments"("id","organization_id","property_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollment_replays" ADD CONSTRAINT "ai_review_analysis_enrollment_replays_run_fk" FOREIGN KEY ("run_id","organization_id","property_id") REFERENCES "public"."ai_review_analysis_backfill_runs"("id","organization_id","property_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments" ADD CONSTRAINT "ai_review_analysis_enrollments_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments" ADD CONSTRAINT "ai_review_analysis_enrollments_authorization_fk" FOREIGN KEY ("authorization_lineage_id","authorization_state_version","organization_id","property_id") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id","state_version","organization_id","property_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments" ADD CONSTRAINT "ai_review_analysis_enrollments_provider_profile_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_enrollment_memberships_review_unique" ON "ai_review_analysis_enrollment_memberships" USING btree ("enrollment_id","review_id");--> statement-breakpoint
CREATE INDEX "ai_review_enrollment_memberships_scope_idx" ON "ai_review_analysis_enrollment_memberships" USING btree ("organization_id","property_id","enrollment_id","ordinal");--> statement-breakpoint
CREATE INDEX "ai_review_enrollment_memberships_review_idx" ON "ai_review_analysis_enrollment_memberships" USING btree ("organization_id","property_id","review_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollment_replays_run_unique" ON "ai_review_analysis_enrollment_replays" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_review_analysis_enrollment_replays_scope_idx" ON "ai_review_analysis_enrollment_replays" USING btree ("organization_id","property_id","enrollment_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_fence_unique" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id","authorization_lineage_id","authorization_state_version","source_epoch","review_analysis_epoch","analysis_start_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_trigger_unique" ON "ai_review_analysis_enrollments" USING btree ("trigger_event_envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_one_active" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id") WHERE "ai_review_analysis_enrollments"."state" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ai_review_analysis_enrollments_actionable_idx" ON "ai_review_analysis_enrollments" USING btree ("created_at","id") WHERE "ai_review_analysis_enrollments"."state" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ai_review_analysis_enrollments_property_idx" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backfill_run_memberships" ADD CONSTRAINT "ai_review_backfill_memberships_revision_safe" CHECK ("ai_review_analysis_backfill_run_memberships"."source_revision" IS NULL OR "ai_review_analysis_backfill_run_memberships"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint);--> statement-breakpoint
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
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Review Analysis enrollment authority is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF OLD."state" IN ('caught_up', 'superseded', 'stalled') THEN
      RAISE EXCEPTION 'Terminal Review Analysis enrollment is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."state" NOT IN ('queued', 'running', 'caught_up', 'superseded', 'stalled')
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
           AND enrollment."state" = 'queued'
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
$$;--> statement-breakpoint
CREATE TRIGGER "ai_review_analysis_enrollment_membership_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_review_analysis_enrollment_memberships"
FOR EACH ROW
EXECUTE FUNCTION "guard_ai_review_analysis_enrollment_membership_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_ai_review_analysis_enrollment_replay_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "ai_review_analysis_enrollments" AS enrollment
      JOIN "ai_review_analysis_backfill_runs" AS run
        ON run."id" = NEW."run_id"
       AND run."organization_id" = NEW."organization_id"
       AND run."property_id" = NEW."property_id"
      WHERE enrollment."id" = NEW."enrollment_id"
        AND enrollment."organization_id" = NEW."organization_id"
        AND enrollment."property_id" = NEW."property_id"
        AND enrollment."state" IN ('queued', 'running')
        AND run."state" = 'running'
        AND run."reason_code" = 'first_enablement_enrollment_v1'
        AND run."source_epoch" = enrollment."source_epoch"
        AND run."review_analysis_epoch" = enrollment."review_analysis_epoch"
        AND run."analysis_start_sequence" = enrollment."analysis_start_sequence"
    ) THEN
      RAISE EXCEPTION 'Review Analysis enrollment replay fence is invalid'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Review Analysis enrollment replay is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    WHERE enrollment."id" = OLD."enrollment_id"
  ) AND EXISTS (
    SELECT 1
    FROM "ai_review_analysis_backfill_runs" AS run
    WHERE run."id" = OLD."run_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment replay is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_review_analysis_enrollment_replay_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_review_analysis_enrollment_replays"
FOR EACH ROW
EXECUTE FUNCTION "guard_ai_review_analysis_enrollment_replay_v1"();--> statement-breakpoint
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
        AND (
          run."reason_code" <> 'first_enablement_enrollment_v1'
          OR NEW."source_revision" IS NOT NULL
        )
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
-- AI-02 CURRENT AUTHORIZATION REPLAY BEGIN
INSERT INTO "outbox_events" (
  "id", "event_type", "event_version", "payload", "organization_id",
  "property_id", "source_context", "source_aggregate_id", "created_at"
)
SELECT gen_random_uuid(), 'identity.merchant_ai.changed', 1,
       jsonb_build_object(
         'organizationId', enablement."organization_id",
         'propertyId', enablement."property_id"::text,
         'authorizationLineageId', enablement."authorization_lineage_id"::text,
         'state', enablement."state",
         'reviewAnalysisEpoch', enablement."review_analysis_epoch",
         'replyDraftingEpoch', enablement."reply_drafting_epoch",
         'propertyTrendsEpoch', enablement."property_trends_epoch",
         'authorizedSourceEpoch', enablement."authorized_source_epoch",
         'analysisStartSequence', enablement."analysis_start_sequence",
         'stateVersion', enablement."state_version",
         'occurredAt', to_char(
           enablement."updated_at" AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
         ),
         'correlationId', NULL
       ),
       enablement."organization_id", enablement."property_id"::text,
       'identity', enablement."property_id"::text, transaction_timestamp()
FROM "merchant_ai_enablement" AS enablement
JOIN "properties" AS property
  ON property."organization_id" = enablement."organization_id"
 AND property."id" = enablement."property_id"
WHERE enablement."state" = 'enabled'
  AND enablement."capabilities" @> ARRAY['review_analysis']::text[]
  AND enablement."authorized_source_epoch" = property."source_epoch"
  AND property."lifecycle_state" = 'active'
  AND property."google_binding_state" = 'active'
  AND property."deleted_at" IS NULL;
-- AI-02 CURRENT AUTHORIZATION REPLAY END
-- AI-02 CURRENT ENROLLMENT SEED BEGIN
WITH "authorized_properties" AS MATERIALIZED (
  SELECT enablement."organization_id", enablement."property_id",
         enablement."authorization_lineage_id", enablement."state_version",
         enablement."authorized_source_epoch", enablement."review_analysis_epoch",
         enablement."analysis_start_sequence",
         enablement."provider_deployment_profile_version"
  FROM "merchant_ai_enablement" AS enablement
  JOIN "properties" AS property
    ON property."organization_id" = enablement."organization_id"
   AND property."id" = enablement."property_id"
  WHERE enablement."state" = 'enabled'
    AND enablement."capabilities" @> ARRAY['review_analysis']::text[]
    AND enablement."authorized_source_epoch" = property."source_epoch"
    AND property."lifecycle_state" = 'active'
    AND property."google_binding_state" = 'active'
    AND property."deleted_at" IS NULL
  FOR UPDATE OF property
),
"upgrade_authorizations" AS MATERIALIZED (
  SELECT authorized.*, event."id" AS "trigger_event_envelope_id"
  FROM "authorized_properties" AS authorized
  JOIN LATERAL (
    SELECT candidate."id"
    FROM "outbox_events" AS candidate
    WHERE candidate."event_type" = 'identity.merchant_ai.changed'
      AND candidate."event_version" = 1
      AND candidate."organization_id" = authorized."organization_id"
      AND candidate."property_id" = authorized."property_id"::text
      AND candidate."source_context" = 'identity'
      AND candidate."source_aggregate_id" = authorized."property_id"::text
      AND candidate."created_at" = transaction_timestamp()
      AND candidate."payload" ->> 'authorizationLineageId' =
          authorized."authorization_lineage_id"::text
      AND candidate."payload" ->> 'state' = 'enabled'
      AND (candidate."payload" ->> 'stateVersion')::integer =
          authorized."state_version"
      AND (candidate."payload" ->> 'authorizedSourceEpoch')::integer =
          authorized."authorized_source_epoch"
      AND (candidate."payload" ->> 'reviewAnalysisEpoch')::integer =
          authorized."review_analysis_epoch"
      AND (candidate."payload" ->> 'analysisStartSequence')::bigint =
          authorized."analysis_start_sequence"
    ORDER BY candidate."id"
    LIMIT 1
  ) AS event ON true
),
"snapshots" AS MATERIALIZED (
  SELECT authorized.*,
         count(review."id")::bigint AS "revision_count",
         COALESCE(
           encode(sha256(convert_to(string_agg(
             review."id"::text || ':' || review."source_revision"::text || ':' || review."analysis_sequence"::text,
             ',' ORDER BY review."id"
           ), 'UTF8')), 'hex'),
           'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
         ) AS "revision_set_digest"
  FROM "upgrade_authorizations" AS authorized
  LEFT JOIN "reviews" AS review
    ON review."organization_id" = authorized."organization_id"
   AND review."property_id" = authorized."property_id"
   AND review."source_epoch" = authorized."authorized_source_epoch"
   AND review."source_revision" >= 1
   AND review."analysis_sequence" <= authorized."analysis_start_sequence"
   AND review."text" IS NOT NULL
   AND review."content_expires_at" > transaction_timestamp()
   AND review."ai_source_byte_length" <= 16384
   AND (
     COALESCE(octet_length(review."text"), 0)::bigint
     + COALESCE(octet_length(review."language_code"), 0)::bigint
     + COALESCE(octet_length(review."reviewer_name"), 0)::bigint
   ) <= 65536
  GROUP BY authorized."organization_id", authorized."property_id",
           authorized."authorization_lineage_id", authorized."state_version",
           authorized."authorized_source_epoch", authorized."review_analysis_epoch",
           authorized."analysis_start_sequence",
           authorized."provider_deployment_profile_version",
           authorized."trigger_event_envelope_id"
)
INSERT INTO "ai_review_analysis_enrollments" (
  "id", "organization_id", "property_id", "authorization_lineage_id",
  "authorization_state_version", "source_epoch", "review_analysis_epoch",
  "analysis_start_sequence", "provider_deployment_profile_version",
  "trigger_event_envelope_id", "state", "snapshot_revision_count",
  "snapshot_revision_set_digest", "snapshot_captured_at",
  "enrolled_revision_count", "created_at", "updated_at"
)
SELECT gen_random_uuid(), snapshot."organization_id", snapshot."property_id",
       snapshot."authorization_lineage_id", snapshot."state_version",
       snapshot."authorized_source_epoch", snapshot."review_analysis_epoch",
       snapshot."analysis_start_sequence",
       snapshot."provider_deployment_profile_version",
       snapshot."trigger_event_envelope_id", 'queued',
       snapshot."revision_count", snapshot."revision_set_digest",
       transaction_timestamp(), 0, transaction_timestamp(), transaction_timestamp()
FROM "snapshots" AS snapshot
ON CONFLICT (
  "organization_id", "property_id", "authorization_lineage_id",
  "authorization_state_version", "source_epoch", "review_analysis_epoch",
  "analysis_start_sequence"
) DO NOTHING;
--> statement-breakpoint
SELECT set_config(
  'repkey.ai_review_enrollment_membership_writer',
  'canonical-v1',
  true
);
--> statement-breakpoint
INSERT INTO "ai_review_analysis_enrollment_memberships" (
  "enrollment_id", "organization_id", "property_id", "ordinal", "review_id",
  "source_epoch", "source_revision", "analysis_sequence", "created_at"
)
SELECT enrollment."id", enrollment."organization_id", enrollment."property_id",
       row_number() OVER (
         PARTITION BY enrollment."id"
         ORDER BY review."reviewed_at" ASC, review."id" ASC
       ) - 1,
       review."id", review."source_epoch", review."source_revision",
       review."analysis_sequence", transaction_timestamp()
FROM "ai_review_analysis_enrollments" AS enrollment
JOIN "outbox_events" AS event
  ON event."id" = enrollment."trigger_event_envelope_id"
 AND event."created_at" = transaction_timestamp()
 AND event."event_type" = 'identity.merchant_ai.changed'
JOIN "reviews" AS review
  ON review."organization_id" = enrollment."organization_id"
 AND review."property_id" = enrollment."property_id"
 AND review."source_epoch" = enrollment."source_epoch"
 AND review."source_revision" >= 1
 AND review."analysis_sequence" <= enrollment."analysis_start_sequence"
 AND review."text" IS NOT NULL
 AND review."content_expires_at" > transaction_timestamp()
 AND review."ai_source_byte_length" <= 16384
 AND (
   COALESCE(octet_length(review."text"), 0)::bigint
   + COALESCE(octet_length(review."language_code"), 0)::bigint
   + COALESCE(octet_length(review."reviewer_name"), 0)::bigint
 ) <= 65536
WHERE enrollment."state" = 'queued'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    JOIN "outbox_events" AS event
      ON event."id" = enrollment."trigger_event_envelope_id"
     AND event."created_at" = transaction_timestamp()
     AND event."event_type" = 'identity.merchant_ai.changed'
    LEFT JOIN LATERAL (
      SELECT count(membership."review_id")::bigint AS "revision_count",
             COALESCE(
               encode(sha256(convert_to(string_agg(
                 membership."review_id"::text || ':' || membership."source_revision"::text || ':' || membership."analysis_sequence"::text,
                 ',' ORDER BY membership."review_id"
               ), 'UTF8')), 'hex'),
               'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
             ) AS "revision_set_digest"
      FROM "ai_review_analysis_enrollment_memberships" AS membership
      WHERE membership."enrollment_id" = enrollment."id"
    ) AS proof ON true
    WHERE enrollment."state" = 'queued'
      AND (
        proof."revision_count" <> enrollment."snapshot_revision_count"
        OR proof."revision_set_digest" <> enrollment."snapshot_revision_set_digest"
      )
  ) THEN
    RAISE EXCEPTION 'AI-02 upgrade enrollment snapshot is inconsistent'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
-- AI-02 CURRENT ENROLLMENT SEED END
