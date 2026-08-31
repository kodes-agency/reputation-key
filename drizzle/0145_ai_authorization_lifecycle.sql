-- AI-01: one AI-owned, content-free authorization lifecycle seam.
-- Read-time authorization fencing remains immediate. These records make the
-- retired local derivative generations and their 24-hour erasure objective
-- durable without copying source, prompt, reply, reviewer, or provider data.
CREATE TABLE "ai_authorization_lifecycle_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_envelope_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"authorization_state_version" integer NOT NULL,
	"transition_kind" varchar(24) NOT NULL,
	"authorization_state" varchar(16) NOT NULL,
	"authorized_capabilities" text[] NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"reply_drafting_epoch" integer NOT NULL,
	"property_trends_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"visible_data_classes" text[] NOT NULL,
	"retired_data_classes" text[] NOT NULL,
	"previous_authorization_lineage_id" uuid,
	"previous_authorization_state_version" integer,
	"previous_source_epoch" integer,
	"previous_review_analysis_epoch" integer,
	"previous_reply_drafting_epoch" integer,
	"previous_property_trends_epoch" integer,
	"erasure_status" varchar(16) NOT NULL,
	"erasure_deadline" timestamp with time zone,
	"erasure_completed_at" timestamp with time zone,
	"erasure_failure_code" varchar(64),
	"erasure_attempt_count" integer DEFAULT 0 NOT NULL,
	"erasure_next_attempt_at" timestamp with time zone,
	"erasure_claimed_at" timestamp with time zone,
	"erasure_lease_owner" uuid,
	"erasure_lease_expires_at" timestamp with time zone,
	"erasure_last_failure_at" timestamp with time zone,
	"erased_review_analysis_count" bigint DEFAULT 0 NOT NULL,
	"erased_property_aggregate_count" bigint DEFAULT 0 NOT NULL,
	"erased_property_trend_count" bigint DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_authorization_lifecycle_transition_valid" CHECK ("transition_kind" IN ('enable', 'change', 'revoke', 'restore_reset', 'analysis_backfill')),
	CONSTRAINT "ai_authorization_lifecycle_authorization_valid" CHECK ((("authorization_state" = 'enabled' AND ("authorized_capabilities" = ARRAY['review_analysis']::text[] OR "authorized_capabilities" = ARRAY['reply_drafting']::text[] OR "authorized_capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] OR "authorized_capabilities" = ARRAY['review_analysis', 'property_trends']::text[] OR "authorized_capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[])) OR ("authorization_state" IN ('disabled', 'revoked') AND "authorized_capabilities" = ARRAY[]::text[]))),
	CONSTRAINT "ai_authorization_lifecycle_fence_valid" CHECK ("authorization_state_version" BETWEEN 1 AND 2147483647 AND "source_epoch" BETWEEN 0 AND 2147483647 AND "review_analysis_epoch" BETWEEN 1 AND 2147483647 AND "reply_drafting_epoch" BETWEEN 1 AND 2147483647 AND "property_trends_epoch" BETWEEN 1 AND 2147483647 AND "analysis_start_sequence" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "ai_authorization_lifecycle_visibility_valid" CHECK ("visible_data_classes" = CASE WHEN "authorization_state" <> 'enabled' THEN ARRAY[]::text[] WHEN "authorized_capabilities" @> ARRAY['property_trends']::text[] THEN ARRAY['review_analysis', 'property_aggregate', 'property_trend']::text[] WHEN "authorized_capabilities" @> ARRAY['review_analysis']::text[] THEN ARRAY['review_analysis', 'property_aggregate']::text[] ELSE ARRAY[]::text[] END),
	CONSTRAINT "ai_authorization_lifecycle_retired_classes_valid" CHECK ("retired_data_classes" = ARRAY[]::text[] OR "retired_data_classes" = ARRAY['review_analysis', 'property_aggregate']::text[] OR "retired_data_classes" = ARRAY['property_trend']::text[] OR "retired_data_classes" = ARRAY['review_analysis', 'property_aggregate', 'property_trend']::text[]),
	CONSTRAINT "ai_authorization_lifecycle_previous_fence_valid" CHECK ((("retired_data_classes" = ARRAY[]::text[] AND "previous_authorization_lineage_id" IS NULL AND "previous_authorization_state_version" IS NULL AND "previous_source_epoch" IS NULL AND "previous_review_analysis_epoch" IS NULL AND "previous_reply_drafting_epoch" IS NULL AND "previous_property_trends_epoch" IS NULL) OR (cardinality("retired_data_classes") > 0 AND "previous_authorization_lineage_id" IS NOT NULL AND "previous_authorization_state_version" >= 1 AND "previous_source_epoch" >= 0 AND "previous_review_analysis_epoch" >= 1 AND "previous_reply_drafting_epoch" >= 1 AND "previous_property_trends_epoch" >= 1))),
	CONSTRAINT "ai_authorization_lifecycle_erasure_valid" CHECK ((("erasure_failure_code" IS NULL) = ("erasure_last_failure_at" IS NULL)) AND "erasure_attempt_count" BETWEEN 0 AND 8 AND "erased_review_analysis_count" BETWEEN 0 AND 9007199254740991 AND "erased_property_aggregate_count" BETWEEN 0 AND 9007199254740991 AND "erased_property_trend_count" BETWEEN 0 AND 9007199254740991 AND (("retired_data_classes" = ARRAY[]::text[] AND "erasure_status" = 'not_required' AND "erasure_deadline" IS NULL AND "erasure_completed_at" IS NULL AND "erasure_failure_code" IS NULL AND "erasure_attempt_count" = 0 AND "erasure_next_attempt_at" IS NULL AND "erasure_claimed_at" IS NULL AND "erasure_lease_owner" IS NULL AND "erasure_lease_expires_at" IS NULL AND "erased_review_analysis_count" = 0 AND "erased_property_aggregate_count" = 0 AND "erased_property_trend_count" = 0) OR (cardinality("retired_data_classes") > 0 AND "erasure_deadline" = "applied_at" + interval '24 hours' AND (("erasure_status" = 'pending' AND "erasure_completed_at" IS NULL AND "erasure_attempt_count" BETWEEN 0 AND 7 AND "erasure_next_attempt_at" IS NOT NULL AND "erasure_next_attempt_at" >= "applied_at" AND "erasure_claimed_at" IS NULL AND "erasure_lease_owner" IS NULL AND "erasure_lease_expires_at" IS NULL AND "erased_review_analysis_count" = 0 AND "erased_property_aggregate_count" = 0 AND "erased_property_trend_count" = 0) OR ("erasure_status" = 'in_progress' AND "erasure_completed_at" IS NULL AND "erasure_attempt_count" BETWEEN 1 AND 8 AND "erasure_next_attempt_at" IS NULL AND "erasure_claimed_at" IS NOT NULL AND "erasure_lease_owner" IS NOT NULL AND "erasure_lease_expires_at" > "erasure_claimed_at" AND "erased_review_analysis_count" = 0 AND "erased_property_aggregate_count" = 0 AND "erased_property_trend_count" = 0) OR ("erasure_status" = 'completed' AND "erasure_completed_at" >= "applied_at" AND "erasure_attempt_count" BETWEEN 1 AND 8 AND "erasure_next_attempt_at" IS NULL AND "erasure_claimed_at" IS NULL AND "erasure_lease_owner" IS NULL AND "erasure_lease_expires_at" IS NULL) OR ("erasure_status" = 'failed' AND "erasure_completed_at" IS NULL AND "erasure_failure_code" ~ '^[a-z][a-z0-9_]{2,63}$' AND "erasure_attempt_count" BETWEEN 1 AND 8 AND "erasure_next_attempt_at" IS NULL AND "erasure_claimed_at" IS NULL AND "erasure_lease_owner" IS NULL AND "erasure_lease_expires_at" IS NULL AND "erased_review_analysis_count" = 0 AND "erased_property_aggregate_count" = 0 AND "erased_property_trend_count" = 0))))),
	CONSTRAINT "ai_authorization_lifecycle_time_valid" CHECK ("updated_at" >= "applied_at")
);--> statement-breakpoint
ALTER TABLE "ai_authorization_lifecycle_records" ADD CONSTRAINT "ai_authorization_lifecycle_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_authorization_lifecycle_records" ADD CONSTRAINT "ai_authorization_lifecycle_evidence_fk" FOREIGN KEY ("authorization_lineage_id","authorization_state_version","organization_id","property_id") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id","state_version","organization_id","property_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_authorization_lifecycle_event_unique" ON "ai_authorization_lifecycle_records" USING btree ("event_envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_authorization_lifecycle_authorization_unique" ON "ai_authorization_lifecycle_records" USING btree ("authorization_lineage_id","authorization_state_version","organization_id","property_id");--> statement-breakpoint
CREATE INDEX "ai_authorization_lifecycle_property_idx" ON "ai_authorization_lifecycle_records" USING btree ("organization_id","property_id","applied_at" DESC);--> statement-breakpoint
CREATE INDEX "ai_authorization_lifecycle_erasure_due_idx" ON "ai_authorization_lifecycle_records" USING btree ("erasure_next_attempt_at","erasure_deadline","id") WHERE "erasure_status" = 'pending';--> statement-breakpoint
CREATE INDEX "ai_authorization_lifecycle_erasure_lease_idx" ON "ai_authorization_lifecycle_records" USING btree ("erasure_lease_expires_at","erasure_deadline","id") WHERE "erasure_status" = 'in_progress';--> statement-breakpoint

