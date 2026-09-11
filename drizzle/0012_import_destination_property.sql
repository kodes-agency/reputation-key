-- Keep the destination Property on terminal `imported`/`relinked` import items.
--
-- Terminal writes scrub every provider identifier and authorization fence from
-- an import item; the Property the item produced was scrubbed with them, so
-- the import flow could not hand the merchant to the Property it had just
-- created (no "view property", no AI onboarding for it). The Property id is an
-- internal reference, not provider content: it now survives on `imported` and
-- `relinked` rows, and Property deletion clears it through the property-scoped
-- lifecycle sweep (no FK: a `create` item names its destination before the
-- Property exists).
--
-- Generated with `drizzle-kit generate` against the model; the
-- `settled_analysis_count` statements it also emitted were applied by
-- 0010_profile_scoped_coverage and are omitted.
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
          AND ("gbp_import_request_items"."status" IN ('imported', 'relinked') OR "gbp_import_request_items"."destination_property_id" IS NULL)
          AND "gbp_import_request_items"."expected_source_epoch" IS NULL
          AND "gbp_import_request_items"."expected_profile_version" IS NULL
        )
          )
      ));
