CREATE TABLE "guest_network_pressure_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"pseudonym" varchar(64) NOT NULL,
	"action" varchar(24) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_network_pressure_pseudonym_valid" CHECK ("guest_network_pressure_records"."pseudonym" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "guest_network_pressure_action_valid" CHECK ("guest_network_pressure_records"."action" IN ('rating', 'private_feedback', 'destination_action', 'qualified_scan')),
	CONSTRAINT "guest_network_pressure_retention_valid" CHECK ("guest_network_pressure_records"."expires_at" = "guest_network_pressure_records"."observed_at" + interval '7 days')
);
--> statement-breakpoint
ALTER TABLE "guest_network_pressure_records" ADD CONSTRAINT "guest_network_pressure_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_network_pressure_lookup_idx" ON "guest_network_pressure_records" USING btree ("organization_id","property_id","portal_id","pseudonym","action","observed_at");--> statement-breakpoint
CREATE INDEX "guest_network_pressure_expiry_idx" ON "guest_network_pressure_records" USING btree ("expires_at");--> statement-breakpoint

-- V1 hashes were derived without Portal or action-class separation. Importing
-- them would make the new table a cross-Portal/cross-action correlation store,
-- so the cutover deliberately clears rather than backfills them. Signed-session
-- correctness and Redis pressure remain in force while the v2 authority fills.
UPDATE scan_events SET ip_hash = NULL WHERE ip_hash IS NOT NULL;--> statement-breakpoint
UPDATE ratings SET ip_hash = NULL WHERE ip_hash IS NOT NULL;--> statement-breakpoint
UPDATE feedback SET ip_hash = NULL WHERE ip_hash IS NOT NULL;
