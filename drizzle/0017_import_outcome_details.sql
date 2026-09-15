-- Name the rejected profile field and keep the existing Property on import items.
--
-- 1. `tenant_profile_invalid`. A confirmed Property profile that the Property
--    context rejected (name, timezone or country) ended as `internal_error`,
--    shown as "Import could not be completed" with no way back to the field.
--    The new outcome is a terminal, non-retryable failure, and the new
--    `invalid_profile_field` column names the field as a content-free enum. It
--    is set exactly when the outcome is `tenant_profile_invalid`.
-- 2. `already_exists` items may keep `destination_property_id`. The processor
--    now records the Property that already holds the location, looked up inside
--    the same Organization, so the progress view can link to it. Property
--    deletion clears it through the same property-scoped lifecycle sweep that
--    clears `imported` and `relinked` references.
--
-- The new enum label is compared as text in every CHECK below: a label added in
-- this transaction cannot be used as an enum literal until the transaction
-- commits, and the migrator applies pending migrations in one transaction.
-- Hand-written; the matching model is src/shared/db/schema/google-import-v2.schema.ts.
ALTER TYPE "public"."google_import_v2_outcome" ADD VALUE 'tenant_profile_invalid';--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "invalid_profile_field" varchar(16);--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_profile_valid";--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_profile_valid" CHECK ((
        char_length(btrim("gbp_import_request_items"."property_name")) BETWEEN 1 AND 100
        AND char_length("gbp_import_request_items"."timezone") BETWEEN 1 AND 64
        AND ("gbp_import_request_items"."country_code" IS NULL OR "gbp_import_request_items"."country_code" ~ '^[A-Z]{2}$')
        AND (
          (
          ("gbp_import_request_items"."action" = 'create' AND "gbp_import_request_items"."existing_property_id" IS NULL AND "gbp_import_request_items"."destination_property_id" IS NOT NULL AND "gbp_import_request_items"."country_code" IS NOT NULL AND "gbp_import_request_items"."update_existing_profile" = true AND "gbp_import_request_items"."expected_source_epoch" IS NULL AND "gbp_import_request_items"."expected_profile_version" IS NULL)
          OR ("gbp_import_request_items"."action" = 'relink' AND "gbp_import_request_items"."existing_property_id" IS NOT NULL AND "gbp_import_request_items"."destination_property_id" = "gbp_import_request_items"."existing_property_id" AND "gbp_import_request_items"."expected_source_epoch" >= 0 AND "gbp_import_request_items"."expected_profile_version" >= 1)
        )
        OR (
          "gbp_import_request_items"."status" NOT IN ('pending', 'processing')
          AND "gbp_import_request_items"."outcome_code" <> 'temporarily_unavailable'
          AND "gbp_import_request_items"."existing_property_id" IS NULL
          AND ("gbp_import_request_items"."status" IN ('imported', 'relinked', 'already_exists') OR "gbp_import_request_items"."destination_property_id" IS NULL)
          AND "gbp_import_request_items"."expected_source_epoch" IS NULL
          AND "gbp_import_request_items"."expected_profile_version" IS NULL
        )
          )
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_status_outcome_valid";--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_status_outcome_valid" CHECK ((
        ("gbp_import_request_items"."status" IN ('pending', 'processing') AND "gbp_import_request_items"."outcome_code" IS NULL)
        OR ("gbp_import_request_items"."status" = 'imported' AND "gbp_import_request_items"."outcome_code" = 'imported')
        OR ("gbp_import_request_items"."status" = 'relinked' AND "gbp_import_request_items"."outcome_code" = 'relinked')
        OR ("gbp_import_request_items"."status" = 'already_exists' AND "gbp_import_request_items"."outcome_code" = 'already_exists')
        OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code"::text IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error', 'tenant_profile_invalid'))
        OR ("gbp_import_request_items"."status" = 'cancelled' AND "gbp_import_request_items"."outcome_code"::text IN ('authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_invalid_profile_field_valid" CHECK ((
        ("gbp_import_request_items"."invalid_profile_field" IS NULL AND ("gbp_import_request_items"."outcome_code" IS NULL OR "gbp_import_request_items"."outcome_code"::text <> 'tenant_profile_invalid'))
        OR ("gbp_import_request_items"."outcome_code"::text = 'tenant_profile_invalid' AND "gbp_import_request_items"."invalid_profile_field" IN ('name', 'timezone', 'country'))
      ));
