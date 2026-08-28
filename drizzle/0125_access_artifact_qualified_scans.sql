CREATE UNIQUE INDEX "portal_tokens_scope_id_key" ON "portal_tokens" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE TABLE "portal_access_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_token_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "portal_access_artifacts_channel_valid" CHECK ("portal_access_artifacts"."channel" IN ('qr', 'nfc')),
	CONSTRAINT "portal_access_artifacts_status_valid" CHECK ("portal_access_artifacts"."status" IN ('published', 'retired', 'revoked')),
	CONSTRAINT "portal_access_artifacts_retirement_valid" CHECK (("portal_access_artifacts"."status" = 'published' AND "portal_access_artifacts"."retired_at" IS NULL) OR ("portal_access_artifacts"."status" <> 'published' AND "portal_access_artifacts"."retired_at" IS NOT NULL AND "portal_access_artifacts"."retired_at" >= "portal_access_artifacts"."published_at"))
);
--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" ADD CONSTRAINT "portal_access_artifacts_token_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","portal_token_id") REFERENCES "public"."portal_tokens"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" ADD CONSTRAINT "portal_access_artifacts_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "portal_access_artifacts_portal_idx" ON "portal_access_artifacts" USING btree ("organization_id","property_id","portal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_artifacts_token_channel_key" ON "portal_access_artifacts" USING btree ("portal_token_id","channel") WHERE "status" = 'published';
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_artifacts_scope_id_key" ON "portal_access_artifacts" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE TABLE "guest_qualified_scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_group_id" uuid,
	"access_artifact_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"retracted_at" timestamp with time zone,
	CONSTRAINT "guest_qualified_scans_retraction_valid" CHECK ("guest_qualified_scans"."retracted_at" IS NULL OR "guest_qualified_scans"."retracted_at" >= "guest_qualified_scans"."occurred_at")
);
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_group_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_artifact_fk" FOREIGN KEY ("organization_id","property_id","portal_id","access_artifact_id") REFERENCES "public"."portal_access_artifacts"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_qualified_scans_source_event_key" ON "guest_qualified_scans" USING btree ("source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_qualified_scans_scope_id_key" ON "guest_qualified_scans" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE INDEX "guest_qualified_scans_scope_time_idx" ON "guest_qualified_scans" USING btree ("organization_id","property_id","portal_id","occurred_at");
--> statement-breakpoint
CREATE TABLE "guest_qualified_scan_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"qualified_scan_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_qualified_scan_receipts_window_valid" CHECK ("guest_qualified_scan_receipts"."expires_at" = "guest_qualified_scan_receipts"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "guest_qualified_scan_receipts" ADD CONSTRAINT "guest_qualified_scan_receipts_qualified_scan_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","qualified_scan_id") REFERENCES "public"."guest_qualified_scans"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scan_receipts" ADD CONSTRAINT "guest_qualified_scan_receipts_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_qualified_scan_receipts_anchor_key" ON "guest_qualified_scan_receipts" USING btree ("organization_id","portal_id","session_id");
--> statement-breakpoint
CREATE INDEX "guest_qualified_scan_receipts_lookup_idx" ON "guest_qualified_scan_receipts" USING btree ("organization_id","portal_id","session_id","expires_at");
--> statement-breakpoint
CREATE INDEX "guest_qualified_scan_receipts_expiry_idx" ON "guest_qualified_scan_receipts" USING btree ("expires_at");
