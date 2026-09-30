-- Property look model and default guest languages (round 4, slice 11).
--
-- Purely additive. On the Property Brand Profile: a short wordmark, whether the
-- page's dark field follows the accent colour or is chosen by hand, the
-- languages a new Portal starts with, and `look_version`, which moves when the
-- look changes. `version` keeps moving only when the public display name does,
-- because AI reply drafts fence on it (look edits must not invalidate a draft
-- in flight). On the per-language Brand Content: the alt text of the hero
-- photo.
--
-- The default languages are an ordered, non-empty subset of the six. They are
-- backfilled from the union of the languages the Property's live Portals
-- already offer, the language of its earliest Portal first, then the rest in
-- catalogue order. A Property with no Portal keeps the English default.
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "wordmark" varchar(24);--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "background_mode" varchar(10) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "default_guest_locales" jsonb DEFAULT '["en"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "look_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD COLUMN "hero_alt_text" varchar(160);--> statement-breakpoint
UPDATE "property_portal_brand_profiles" AS p
SET "default_guest_locales" = d."locales"
FROM (
  SELECT u."organization_id", u."property_id",
         jsonb_agg(u."locale" ORDER BY (u."locale" = u."lead") DESC, array_position(ARRAY['en', 'es', 'it', 'fr', 'de', 'bg'], u."locale")) AS "locales"
  FROM (
    SELECT DISTINCT po."organization_id", po."property_id", l."locale"::text AS "locale",
           (SELECT earliest."primary_guest_locale" FROM "portals" earliest
             WHERE earliest."organization_id" = po."organization_id" AND earliest."property_id" = po."property_id" AND earliest."deleted_at" IS NULL
             ORDER BY earliest."created_at", earliest."id" LIMIT 1) AS "lead"
    FROM "portals" po
    CROSS JOIN LATERAL (
      SELECT po."primary_guest_locale" AS "locale"
      UNION
      SELECT jsonb_array_elements_text(po."additional_guest_locales")
    ) l
    WHERE po."deleted_at" IS NULL
  ) u
  WHERE u."locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg')
  GROUP BY u."organization_id", u."property_id"
) d
WHERE p."organization_id" = d."organization_id" AND p."property_id" = d."property_id";--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_wordmark_present" CHECK ("property_portal_brand_profiles"."wordmark" IS NULL OR length(btrim("property_portal_brand_profiles"."wordmark")) > 0);--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_background_mode_valid" CHECK ("property_portal_brand_profiles"."background_mode" IN ('auto', 'manual'));--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_default_locales_valid" CHECK (jsonb_typeof("property_portal_brand_profiles"."default_guest_locales") = 'array' AND jsonb_array_length("property_portal_brand_profiles"."default_guest_locales") BETWEEN 1 AND 6 AND "property_portal_brand_profiles"."default_guest_locales" <@ '["en", "es", "it", "fr", "de", "bg"]'::jsonb);--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_look_version_positive" CHECK ("property_portal_brand_profiles"."look_version" >= 1);--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD CONSTRAINT "property_portal_brand_contents_hero_alt_present" CHECK ("property_portal_brand_contents"."hero_alt_text" IS NULL OR length(btrim("property_portal_brand_contents"."hero_alt_text")) > 0);
