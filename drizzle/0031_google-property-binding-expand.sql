ALTER TABLE "properties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "gbp_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "gbp_location_id" varchar(255);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "google_binding_state" varchar(40) DEFAULT 'unbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "profile_source" varchar(32) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "profile_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "profile_confirmed_by" varchar(255);--> statement-breakpoint
-- Legacy gbp_place_id values are location suffixes only when they satisfy the
-- canonical bounded bare-suffix grammar. Account identity is never guessed.
UPDATE "properties"
SET
  "gbp_location_id" = "gbp_place_id",
  "google_binding_state" = 'account_confirmation_required'
WHERE
  "gbp_place_id" IS NOT NULL
  AND char_length("gbp_place_id") BETWEEN 1 AND 255
  AND "gbp_place_id" !~ '[/?#[:space:][:cntrl:]]';--> statement-breakpoint
-- properties_org_gbp_location_id_unique is intentionally absent here.
-- scripts/google-property-binding-index.mjs owns its autocommit
-- CREATE UNIQUE INDEX CONCURRENTLY lifecycle.
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_binding_state_valid" CHECK ("properties"."google_binding_state" IN ('unbound', 'account_confirmation_required', 'active', 'disconnected'));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_binding_tuple_valid" CHECK ((
        ("properties"."google_binding_state" = 'unbound' AND "properties"."gbp_account_id" IS NULL AND "properties"."gbp_location_id" IS NULL)
        OR ("properties"."google_binding_state" = 'account_confirmation_required' AND "properties"."gbp_account_id" IS NULL AND "properties"."gbp_location_id" IS NOT NULL)
        OR ("properties"."google_binding_state" IN ('active', 'disconnected') AND "properties"."google_connection_id" IS NOT NULL AND "properties"."gbp_account_id" IS NOT NULL AND "properties"."gbp_location_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_binding_suffix_valid" CHECK ((
        ("properties"."gbp_account_id" IS NULL OR (char_length("properties"."gbp_account_id") >= 1 AND char_length("properties"."gbp_account_id") <= 255 AND "properties"."gbp_account_id" !~ '[/?#[:space:][:cntrl:]]'))
        AND ("properties"."gbp_location_id" IS NULL OR (char_length("properties"."gbp_location_id") >= 1 AND char_length("properties"."gbp_location_id") <= 255 AND "properties"."gbp_location_id" !~ '[/?#[:space:][:cntrl:]]'))
      ));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_profile_version_valid" CHECK ("properties"."profile_version" >= 1);--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_profile_confirmation_valid" CHECK ((
        ("properties"."profile_source" = 'legacy' AND "properties"."profile_confirmed_at" IS NULL AND "properties"."profile_confirmed_by" IS NULL)
        OR ("properties"."profile_source" = 'tenant_confirmed' AND "properties"."profile_confirmed_at" IS NOT NULL AND "properties"."profile_confirmed_by" IS NOT NULL)
      ));