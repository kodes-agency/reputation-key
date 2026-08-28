CREATE TABLE "portal_approved_destinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"normalized_uri" varchar(500) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"approval_state" varchar(20) NOT NULL,
	"validation_version" varchar(80) NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"approved_by" varchar(255),
	"approved_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" varchar(500),
	"last_validated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_approved_destinations_source_valid" CHECK ("portal_approved_destinations"."source_type" IN ('recognized', 'custom', 'provider')),
	CONSTRAINT "portal_approved_destinations_state_valid" CHECK ("portal_approved_destinations"."approval_state" IN ('pending', 'approved', 'disabled', 'quarantined')),
	CONSTRAINT "portal_approved_destinations_approval_valid" CHECK (("portal_approved_destinations"."approval_state" = 'approved' AND "portal_approved_destinations"."approved_by" IS NOT NULL AND "portal_approved_destinations"."approved_at" IS NOT NULL AND "portal_approved_destinations"."disabled_at" IS NULL) OR ("portal_approved_destinations"."approval_state" <> 'approved'))
);
--> statement-breakpoint
CREATE TABLE "portal_health_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"reason" varchar(80) NOT NULL,
	"source_version" varchar(160) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_health_intervals_status_valid" CHECK ("portal_health_intervals"."status" IN ('healthy', 'degraded', 'unavailable')),
	CONSTRAINT "portal_health_intervals_interval_valid" CHECK ("portal_health_intervals"."effective_to" IS NULL OR "portal_health_intervals"."effective_to" > "portal_health_intervals"."effective_from"),
	CONSTRAINT "portal_health_intervals_observation_valid" CHECK ("portal_health_intervals"."observed_at" >= "portal_health_intervals"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "portal_localized_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"locale" varchar(35) NOT NULL,
	"title" varchar(120),
	"short_description" varchar(500),
	"hero_image_url" varchar(500),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_localized_overrides_locale_active" CHECK ("portal_localized_overrides"."locale" IN ('en', 'bg')),
	CONSTRAINT "portal_localized_overrides_version_positive" CHECK ("portal_localized_overrides"."version" >= 1),
	CONSTRAINT "portal_localized_overrides_has_value" CHECK ("portal_localized_overrides"."title" IS NOT NULL OR "portal_localized_overrides"."short_description" IS NOT NULL OR "portal_localized_overrides"."hero_image_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "property_portal_brand_contents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"locale" varchar(35) NOT NULL,
	"title" varchar(120) NOT NULL,
	"short_description" varchar(500) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_portal_brand_contents_locale_active" CHECK ("property_portal_brand_contents"."locale" IN ('en', 'bg')),
	CONSTRAINT "property_portal_brand_contents_version_positive" CHECK ("property_portal_brand_contents"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "property_portal_brand_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"logo_url" varchar(500),
	"default_hero_image_url" varchar(500),
	"primary_color" varchar(7) NOT NULL,
	"background_color" varchar(7) NOT NULL,
	"text_color" varchar(7) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_portal_brand_profiles_palette_valid" CHECK ("property_portal_brand_profiles"."primary_color" ~ '^#[0-9A-Fa-f]{6}$' AND "property_portal_brand_profiles"."background_color" ~ '^#[0-9A-Fa-f]{6}$' AND "property_portal_brand_profiles"."text_color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "property_portal_brand_profiles_version_positive" CHECK ("property_portal_brand_profiles"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" DROP CONSTRAINT "portal_access_artifacts_status_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_locale_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_language_pack_valid";--> statement-breakpoint
ALTER TABLE "portal_links" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_links" ADD COLUMN "property_id" uuid;--> statement-breakpoint
ALTER TABLE "portal_links" ADD COLUMN "destination_id" uuid;--> statement-breakpoint
ALTER TABLE "portal_links" ADD COLUMN "legacy_destination_state" varchar(20) DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "locale_set" jsonb DEFAULT '["en"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "language_pack_versions" jsonb DEFAULT '{"en":"guest-ui-en-v1"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "localized_content" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "brand_profile_version" integer;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD COLUMN "encrypted_raw_token" text;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD COLUMN "address_encryption_key_version" integer;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "primary_guest_locale" varchar(35) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "additional_guest_locales" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "portal_links" AS "link"
SET "property_id" = "portal"."property_id",
    "legacy_destination_state" = 'quarantined'
FROM "portals" AS "portal"
WHERE "portal"."organization_id" = "link"."organization_id"
  AND "portal"."id" = "link"."portal_id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "portal_links" WHERE "property_id" IS NULL) THEN
    RAISE EXCEPTION 'portal link property backfill is incomplete';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "portal_links" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_approved_destinations" ADD CONSTRAINT "portal_approved_destinations_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_health_intervals" ADD CONSTRAINT "portal_health_intervals_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" ADD CONSTRAINT "portal_localized_overrides_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD CONSTRAINT "property_portal_brand_contents_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_approved_destinations_uri_unique" ON "portal_approved_destinations" USING btree ("organization_id","property_id","normalized_uri");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_approved_destinations_scope_id_key" ON "portal_approved_destinations" USING btree ("organization_id","property_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_health_intervals_one_current" ON "portal_health_intervals" USING btree ("organization_id","portal_id") WHERE "portal_health_intervals"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX "portal_health_intervals_history_idx" ON "portal_health_intervals" USING btree ("organization_id","property_id","portal_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_localized_overrides_locale_unique" ON "portal_localized_overrides" USING btree ("organization_id","portal_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_contents_locale_unique" ON "property_portal_brand_contents" USING btree ("organization_id","property_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_profiles_property_unique" ON "property_portal_brand_profiles" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_profiles_scope_id_key" ON "property_portal_brand_profiles" USING btree ("organization_id","property_id","id");--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_destination_tenant_fk" FOREIGN KEY ("organization_id","property_id","destination_id") REFERENCES "public"."portal_approved_destinations"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_property_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" ADD CONSTRAINT "portal_access_artifacts_status_valid" CHECK ("portal_access_artifacts"."status" IN ('published', 'retiring', 'retired', 'revoked'));--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_destination_authority_valid" CHECK (("portal_links"."destination_id" IS NOT NULL AND "portal_links"."url" IS NULL AND "portal_links"."legacy_destination_state" = 'migrated') OR ("portal_links"."destination_id" IS NULL AND "portal_links"."url" IS NOT NULL AND "portal_links"."legacy_destination_state" IN ('unclassified', 'quarantined')));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_locale_set_valid" CHECK (jsonb_typeof("portal_publication_snapshots"."locale_set") = 'array' AND "portal_publication_snapshots"."locale_set" <@ '["en", "bg"]'::jsonb AND "portal_publication_snapshots"."locale_set" @> jsonb_build_array("portal_publication_snapshots"."guest_locale"));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_language_packs_object" CHECK (jsonb_typeof("portal_publication_snapshots"."language_pack_versions") = 'object');--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_localized_content_object" CHECK (jsonb_typeof("portal_publication_snapshots"."localized_content") = 'object');--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_brand_version_positive" CHECK ("portal_publication_snapshots"."brand_profile_version" IS NULL OR "portal_publication_snapshots"."brand_profile_version" >= 1);--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_locale_valid" CHECK ("portal_publication_snapshots"."guest_locale" IN ('en', 'bg'));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ("portal_publication_snapshots"."language_pack_version" IN ('guest-ui-en-v1', 'guest-ui-bg-v1'));--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_encrypted_address_pair_valid" CHECK (("portal_tokens"."encrypted_raw_token" IS NULL) = ("portal_tokens"."address_encryption_key_version" IS NULL));--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_primary_guest_locale_active" CHECK ("portals"."primary_guest_locale" IN ('en', 'bg'));--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_additional_guest_locales_array" CHECK (jsonb_typeof("portals"."additional_guest_locales") = 'array' AND "portals"."additional_guest_locales" <@ '["en", "bg"]'::jsonb);
