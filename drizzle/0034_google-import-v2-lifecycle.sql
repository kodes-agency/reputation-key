ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_profile_valid";--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_status_outcome_valid";--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_routing_retention_valid";--> statement-breakpoint
ALTER TYPE "public"."google_import_v2_outcome" ADD VALUE IF NOT EXISTS 'cleanup_required' BEFORE 'internal_error';--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "destination_property_id" uuid;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "approval_binding_id" varchar(255);--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "expected_execution_policy_version" integer;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "expected_google_content_policy_version" integer;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "expected_emergency_kill_version" integer;--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "expected_actor_role" varchar(50);--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "expected_permission_digest" varchar(64);--> statement-breakpoint
UPDATE "gbp_import_request_items"
SET "destination_property_id" = CASE
  WHEN "action" = 'relink' THEN "existing_property_id"
  ELSE "id"
END
WHERE "destination_property_id" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "gbp_import_request_items_routing_idx";--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_routing_idx" ON "gbp_import_request_items" USING btree ("organization_id","id","status") WHERE "gbp_import_request_items"."status" IN ('pending', 'processing');--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_authorization_snapshot_valid" CHECK ((
        (
          "gbp_import_request_items"."approval_binding_id" IS NULL
          AND "gbp_import_request_items"."expected_execution_policy_version" IS NULL
          AND "gbp_import_request_items"."expected_google_content_policy_version" IS NULL
          AND "gbp_import_request_items"."expected_emergency_kill_version" IS NULL
          AND "gbp_import_request_items"."expected_actor_role" IS NULL
          AND "gbp_import_request_items"."expected_permission_digest" IS NULL
        )
        OR (
          char_length("gbp_import_request_items"."approval_binding_id") BETWEEN 1 AND 255
          AND "gbp_import_request_items"."expected_execution_policy_version" >= 0
          AND "gbp_import_request_items"."expected_google_content_policy_version" >= 0
          AND "gbp_import_request_items"."expected_emergency_kill_version" >= 0
          AND char_length("gbp_import_request_items"."expected_actor_role") BETWEEN 1 AND 50
          AND "gbp_import_request_items"."expected_permission_digest" ~ '^[a-f0-9]{64}$'
        )
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_profile_valid" CHECK ((
        char_length(btrim("gbp_import_request_items"."property_name")) BETWEEN 1 AND 100
        AND char_length("gbp_import_request_items"."timezone") BETWEEN 1 AND 64
        AND ("gbp_import_request_items"."country_code" IS NULL OR "gbp_import_request_items"."country_code" ~ '^[A-Z]{2}$')
        AND (
          ("gbp_import_request_items"."action" = 'create' AND "gbp_import_request_items"."existing_property_id" IS NULL AND "gbp_import_request_items"."destination_property_id" IS NOT NULL AND "gbp_import_request_items"."country_code" IS NOT NULL AND "gbp_import_request_items"."update_existing_profile" = true AND "gbp_import_request_items"."expected_source_epoch" IS NULL AND "gbp_import_request_items"."expected_profile_version" IS NULL)
          OR ("gbp_import_request_items"."action" = 'relink' AND "gbp_import_request_items"."existing_property_id" IS NOT NULL AND "gbp_import_request_items"."destination_property_id" = "gbp_import_request_items"."existing_property_id" AND "gbp_import_request_items"."expected_source_epoch" >= 0 AND "gbp_import_request_items"."expected_profile_version" >= 1)
        )
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_status_outcome_valid" CHECK ((
        ("gbp_import_request_items"."status" IN ('pending', 'processing') AND "gbp_import_request_items"."outcome_code" IS NULL)
        OR ("gbp_import_request_items"."status" = 'imported' AND "gbp_import_request_items"."outcome_code" = 'imported')
        OR ("gbp_import_request_items"."status" = 'relinked' AND "gbp_import_request_items"."outcome_code" = 'relinked')
        OR ("gbp_import_request_items"."status" = 'already_exists' AND "gbp_import_request_items"."outcome_code" = 'already_exists')
        OR ("gbp_import_request_items"."status" = 'region_unavailable' AND "gbp_import_request_items"."outcome_code" = 'region_unavailable')
        OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error'))
        OR ("gbp_import_request_items"."status" = 'cancelled' AND "gbp_import_request_items"."outcome_code" IN ('authorization_changed', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_routing_retention_valid" CHECK ((
        (
          "gbp_import_request_items"."status" IN ('pending', 'processing')
          AND "gbp_import_request_items"."connection_id" IS NOT NULL
          AND "gbp_import_request_items"."provider_account_suffix" IS NOT NULL
          AND "gbp_import_request_items"."provider_location_suffix" IS NOT NULL
        )
        OR (
          "gbp_import_request_items"."status" NOT IN ('pending', 'processing')
          AND (("gbp_import_request_items"."provider_account_suffix" IS NULL) = ("gbp_import_request_items"."provider_location_suffix" IS NULL))
        )
      ));