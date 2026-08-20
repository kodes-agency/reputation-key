CREATE TYPE "public"."google_import_v2_action" AS ENUM('create', 'relink');--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_item_status" AS ENUM('pending', 'processing', 'imported', 'relinked', 'already_exists', 'region_unavailable', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_outcome" AS ENUM('imported', 'relinked', 'already_exists', 'region_unavailable', 'active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'authorization_changed', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted', 'temporarily_unavailable', 'internal_error');--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_parent_status" AS ENUM('queued', 'processing', 'completed', 'completed_with_issues', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "gbp_import_item_retry_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"initiating_user_id" varchar(255) NOT NULL,
	"item_id" uuid NOT NULL,
	"retry_request_id" uuid NOT NULL,
	"request_digest_key_version" varchar(32) NOT NULL,
	"request_digest" varchar(43) NOT NULL,
	"accepted_retry_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_item_retry_receipts_values_valid" CHECK ((
        "gbp_import_item_retry_receipts"."request_digest_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "gbp_import_item_retry_receipts"."request_digest" ~ '^[A-Za-z0-9_-]{43}$'
        AND "gbp_import_item_retry_receipts"."accepted_retry_revision" >= 1
      ))
);
--> statement-breakpoint
CREATE TABLE "gbp_import_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"import_job_id" uuid NOT NULL,
	"connection_id" uuid,
	"existing_property_id" uuid,
	"provider_account_suffix" varchar(255),
	"provider_location_suffix" varchar(255),
	"expected_connection_lifecycle_version" integer NOT NULL,
	"expected_connection_access_version" integer NOT NULL,
	"expected_credential_generation" integer NOT NULL,
	"expected_source_epoch" integer,
	"expected_profile_version" integer,
	"action" "google_import_v2_action" NOT NULL,
	"update_existing_profile" boolean NOT NULL,
	"property_name" varchar(100) NOT NULL,
	"property_address" text,
	"country_code" varchar(2),
	"timezone" varchar(64) NOT NULL,
	"processing_region" text NOT NULL,
	"routing_policy_version" integer NOT NULL,
	"status" "google_import_v2_item_status" DEFAULT 'pending' NOT NULL,
	"outcome_code" "google_import_v2_outcome",
	"effect_deadline_at" timestamp with time zone NOT NULL,
	"retry_revision" integer DEFAULT 0 NOT NULL,
	"highest_attempt_for_revision" integer DEFAULT 0 NOT NULL,
	"claim_fence" uuid,
	"claim_lease_expires_at" timestamp with time zone,
	"first_terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_request_items_profile_valid" CHECK ((
        char_length(btrim("gbp_import_request_items"."property_name")) BETWEEN 1 AND 100
        AND char_length("gbp_import_request_items"."timezone") BETWEEN 1 AND 64
        AND ("gbp_import_request_items"."country_code" IS NULL OR "gbp_import_request_items"."country_code" ~ '^[A-Z]{2}$')
        AND (
          ("gbp_import_request_items"."action" = 'create' AND "gbp_import_request_items"."existing_property_id" IS NULL AND "gbp_import_request_items"."country_code" IS NOT NULL AND "gbp_import_request_items"."update_existing_profile" = true AND "gbp_import_request_items"."expected_source_epoch" IS NULL AND "gbp_import_request_items"."expected_profile_version" IS NULL)
          OR ("gbp_import_request_items"."action" = 'relink' AND "gbp_import_request_items"."existing_property_id" IS NOT NULL AND "gbp_import_request_items"."expected_source_epoch" >= 0 AND "gbp_import_request_items"."expected_profile_version" >= 1)
        )
      )),
	CONSTRAINT "gbp_import_request_items_generations_valid" CHECK ((
        "gbp_import_request_items"."expected_connection_lifecycle_version" >= 1
        AND "gbp_import_request_items"."expected_connection_access_version" >= 1
        AND "gbp_import_request_items"."expected_credential_generation" >= 1
        AND "gbp_import_request_items"."routing_policy_version" >= 1
        AND "gbp_import_request_items"."retry_revision" >= 0
      )),
	CONSTRAINT "gbp_import_request_items_attempt_fence_valid" CHECK ((
        "gbp_import_request_items"."highest_attempt_for_revision" BETWEEN 0 AND 5
        AND ("gbp_import_request_items"."claim_fence" IS NULL) = ("gbp_import_request_items"."claim_lease_expires_at" IS NULL)
        AND (
          "gbp_import_request_items"."status" <> 'processing'
          OR ("gbp_import_request_items"."claim_fence" IS NOT NULL AND "gbp_import_request_items"."highest_attempt_for_revision" BETWEEN 1 AND 5)
        )
      )),
	CONSTRAINT "gbp_import_request_items_status_outcome_valid" CHECK ((
        ("gbp_import_request_items"."status" IN ('pending', 'processing') AND "gbp_import_request_items"."outcome_code" IS NULL)
        OR ("gbp_import_request_items"."status" = 'imported' AND "gbp_import_request_items"."outcome_code" = 'imported')
        OR ("gbp_import_request_items"."status" = 'relinked' AND "gbp_import_request_items"."outcome_code" = 'relinked')
        OR ("gbp_import_request_items"."status" = 'already_exists' AND "gbp_import_request_items"."outcome_code" = 'already_exists')
        OR ("gbp_import_request_items"."status" = 'region_unavailable' AND "gbp_import_request_items"."outcome_code" = 'region_unavailable')
        OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'internal_error'))
        OR ("gbp_import_request_items"."status" = 'cancelled' AND "gbp_import_request_items"."outcome_code" IN ('authorization_changed', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      )),
	CONSTRAINT "gbp_import_request_items_terminal_valid" CHECK ("gbp_import_request_items"."outcome_code" IS NULL OR "gbp_import_request_items"."first_terminal_at" IS NOT NULL),
	CONSTRAINT "gbp_import_request_items_deadline_valid" CHECK ("gbp_import_request_items"."effect_deadline_at" = "gbp_import_request_items"."created_at" + interval '24 hours'),
	CONSTRAINT "gbp_import_request_items_routing_retention_valid" CHECK ((
        (
          ("gbp_import_request_items"."status" IN ('pending', 'processing') OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" = 'temporarily_unavailable'))
          AND "gbp_import_request_items"."connection_id" IS NOT NULL
          AND "gbp_import_request_items"."provider_account_suffix" IS NOT NULL
          AND "gbp_import_request_items"."provider_location_suffix" IS NOT NULL
        )
        OR (
          NOT ("gbp_import_request_items"."status" IN ('pending', 'processing') OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" = 'temporarily_unavailable'))
          AND "gbp_import_request_items"."provider_account_suffix" IS NULL
          AND "gbp_import_request_items"."provider_location_suffix" IS NULL
        )
      )),
	CONSTRAINT "gbp_import_request_items_provider_suffix_valid" CHECK ((
        ("gbp_import_request_items"."provider_account_suffix" IS NULL OR "gbp_import_request_items"."provider_account_suffix" !~ '[/?#[:space:][:cntrl:]]')
        AND ("gbp_import_request_items"."provider_location_suffix" IS NULL OR "gbp_import_request_items"."provider_location_suffix" !~ '[/?#[:space:][:cntrl:]]')
      ))
);
--> statement-breakpoint
CREATE TABLE "gbp_import_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"request_id" uuid NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"status" "google_import_v2_parent_status" DEFAULT 'queued' NOT NULL,
	"total_count" integer NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer NOT NULL,
	"processing_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"relinked_count" integer DEFAULT 0 NOT NULL,
	"already_exists_count" integer DEFAULT 0 NOT NULL,
	"region_unavailable_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"deletion_fence" integer DEFAULT 0 NOT NULL,
	"wire_replay_key_version" varchar(32),
	"wire_replay_digest" varchar(43),
	"semantic_replay_key_version" varchar(32),
	"semantic_replay_digest" varchar(43),
	"first_terminal_at" timestamp with time zone,
	"purge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_requests_replay_pairs_valid" CHECK ((
        ("gbp_import_requests"."wire_replay_key_version" IS NULL) = ("gbp_import_requests"."wire_replay_digest" IS NULL)
        AND ("gbp_import_requests"."semantic_replay_key_version" IS NULL) = ("gbp_import_requests"."semantic_replay_digest" IS NULL)
        AND ("gbp_import_requests"."wire_replay_digest" IS NULL) = ("gbp_import_requests"."semantic_replay_digest" IS NULL)
      )),
	CONSTRAINT "gbp_import_requests_replay_encoding_valid" CHECK ((
        "gbp_import_requests"."wire_replay_digest" IS NULL OR (
          "gbp_import_requests"."wire_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND "gbp_import_requests"."semantic_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND "gbp_import_requests"."wire_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
          AND "gbp_import_requests"."semantic_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
        )
      )),
	CONSTRAINT "gbp_import_requests_terminal_times_valid" CHECK ((
        ("gbp_import_requests"."first_terminal_at" IS NULL) = ("gbp_import_requests"."purge_at" IS NULL)
        AND ("gbp_import_requests"."first_terminal_at" IS NULL OR "gbp_import_requests"."purge_at" = "gbp_import_requests"."first_terminal_at" + interval '30 days')
        AND ("gbp_import_requests"."status" IN ('queued', 'processing') OR "gbp_import_requests"."first_terminal_at" IS NOT NULL)
      )),
	CONSTRAINT "gbp_import_requests_counts_valid" CHECK ((
        "gbp_import_requests"."total_count" BETWEEN 1 AND 100
        AND "gbp_import_requests"."deletion_fence" >= 0
        AND "gbp_import_requests"."pending_count" >= 0
        AND "gbp_import_requests"."processing_count" >= 0
        AND "gbp_import_requests"."imported_count" >= 0
        AND "gbp_import_requests"."relinked_count" >= 0
        AND "gbp_import_requests"."already_exists_count" >= 0
        AND "gbp_import_requests"."region_unavailable_count" >= 0
        AND "gbp_import_requests"."failed_count" >= 0
        AND "gbp_import_requests"."cancelled_count" >= 0
        AND "gbp_import_requests"."processed_count" = "gbp_import_requests"."imported_count" + "gbp_import_requests"."relinked_count" + "gbp_import_requests"."already_exists_count" + "gbp_import_requests"."region_unavailable_count" + "gbp_import_requests"."failed_count" + "gbp_import_requests"."cancelled_count"
        AND "gbp_import_requests"."total_count" = "gbp_import_requests"."pending_count" + "gbp_import_requests"."processing_count" + "gbp_import_requests"."processed_count"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_request_items_org_id_key" ON "gbp_import_request_items" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_org_id_key" ON "gbp_import_requests" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_org_id_key" ON "google_connections" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "gbp_import_item_retry_receipts" ADD CONSTRAINT "gbp_import_item_retry_receipts_item_tenant_fk" FOREIGN KEY ("organization_id","item_id") REFERENCES "public"."gbp_import_request_items"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_parent_tenant_fk" FOREIGN KEY ("organization_id","import_job_id") REFERENCES "public"."gbp_import_requests"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_connection_tenant_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."google_connections"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_property_tenant_fk" FOREIGN KEY ("organization_id","existing_property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_item_retry_receipts_request_unique" ON "gbp_import_item_retry_receipts" USING btree ("organization_id","initiating_user_id","item_id","retry_request_id");--> statement-breakpoint
-- gbp_import_request_items_org_id_key is created before its composite foreign keys above.
CREATE INDEX "gbp_import_request_items_parent_status_idx" ON "gbp_import_request_items" USING btree ("organization_id","import_job_id","status","retry_revision");--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_effect_deadline_idx" ON "gbp_import_request_items" USING btree ("effect_deadline_at","id") WHERE "gbp_import_request_items"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_routing_idx" ON "gbp_import_request_items" USING btree ("organization_id","id","status") INCLUDE ("processing_region","routing_policy_version") WHERE "gbp_import_request_items"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_org_request_unique" ON "gbp_import_requests" USING btree ("organization_id","request_id");--> statement-breakpoint
-- gbp_import_requests_org_id_key is created before its composite foreign key above.
CREATE INDEX "gbp_import_requests_initiated_request_idx" ON "gbp_import_requests" USING btree ("organization_id","initiated_by","request_id");--> statement-breakpoint
CREATE INDEX "gbp_import_requests_purge_idx" ON "gbp_import_requests" USING btree ("purge_at","id") WHERE "gbp_import_requests"."purge_at" IS NOT NULL;--> statement-breakpoint
-- google_connections_org_id_key is created before its composite foreign key above.