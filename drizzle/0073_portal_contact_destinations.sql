-- A Linktree tile may open a phone number or an email address besides a website
-- (owner decision 2026-10-26). Each is a Property destination like a website, so
-- a tile keeps one authority for where it goes, with the new source type
-- `contact`: its `normalized_uri` is `tel:+15551234567` or
-- `mailto:front@hotel.com`, its `hostname` the number or address without the
-- scheme. A contact is approved as it is entered (it needs no account admin), is
-- never checked over the network, and is left out of "Sites allowed for links".
--
-- Only the CHECK on `source_type` widens; no row is rewritten. Re-adding it scans
-- `portal_approved_destinations`, which holds a few rows per Property, so its
-- lock is held for a moment only. An older server never writes `contact`.
ALTER TABLE "portal_approved_destinations" DROP CONSTRAINT "portal_approved_destinations_source_valid";--> statement-breakpoint
ALTER TABLE "portal_approved_destinations" ADD CONSTRAINT "portal_approved_destinations_source_valid" CHECK ("portal_approved_destinations"."source_type" IN ('recognized', 'custom', 'provider', 'contact'));
