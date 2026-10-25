-- The last final print remembers its call to action as Share now offers it (final
-- print kit, call to action slices C3 and C8).
--
-- `call_to_action` held the first final kit's two ids, `rate` and `tell`. Share now
-- offers four wordings, so the column widens to varchar(32) and its CHECK to the
-- four ids, and the stored rows move to the wording they printed: `rate` printed
-- "How did we do?" (`how_did_we_do`) and `tell` "How was your visit?"
-- (`how_was_visit`). The new `call_to_action_custom` keeps the manager's own words,
-- per language of the print, as a JSON object; null when the print said the
-- wording. The id stays beside them: it records where the words started.
--
-- `portal_last_prints` is one row per Portal, written once per download, so the
-- rewrite and the CHECKs hold its lock for a moment only. An old server that
-- writes `rate` or `tell` while the new one deploys is refused by the CHECK; it
-- logs that and still hands over the file, and the next print writes the row.
ALTER TABLE "portal_last_prints" DROP CONSTRAINT "portal_last_prints_call_to_action_valid";--> statement-breakpoint
ALTER TABLE "portal_last_prints" ALTER COLUMN "call_to_action" SET DATA TYPE varchar(32);--> statement-breakpoint
UPDATE "portal_last_prints" SET "call_to_action" = CASE "call_to_action" WHEN 'rate' THEN 'how_did_we_do' WHEN 'tell' THEN 'how_was_visit' ELSE "call_to_action" END WHERE "call_to_action" IN ('rate', 'tell');--> statement-breakpoint
ALTER TABLE "portal_last_prints" ADD CONSTRAINT "portal_last_prints_call_to_action_valid" CHECK ("portal_last_prints"."call_to_action" IN ('how_did_we_do', 'how_was_visit', 'rate_visit', 'got_30_seconds'));--> statement-breakpoint
ALTER TABLE "portal_last_prints" ADD COLUMN "call_to_action_custom" jsonb;--> statement-breakpoint
ALTER TABLE "portal_last_prints" ADD CONSTRAINT "portal_last_prints_call_to_action_custom_valid" CHECK ("portal_last_prints"."call_to_action_custom" IS NULL OR jsonb_typeof("portal_last_prints"."call_to_action_custom") = 'object');
