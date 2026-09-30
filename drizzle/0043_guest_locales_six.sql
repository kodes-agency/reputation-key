ALTER TABLE "portals" DROP CONSTRAINT "portals_primary_guest_locale_active";--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_primary_guest_locale_active" CHECK ("portals"."primary_guest_locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
ALTER TABLE "portals" DROP CONSTRAINT "portals_additional_guest_locales_array";--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_additional_guest_locales_array" CHECK (jsonb_typeof("portals"."additional_guest_locales") = 'array' AND "portals"."additional_guest_locales" <@ '["en", "es", "it", "fr", "de", "bg"]'::jsonb);--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" DROP CONSTRAINT "property_portal_brand_contents_locale_active";--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD CONSTRAINT "property_portal_brand_contents_locale_active" CHECK ("property_portal_brand_contents"."locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" DROP CONSTRAINT "portal_localized_overrides_locale_active";--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" ADD CONSTRAINT "portal_localized_overrides_locale_active" CHECK ("portal_localized_overrides"."locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_locale_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_locale_valid" CHECK ("portal_publication_snapshots"."guest_locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_locale_set_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_locale_set_valid" CHECK (jsonb_typeof("portal_publication_snapshots"."locale_set") = 'array' AND "portal_publication_snapshots"."locale_set" <@ '["en", "es", "it", "fr", "de", "bg"]'::jsonb AND "portal_publication_snapshots"."locale_set" @> jsonb_build_array("portal_publication_snapshots"."guest_locale"));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_language_pack_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ("portal_publication_snapshots"."language_pack_version" ~ '^guest-ui-(en|es|it|fr|de|bg)-v[1-9][0-9]{0,2}$');
