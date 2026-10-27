-- The saved wording of the final print kit, per Portal (final print kit, saved
-- wording), and a fifth wording, "How was your stay?".
--
-- Additive. `portal_print_wordings` holds one row per Portal: the call to action
-- a manager saved from Share ("Save wording") and the manager's own words, per
-- language, as a JSON object (null when the wording's copy is what Share opens
-- on). Share opens on it next time; a download saves its wording here too. A row
-- holds a wording id and words only: never the address, a print code, a file or
-- the person who saved it. The Portal's composite foreign key removes the row
-- with its Portal.
--
-- `portal_last_prints.call_to_action` takes the new id `how_was_stay`: its CHECK
-- is dropped and added again with the five ids. The table is one row per Portal
-- and written once per download, so the rewrite holds its lock for a moment. An
-- old server that is never offered the new id never writes it; the new table is
-- empty and unread until the new server runs.
CREATE TABLE "portal_print_wordings" (
	"portal_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"call_to_action" varchar(32) NOT NULL,
	"call_to_action_custom" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_print_wordings_call_to_action_valid" CHECK ("portal_print_wordings"."call_to_action" IN ('how_did_we_do', 'how_was_visit', 'how_was_stay', 'rate_visit', 'got_30_seconds')),
	CONSTRAINT "portal_print_wordings_call_to_action_custom_valid" CHECK ("portal_print_wordings"."call_to_action_custom" IS NULL OR jsonb_typeof("portal_print_wordings"."call_to_action_custom") = 'object')
);--> statement-breakpoint
ALTER TABLE "portal_print_wordings" ADD CONSTRAINT "portal_print_wordings_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_last_prints" DROP CONSTRAINT "portal_last_prints_call_to_action_valid";--> statement-breakpoint
ALTER TABLE "portal_last_prints" ADD CONSTRAINT "portal_last_prints_call_to_action_valid" CHECK ("portal_last_prints"."call_to_action" IN ('how_did_we_do', 'how_was_visit', 'how_was_stay', 'rate_visit', 'got_30_seconds'));
