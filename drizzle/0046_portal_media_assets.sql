-- Portal media (round 4, slice 42a): the table of uploaded images and the
-- columns that point at them.
--
-- Purely additive. `portal_media_assets` holds one row per stored image: the
-- upload after it was decoded and re-encoded to WebP, with its size, the hash of
-- the stored bytes, the format the upload arrived in, and when its uploader
-- confirmed they hold the rights to it. A row says where its object lives
-- (`portal-media/<id>.webp`, derived from the id) and whether it may be served:
-- a taken-down asset keeps its row, because published snapshots name assets by
-- id, but is never served.
--
-- The Property Brand Profile gains a logo and a hero photograph (with the point
-- the page keeps in frame when it crops) and a link gains a tile image. Each
-- foreign key is tied to an asset of the same Organization and Property. No
-- existing row changes, and nothing reads the new columns yet.
CREATE TABLE "portal_media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"object_key" varchar(120) NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"source_format" varchar(8) NOT NULL,
	"source_bytes" integer NOT NULL,
	"rights_confirmed_at" timestamp with time zone NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_down_at" timestamp with time zone,
	CONSTRAINT "portal_media_assets_purpose_valid" CHECK ("portal_media_assets"."purpose" IN ('hero', 'logo', 'link_image')),
	CONSTRAINT "portal_media_assets_status_valid" CHECK ("portal_media_assets"."status" IN ('active', 'taken_down')),
	CONSTRAINT "portal_media_assets_takedown_consistent" CHECK (("portal_media_assets"."status" = 'taken_down') = ("portal_media_assets"."taken_down_at" IS NOT NULL)),
	CONSTRAINT "portal_media_assets_object_key_derived" CHECK ("portal_media_assets"."object_key" = 'portal-media/' || "portal_media_assets"."id"::text || '.webp'),
	CONSTRAINT "portal_media_assets_content_type_webp" CHECK ("portal_media_assets"."content_type" = 'image/webp'),
	CONSTRAINT "portal_media_assets_dimensions_valid" CHECK ("portal_media_assets"."width" BETWEEN 1 AND 16384 AND "portal_media_assets"."height" BETWEEN 1 AND 16384),
	CONSTRAINT "portal_media_assets_byte_size_positive" CHECK ("portal_media_assets"."byte_size" >= 1),
	CONSTRAINT "portal_media_assets_sha256_valid" CHECK ("portal_media_assets"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "portal_media_assets_source_format_valid" CHECK ("portal_media_assets"."source_format" IN ('jpeg', 'png', 'webp')),
	CONSTRAINT "portal_media_assets_source_bytes_positive" CHECK ("portal_media_assets"."source_bytes" >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX "portal_media_assets_org_id_key" ON "portal_media_assets" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_media_assets_org_property_id_key" ON "portal_media_assets" USING btree ("organization_id","property_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_media_assets_object_key_unique" ON "portal_media_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "portal_media_assets_property_idx" ON "portal_media_assets" USING btree ("organization_id","property_id");--> statement-breakpoint
ALTER TABLE "portal_media_assets" ADD CONSTRAINT "portal_media_assets_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "hero_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "hero_focal_x" real;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "hero_focal_y" real;--> statement-breakpoint
ALTER TABLE "portal_links" ADD COLUMN "image_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_logo_asset_fk" FOREIGN KEY ("organization_id","property_id","logo_asset_id") REFERENCES "public"."portal_media_assets"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_hero_asset_fk" FOREIGN KEY ("organization_id","property_id","hero_asset_id") REFERENCES "public"."portal_media_assets"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_image_asset_fk" FOREIGN KEY ("organization_id","property_id","image_asset_id") REFERENCES "public"."portal_media_assets"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_hero_focal_valid" CHECK (("property_portal_brand_profiles"."hero_asset_id" IS NULL AND "property_portal_brand_profiles"."hero_focal_x" IS NULL AND "property_portal_brand_profiles"."hero_focal_y" IS NULL) OR ("property_portal_brand_profiles"."hero_asset_id" IS NOT NULL AND "property_portal_brand_profiles"."hero_focal_x" IS NOT NULL AND "property_portal_brand_profiles"."hero_focal_x" BETWEEN 0 AND 1 AND "property_portal_brand_profiles"."hero_focal_y" IS NOT NULL AND "property_portal_brand_profiles"."hero_focal_y" BETWEEN 0 AND 1));