-- Every existing current authorization receives a fresh identifier-only replay.
-- Seed the same content-free lifecycle evidence in this migration so an older
-- rolling worker may safely receipt the replay without preventing convergence.
WITH "upgrade_authorizations" AS MATERIALIZED (
  SELECT gen_random_uuid() AS "event_envelope_id",
         enablement.*,
         current_evidence."transition_kind",
         property."source_epoch" AS "property_source_epoch",
         property."lifecycle_state" AS "property_lifecycle_state",
         property."google_binding_state" AS "property_google_binding_state",
         property."deleted_at" AS "property_deleted_at",
         previous."authorization_lineage_id" AS "previous_authorization_lineage_id",
         previous."state_version" AS "previous_authorization_state_version",
         previous."capabilities" AS "previous_capabilities",
         previous."authorized_source_epoch" AS "previous_source_epoch",
         previous."review_analysis_epoch" AS "previous_review_analysis_epoch",
         previous."reply_drafting_epoch" AS "previous_reply_drafting_epoch",
         previous."property_trends_epoch" AS "previous_property_trends_epoch"
  FROM "merchant_ai_enablement" AS enablement
  JOIN "properties" AS property
    ON property."organization_id" = enablement."organization_id"
   AND property."id" = enablement."property_id"
  LEFT JOIN "merchant_ai_consent_evidence" AS current_evidence
    ON current_evidence."authorization_lineage_id" = enablement."authorization_lineage_id"
   AND current_evidence."state_version" = enablement."state_version"
   AND current_evidence."organization_id" = enablement."organization_id"
   AND current_evidence."property_id" = enablement."property_id"
  LEFT JOIN LATERAL (
    SELECT evidence."authorization_lineage_id", evidence."state_version",
           evidence."capabilities", evidence."authorized_source_epoch",
           evidence."review_analysis_epoch", evidence."reply_drafting_epoch",
           evidence."property_trends_epoch"
    FROM "merchant_ai_consent_evidence" AS evidence
    WHERE evidence."organization_id" = enablement."organization_id"
      AND evidence."property_id" = enablement."property_id"
      AND evidence."state" = 'enabled'
      AND NOT (
        evidence."authorization_lineage_id" = enablement."authorization_lineage_id"
        AND evidence."state_version" = enablement."state_version"
      )
    ORDER BY evidence."occurred_at" DESC, evidence."state_version" DESC,
             evidence."authorization_lineage_id" DESC
    LIMIT 1
  ) AS previous ON true
), "retirements" AS MATERIALIZED (
  SELECT current_auth.*,
         previous."previous_capabilities" @> ARRAY['review_analysis']::text[]
           AND (
             current_auth."state" <> 'enabled'
             OR NOT (current_auth."capabilities" @> ARRAY['review_analysis']::text[])
             OR previous."previous_authorization_lineage_id" <> current_auth."authorization_lineage_id"
             OR previous."previous_source_epoch" <> current_auth."authorized_source_epoch"
             OR previous."previous_review_analysis_epoch" <> current_auth."review_analysis_epoch"
           ) AS "retire_review",
         previous."previous_capabilities" @> ARRAY['property_trends']::text[]
           AND (
             current_auth."state" <> 'enabled'
             OR NOT (current_auth."capabilities" @> ARRAY['property_trends']::text[])
             OR previous."previous_authorization_lineage_id" <> current_auth."authorization_lineage_id"
             OR previous."previous_source_epoch" <> current_auth."authorized_source_epoch"
             OR previous."previous_review_analysis_epoch" <> current_auth."review_analysis_epoch"
             OR previous."previous_property_trends_epoch" <> current_auth."property_trends_epoch"
           ) AS "retire_trend"
  FROM "upgrade_authorizations" AS current_auth
  CROSS JOIN LATERAL (
    SELECT current_auth."previous_capabilities",
           current_auth."previous_authorization_lineage_id",
           current_auth."previous_source_epoch",
           current_auth."previous_review_analysis_epoch",
           current_auth."previous_property_trends_epoch"
  ) AS previous
  WHERE current_auth."transition_kind" IS NOT NULL
    AND current_auth."authorized_source_epoch" = current_auth."property_source_epoch"
    AND (
      current_auth."state" <> 'enabled'
      OR (
        current_auth."property_deleted_at" IS NULL
        AND current_auth."property_lifecycle_state" = 'active'
        AND current_auth."property_google_binding_state" = 'active'
      )
    )
), "classified" AS MATERIALIZED (
  SELECT retirement.*,
         CASE
           WHEN retirement."state" <> 'enabled' THEN ARRAY[]::text[]
           WHEN retirement."capabilities" @> ARRAY['property_trends']::text[]
             THEN ARRAY['review_analysis', 'property_aggregate', 'property_trend']::text[]
           WHEN retirement."capabilities" @> ARRAY['review_analysis']::text[]
             THEN ARRAY['review_analysis', 'property_aggregate']::text[]
           ELSE ARRAY[]::text[]
         END AS "visible_data_classes",
         CASE
           WHEN retirement."retire_review" AND retirement."retire_trend"
             THEN ARRAY['review_analysis', 'property_aggregate', 'property_trend']::text[]
           WHEN retirement."retire_review"
             THEN ARRAY['review_analysis', 'property_aggregate']::text[]
           WHEN retirement."retire_trend"
             THEN ARRAY['property_trend']::text[]
           ELSE ARRAY[]::text[]
         END AS "retired_data_classes"
  FROM "retirements" AS retirement
), "inserted_events" AS (
  INSERT INTO "outbox_events" (
    "id", "event_type", "event_version", "payload", "organization_id",
    "property_id", "source_context", "source_aggregate_id", "created_at"
  )
  SELECT current_auth."event_envelope_id",
         'identity.merchant_ai.changed', 1,
         jsonb_build_object(
           'organizationId', current_auth."organization_id",
           'propertyId', current_auth."property_id"::text,
           'authorizationLineageId', current_auth."authorization_lineage_id"::text,
           'state', current_auth."state",
           'reviewAnalysisEpoch', current_auth."review_analysis_epoch",
           'replyDraftingEpoch', current_auth."reply_drafting_epoch",
           'propertyTrendsEpoch', current_auth."property_trends_epoch",
           'authorizedSourceEpoch', current_auth."authorized_source_epoch",
           'analysisStartSequence', current_auth."analysis_start_sequence",
           'stateVersion', current_auth."state_version",
           'occurredAt', to_char(
             current_auth."updated_at" AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ),
           'correlationId', NULL
         ),
         current_auth."organization_id", current_auth."property_id"::text,
         'identity', current_auth."property_id"::text, transaction_timestamp()
  FROM "upgrade_authorizations" AS current_auth
  RETURNING "id"
)
INSERT INTO "ai_authorization_lifecycle_records" (
  "id", "event_envelope_id", "organization_id", "property_id",
  "authorization_lineage_id", "authorization_state_version",
  "transition_kind", "authorization_state", "authorized_capabilities",
  "source_epoch", "review_analysis_epoch", "reply_drafting_epoch",
  "property_trends_epoch", "analysis_start_sequence",
  "visible_data_classes", "retired_data_classes",
  "previous_authorization_lineage_id", "previous_authorization_state_version",
  "previous_source_epoch", "previous_review_analysis_epoch",
  "previous_reply_drafting_epoch", "previous_property_trends_epoch",
  "erasure_status", "erasure_deadline", "erasure_next_attempt_at",
  "applied_at", "updated_at"
)
SELECT gen_random_uuid(), current_auth."event_envelope_id",
       current_auth."organization_id", current_auth."property_id",
       current_auth."authorization_lineage_id", current_auth."state_version",
       current_auth."transition_kind", current_auth."state",
       current_auth."capabilities", current_auth."authorized_source_epoch",
       current_auth."review_analysis_epoch", current_auth."reply_drafting_epoch",
       current_auth."property_trends_epoch", current_auth."analysis_start_sequence",
       current_auth."visible_data_classes", current_auth."retired_data_classes",
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_authorization_lineage_id" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_authorization_state_version" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_source_epoch" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_review_analysis_epoch" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_reply_drafting_epoch" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."previous_property_trends_epoch" END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN 'pending' ELSE 'not_required' END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."updated_at" + interval '24 hours' END,
       CASE WHEN cardinality(current_auth."retired_data_classes") > 0
         THEN current_auth."updated_at" END,
       current_auth."updated_at", current_auth."updated_at"
FROM "classified" AS current_auth
JOIN "inserted_events" AS event
  ON event."id" = current_auth."event_envelope_id"
ON CONFLICT (
  "authorization_lineage_id", "authorization_state_version",
  "organization_id", "property_id"
) DO NOTHING;
