CREATE SEQUENCE "google_reply_observation_read_generation_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9007199254740991 START WITH 1;--> statement-breakpoint
CREATE TABLE "google_reply_observation_heads" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_revision" bigint NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"state" varchar(16) NOT NULL,
	"provenance" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_reply_observation_heads_revisions_safe" CHECK ("google_reply_observation_heads"."observation_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observation_heads"."source_epoch" BETWEEN 0 AND 2147483647
        AND "google_reply_observation_heads"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "google_reply_observation_heads_state_valid" CHECK ("google_reply_observation_heads"."state" IN ('live', 'absent')),
	CONSTRAINT "google_reply_observation_heads_provenance_valid" CHECK ("google_reply_observation_heads"."provenance" IN ('repkey_confirmed', 'external_or_unknown', 'none'))
);
--> statement-breakpoint
CREATE TABLE "google_reply_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"observation_revision" bigint NOT NULL,
	"observation_key" varchar(64) NOT NULL,
	"input_digest" varchar(64) NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"read_generation" bigint NOT NULL,
	"state" varchar(16) NOT NULL,
	"change" varchar(16) NOT NULL,
	"resolution" varchar(32) NOT NULL,
	"source" varchar(32) NOT NULL,
	"provenance" varchar(32) NOT NULL,
	"normalized_text" text,
	"normalization_version" varchar(64) NOT NULL,
	"normalized_digest" varchar(64),
	"matched_reply_id" uuid,
	"matched_publication_cycle" bigint,
	"matched_attempt_number" integer,
	"provider_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_reply_observations_revisions_safe" CHECK ("google_reply_observations"."observation_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "google_reply_observations"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observations"."read_generation" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "google_reply_observations_identity_valid" CHECK ("google_reply_observations"."observation_key" ~ '^[0-9a-f]{64}$'
        AND "google_reply_observations"."input_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "google_reply_observations_state_valid" CHECK ("google_reply_observations"."state" IN ('live', 'absent')),
	CONSTRAINT "google_reply_observations_change_valid" CHECK ("google_reply_observations"."change" IN ('added', 'edited', 'deleted', 'unchanged')),
	CONSTRAINT "google_reply_observations_resolution_valid" CHECK ("google_reply_observations"."resolution" IN (
        'confirmed_on_google', 'external_current_live', 'diverged',
        'absent', 'unchanged'
      )),
	CONSTRAINT "google_reply_observations_source_valid" CHECK ("google_reply_observations"."source" IN ('provider_snapshot', 'targeted_reconciliation')),
	CONSTRAINT "google_reply_observations_provenance_valid" CHECK ("google_reply_observations"."provenance" IN ('repkey_confirmed', 'external_or_unknown', 'none')),
	CONSTRAINT "google_reply_observations_content_valid" CHECK ((
        "google_reply_observations"."content_state" = 'active'
        AND "google_reply_observations"."content_erased_at" IS NULL
        AND "google_reply_observations"."normalization_version" = 'google-reply-v1'
        AND (
          ("google_reply_observations"."state" = 'live' AND "google_reply_observations"."normalized_text" IS NOT NULL
            AND "google_reply_observations"."normalized_digest" ~ '^[0-9a-f]{64}$')
          OR ("google_reply_observations"."state" = 'absent' AND "google_reply_observations"."normalized_text" IS NULL
            AND "google_reply_observations"."normalized_digest" IS NULL)
        )
      ) OR (
        "google_reply_observations"."content_state" IN ('source_expired', 'provider_deleted')
        AND "google_reply_observations"."content_erased_at" IS NOT NULL
        AND "google_reply_observations"."normalized_text" IS NULL
        AND "google_reply_observations"."normalized_digest" IS NULL
      )),
	CONSTRAINT "google_reply_observations_match_valid" CHECK ((
        "google_reply_observations"."resolution" = 'confirmed_on_google'
        AND "google_reply_observations"."provenance" = 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NOT NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NOT NULL
        AND "google_reply_observations"."matched_attempt_number" IS NOT NULL
      ) OR (
        "google_reply_observations"."resolution" <> 'confirmed_on_google'
        AND "google_reply_observations"."provenance" <> 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      )),
	CONSTRAINT "google_reply_observations_semantics_valid" CHECK ((
        "google_reply_observations"."resolution" = 'confirmed_on_google'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NOT NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NOT NULL
        AND "google_reply_observations"."matched_attempt_number" IS NOT NULL
      ) OR (
        "google_reply_observations"."resolution" = 'external_current_live'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'external_or_unknown'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'diverged'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'external_or_unknown'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'absent'
        AND "google_reply_observations"."state" = 'absent'
        AND "google_reply_observations"."change" = 'deleted'
        AND "google_reply_observations"."provenance" = 'none'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'unchanged'
        AND "google_reply_observations"."change" = 'unchanged'
        AND (("google_reply_observations"."state" = 'absent'
              AND "google_reply_observations"."provenance" = 'none')
          OR ("google_reply_observations"."state" = 'live'
              AND "google_reply_observations"."provenance" = 'external_or_unknown'))
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "reply_publication_authorizations" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"publication_cycle" bigint NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"base_observation_revision" bigint DEFAULT 0 NOT NULL,
	"authorized_by_user_id" varchar(255) NOT NULL,
	"reply_state_revision" bigint NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"expected_reply_digest" varchar(64) NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_publication_authorizations_pk" PRIMARY KEY("reply_id","publication_cycle"),
	CONSTRAINT "reply_publication_authorizations_revisions_safe" CHECK ("reply_publication_authorizations"."publication_cycle" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "reply_publication_authorizations"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."base_observation_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."reply_state_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "reply_publication_authorizations_digest_valid" CHECK ("reply_publication_authorizations"."normalization_version" = 'google-reply-v1'
        AND "reply_publication_authorizations"."expected_reply_digest" ~ '^[0-9a-f]{64}$'
        AND length(btrim("reply_publication_authorizations"."authorized_by_user_id")) BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "reply_publication_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"publication_cycle" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_operation_key" varchar(255) NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"reply_state_revision" bigint NOT NULL,
	"base_observation_revision" bigint DEFAULT 0 NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"expected_reply_digest" varchar(64) NOT NULL,
	"outcome" varchar(48) DEFAULT 'sending' NOT NULL,
	"provider_correlation_id" varchar(255),
	"provider_responded_at" timestamp with time zone,
	"confirmed_observation_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_publication_attempts_revisions_safe" CHECK ("reply_publication_attempts"."publication_cycle" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."attempt_number" BETWEEN 1 AND 2147483647
        AND "reply_publication_attempts"."source_epoch" BETWEEN 0 AND 2147483647
        AND "reply_publication_attempts"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."reply_state_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."base_observation_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND ("reply_publication_attempts"."confirmed_observation_revision" IS NULL OR "reply_publication_attempts"."confirmed_observation_revision" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "reply_publication_attempts_digest_valid" CHECK ("reply_publication_attempts"."normalization_version" = 'google-reply-v1'
        AND "reply_publication_attempts"."expected_reply_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reply_publication_attempts_outcome_valid" CHECK ("reply_publication_attempts"."outcome" IN (
        'sending', 'provider_outcome_pending', 'retryable_failure',
        'ambiguous', 'terminal_rejection', 'confirmed', 'superseded'
      )),
	CONSTRAINT "reply_publication_attempts_confirmation_valid" CHECK (("reply_publication_attempts"."outcome" = 'confirmed') = ("reply_publication_attempts"."confirmed_observation_revision" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" DROP CONSTRAINT "inbox_handling_cycles_reason_valid";--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_publication_state_check";--> statement-breakpoint
DROP INDEX "replies_publication_reconcile_idx";--> statement-breakpoint
-- Application cursors/CAS values use JavaScript Date millisecond precision.
-- Normalize existing deadlines before the rollout disposition so equality
-- comparisons and (reconcile_due_at,id) keyset progress use one clock scale.
ALTER TABLE "replies"
  ALTER COLUMN "reconcile_due_at" TYPE timestamp(3) with time zone
  USING date_trunc('milliseconds', "reconcile_due_at");--> statement-breakpoint
-- Pre-RPL observation-truth rows have no exact authorization/attempt evidence.
-- Unsent work returns to draft for fresh manager authorization; uncertain work
-- stays explicitly ambiguous and is scheduled for provider readback. No
-- authorization or provider-attempt provenance is synthesized.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "replies"
    WHERE "publication_state" IN ('sending', 'pending_observation', 'ambiguous')
      AND "publication_attempts" < 1
  ) THEN
    RAISE EXCEPTION
      'RPL rollout blocked: uncertain legacy publication has no recorded provider attempt'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;--> statement-breakpoint
-- Migration 0118 gave every older publication the legacy generation zero.
-- An uncertain row with a recorded send count still needs one exact provider
-- read, but cycle zero is not a valid RPL recovery target. Assign mechanical
-- recovery cycle one without creating an authorization, attempt, or
-- confirmation row: reconciliation can identify and settle the old workflow,
-- but it can never treat this disposition as permission to send.
UPDATE "replies"
SET "publication_cycle" = 1,
    "updated_at" = NOW()
WHERE "publication_state" IN ('sending', 'pending_observation', 'ambiguous')
  AND "publication_attempts" >= 1
  AND "publication_cycle" = 0;--> statement-breakpoint
UPDATE "replies"
SET "status" = 'draft',
    "publication_state" = 'cancelled',
    "publication_last_error_class" = NULL,
    "reconcile_due_at" = NULL,
    "updated_at" = NOW()
WHERE "publication_state" IN ('requested', 'authorized');--> statement-breakpoint
UPDATE "replies"
SET "status" = 'publish_failed',
    "publication_state" = 'ambiguous',
    "publication_last_error_class" = 'ambiguous',
    "reconcile_due_at" = COALESCE("reconcile_due_at", date_trunc('milliseconds', NOW())),
    "updated_at" = NOW()
WHERE "publication_state" IN ('sending', 'pending_observation', 'ambiguous');--> statement-breakpoint
CREATE UNIQUE INDEX "material_review_revisions_exact_binding_unique" ON "material_review_revisions" USING btree ("organization_id","property_id","review_id","source_epoch","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_attempt_binding_unique" ON "replies" USING btree ("organization_id","review_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_revision_key" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_head_binding_unique" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","id","observation_revision","source_epoch","material_review_revision","state","provenance");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_observation_binding_unique" ON "reply_publication_attempts" USING btree ("organization_id","property_id","review_id","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_confirmation_binding_unique" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_authorizations_attempt_binding_unique" ON "reply_publication_authorizations" USING btree ("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest");--> statement-breakpoint
CREATE INDEX "reply_publication_authorizations_review_idx" ON "reply_publication_authorizations" USING btree ("organization_id","review_id","authorized_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_reply_publication_authorization_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'reply publication authorizations are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reply_publication_authorizations_immutable"
BEFORE UPDATE OR DELETE ON "reply_publication_authorizations"
FOR EACH ROW EXECUTE FUNCTION "reject_reply_publication_authorization_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "reply_publication_authorizations_truncate_guard"
BEFORE TRUNCATE ON "reply_publication_authorizations"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_reply_publication_authorization_mutation_v1"();--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations"
ENABLE ALWAYS TRIGGER "reply_publication_authorizations_immutable";--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations"
ENABLE ALWAYS TRIGGER "reply_publication_authorizations_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "reply_publication_authorizations" FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "google_reply_observation_heads" ADD CONSTRAINT "google_reply_observation_heads_exact_observation_fk" FOREIGN KEY ("organization_id","property_id","review_id","observation_id","observation_revision","source_epoch","material_review_revision","state","provenance") REFERENCES "public"."google_reply_observations"("organization_id","property_id","review_id","id","observation_revision","source_epoch","material_review_revision","state","provenance") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_matched_attempt_fk" FOREIGN KEY ("organization_id","property_id","review_id","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision") REFERENCES "public"."reply_publication_attempts"("organization_id","property_id","review_id","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_reply_binding_fk" FOREIGN KEY ("organization_id","review_id","reply_id") REFERENCES "public"."replies"("organization_id","review_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_reply_binding_fk" FOREIGN KEY ("organization_id","review_id","reply_id") REFERENCES "public"."replies"("organization_id","review_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_authorization_fk" FOREIGN KEY ("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest") REFERENCES "public"."reply_publication_authorizations"("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_exact_confirmation_fk" FOREIGN KEY ("organization_id","property_id","review_id","confirmed_observation_revision","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision") REFERENCES "public"."google_reply_observations"("organization_id","property_id","review_id","observation_revision","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_reply_observation_heads_scope_idx" ON "google_reply_observation_heads" USING btree ("organization_id","property_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_idempotency_key" ON "google_reply_observations" USING btree ("organization_id","review_id","observation_key");--> statement-breakpoint
CREATE INDEX "google_reply_observations_scope_idx" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_cycle_attempt_key" ON "reply_publication_attempts" USING btree ("reply_id","publication_cycle","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_operation_key" ON "reply_publication_attempts" USING btree ("organization_id","provider_operation_key");--> statement-breakpoint
CREATE INDEX "reply_publication_attempts_review_idx" ON "reply_publication_attempts" USING btree ("organization_id","review_id","created_at");--> statement-breakpoint
CREATE INDEX "replies_publication_reconcile_idx" ON "replies" USING btree ("reconcile_due_at","id") WHERE publication_state IN ('pending_observation', 'ambiguous') AND reconcile_due_at IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_reason_valid" CHECK ("inbox_handling_cycles"."opened_reason" IN (
        'legacy_backfill',
        'review_observed',
        'material_revision_changed',
        'manual_reopen',
        'provider_reply_deleted',
        'provider_reply_diverged'
      ));--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_publication_state_check" CHECK ("replies"."publication_state" IN ('requested', 'authorized', 'sending', 'pending_observation', 'published', 'terminal', 'ambiguous', 'cancelled'));
