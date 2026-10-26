-- A Portal's own look (ADR 0070): a Portal may have its own photo, its own
-- colours, or its own name and logo, each group on its own, and follows the
-- Property look for the rest.
--
-- Purely additive. `portal_look_overrides` holds at most one row per Portal, made
-- by the first save of one of its own groups; a Portal with no row follows the
-- whole Property look, so every existing Portal resolves to exactly the content,
-- digest and look version it has today and nothing is backfilled. Each group has
-- a mode ('inherit' or 'own'; the photo also 'none'), and a group that follows
-- the Property holds no values, so a photo or logo the Portal no longer shows is
-- not kept referenced. The own photo's descriptions per language sit beside it.
-- `look_version` is the Portal's effective look version, which only moves up.
-- The images are tied to assets of the same Organization and Property, and the
-- row to a Portal of that Property, by RESTRICT foreign keys, as the Brand
-- Profile's are.
--
-- No existing table, column or CHECK changes. The table is new and empty, so its
-- CHECKs validate nothing; adding its foreign keys takes a brief SHARE ROW
-- EXCLUSIVE lock on `portals` and `portal_media_assets` and scans no rows.
CREATE TABLE "portal_look_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"photo_mode" varchar(8) DEFAULT 'inherit' NOT NULL,
	"hero_asset_id" uuid,
	"hero_focal_x" double precision,
	"hero_focal_y" double precision,
	"hero_alt_texts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"colours_mode" varchar(8) DEFAULT 'inherit' NOT NULL,
	"primary_color" varchar(7),
	"background_mode" varchar(10),
	"background_color" varchar(7),
	"identity_mode" varchar(8) DEFAULT 'inherit' NOT NULL,
	"wordmark" varchar(24),
	"logo_asset_id" uuid,
	"look_version" integer NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_look_overrides_photo_mode_valid" CHECK ("portal_look_overrides"."photo_mode" IN ('inherit', 'own', 'none')),
	CONSTRAINT "portal_look_overrides_photo_valid" CHECK (("portal_look_overrides"."photo_mode" = 'own' AND "portal_look_overrides"."hero_asset_id" IS NOT NULL AND "portal_look_overrides"."hero_focal_x" IS NOT NULL AND "portal_look_overrides"."hero_focal_x" BETWEEN 0 AND 1 AND "portal_look_overrides"."hero_focal_y" IS NOT NULL AND "portal_look_overrides"."hero_focal_y" BETWEEN 0 AND 1) OR ("portal_look_overrides"."photo_mode" <> 'own' AND "portal_look_overrides"."hero_asset_id" IS NULL AND "portal_look_overrides"."hero_focal_x" IS NULL AND "portal_look_overrides"."hero_focal_y" IS NULL AND "portal_look_overrides"."hero_alt_texts" = '{}'::jsonb)),
	CONSTRAINT "portal_look_overrides_alt_object" CHECK (jsonb_typeof("portal_look_overrides"."hero_alt_texts") = 'object'),
	CONSTRAINT "portal_look_overrides_colours_mode_valid" CHECK ("portal_look_overrides"."colours_mode" IN ('inherit', 'own')),
	CONSTRAINT "portal_look_overrides_colours_valid" CHECK (("portal_look_overrides"."colours_mode" = 'own' AND "portal_look_overrides"."primary_color" IS NOT NULL AND "portal_look_overrides"."background_mode" IS NOT NULL AND "portal_look_overrides"."background_color" IS NOT NULL) OR ("portal_look_overrides"."colours_mode" = 'inherit' AND "portal_look_overrides"."primary_color" IS NULL AND "portal_look_overrides"."background_mode" IS NULL AND "portal_look_overrides"."background_color" IS NULL)),
	CONSTRAINT "portal_look_overrides_palette_valid" CHECK (("portal_look_overrides"."primary_color" IS NULL OR "portal_look_overrides"."primary_color" ~ '^#[0-9A-Fa-f]{6}$') AND ("portal_look_overrides"."background_color" IS NULL OR "portal_look_overrides"."background_color" ~ '^#[0-9A-Fa-f]{6}$')),
	CONSTRAINT "portal_look_overrides_background_mode_valid" CHECK ("portal_look_overrides"."background_mode" IS NULL OR "portal_look_overrides"."background_mode" IN ('auto', 'manual')),
	CONSTRAINT "portal_look_overrides_identity_mode_valid" CHECK ("portal_look_overrides"."identity_mode" IN ('inherit', 'own')),
	CONSTRAINT "portal_look_overrides_identity_valid" CHECK ("portal_look_overrides"."identity_mode" = 'own' OR ("portal_look_overrides"."wordmark" IS NULL AND "portal_look_overrides"."logo_asset_id" IS NULL)),
	CONSTRAINT "portal_look_overrides_wordmark_present" CHECK ("portal_look_overrides"."wordmark" IS NULL OR length(btrim("portal_look_overrides"."wordmark")) > 0),
	CONSTRAINT "portal_look_overrides_look_version_positive" CHECK ("portal_look_overrides"."look_version" >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX "portal_look_overrides_portal_unique" ON "portal_look_overrides" USING btree ("organization_id","portal_id");--> statement-breakpoint
CREATE INDEX "portal_look_overrides_property_idx" ON "portal_look_overrides" USING btree ("organization_id","property_id");--> statement-breakpoint
ALTER TABLE "portal_look_overrides" ADD CONSTRAINT "portal_look_overrides_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_look_overrides" ADD CONSTRAINT "portal_look_overrides_hero_asset_fk" FOREIGN KEY ("organization_id","property_id","hero_asset_id") REFERENCES "public"."portal_media_assets"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_look_overrides" ADD CONSTRAINT "portal_look_overrides_logo_asset_fk" FOREIGN KEY ("organization_id","property_id","logo_asset_id") REFERENCES "public"."portal_media_assets"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
