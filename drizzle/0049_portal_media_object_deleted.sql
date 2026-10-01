-- Portal media (round 4, slice 42b): record when a taken-down asset's stored
-- object was removed.
--
-- A takedown stops the image being served at once (the row's status) and then
-- removes the object. If the removal fails, the row says so by leaving
-- `object_deleted_at` empty, and the media sweep retries it until it is set. Only
-- a taken-down row can have one: an active asset's object is never deleted
-- without its row.
--
-- Additive: no existing row changes, and every existing row reads as "object not
-- yet removed", which is true of all of them (nothing was taken down before now).
ALTER TABLE "portal_media_assets" ADD COLUMN "object_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_media_assets" ADD CONSTRAINT "portal_media_assets_object_deleted_taken_down" CHECK ("portal_media_assets"."object_deleted_at" IS NULL OR "portal_media_assets"."status" = 'taken_down');
