-- Linktree working model (round 4, slice 10): the per-language text of a link,
-- the section's own title and on/off switch, and a closed set of tile icons.
--
-- Additive except for one cosmetic clean-up: a tile icon outside the closed set
-- is cleared before the CHECK is added. No screen has ever offered an icon
-- picker, so this only touches values written through the API or by hand, and
-- a cleared icon draws as the plain link tile.
--
-- A link's own `label` stays and keeps mirroring the primary language; readers
-- fall back to it for a link that has no primary-language text row (a link
-- created by code that predates this migration, before its deploy).
ALTER TABLE "portals" ADD COLUMN "linktree_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" ADD COLUMN "linktree_title" varchar(60);--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" DROP CONSTRAINT "portal_localized_overrides_has_value";--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" ADD CONSTRAINT "portal_localized_overrides_has_value" CHECK ("portal_localized_overrides"."title" IS NOT NULL OR "portal_localized_overrides"."short_description" IS NOT NULL OR "portal_localized_overrides"."hero_image_url" IS NOT NULL OR "portal_localized_overrides"."linktree_title" IS NOT NULL);--> statement-breakpoint
CREATE TABLE "portal_link_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"locale" varchar(35) NOT NULL,
	"label" varchar(100) NOT NULL,
	"line" varchar(160),
	"provenance" varchar(20),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_link_texts_locale_active" CHECK ("portal_link_texts"."locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg')),
	CONSTRAINT "portal_link_texts_label_present" CHECK (length(btrim("portal_link_texts"."label")) > 0),
	CONSTRAINT "portal_link_texts_line_present" CHECK ("portal_link_texts"."line" IS NULL OR length(btrim("portal_link_texts"."line")) > 0),
	CONSTRAINT "portal_link_texts_provenance_valid" CHECK ("portal_link_texts"."provenance" IS NULL OR "portal_link_texts"."provenance" = 'ai_draft'),
	CONSTRAINT "portal_link_texts_version_positive" CHECK ("portal_link_texts"."version" >= 1)
);--> statement-breakpoint
ALTER TABLE "portal_link_texts" ADD CONSTRAINT "portal_link_texts_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link_texts" ADD CONSTRAINT "portal_link_texts_link_tenant_fk" FOREIGN KEY ("organization_id","portal_id","link_id") REFERENCES "public"."portal_links"("organization_id","portal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_link_texts_link_locale_unique" ON "portal_link_texts" USING btree ("organization_id","link_id","locale");--> statement-breakpoint
CREATE INDEX "portal_link_texts_portal_idx" ON "portal_link_texts" USING btree ("organization_id","portal_id");--> statement-breakpoint
INSERT INTO "portal_link_texts" ("organization_id", "property_id", "portal_id", "link_id", "locale", "label", "updated_by", "created_at", "updated_at")
SELECT l."organization_id", l."property_id", l."portal_id", l."id", p."primary_guest_locale", btrim(l."label"), 'system:migration-0044', l."created_at", l."updated_at"
FROM "portal_links" l
JOIN "portals" p ON p."organization_id" = l."organization_id" AND p."id" = l."portal_id"
WHERE length(btrim(l."label")) > 0
ON CONFLICT ("organization_id", "link_id", "locale") DO NOTHING;--> statement-breakpoint
UPDATE "portal_links" SET "icon_key" = NULL WHERE "icon_key" IS NOT NULL AND "icon_key" NOT IN ('link', 'external-link', 'globe', 'utensils', 'coffee', 'wine', 'bed-double', 'map-pin', 'phone', 'mail', 'calendar', 'clock', 'star', 'gift', 'shopping-bag', 'music', 'ticket', 'wifi', 'car', 'info', 'heart', 'scissors', 'sparkles', 'camera', 'book-open', 'waves', 'concierge-bell');--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_icon_key_valid" CHECK ("portal_links"."icon_key" IS NULL OR "portal_links"."icon_key" IN ('link', 'external-link', 'globe', 'utensils', 'coffee', 'wine', 'bed-double', 'map-pin', 'phone', 'mail', 'calendar', 'clock', 'star', 'gift', 'shopping-bag', 'music', 'ticket', 'wifi', 'car', 'info', 'heart', 'scissors', 'sparkles', 'camera', 'book-open', 'waves', 'concierge-bell'));
