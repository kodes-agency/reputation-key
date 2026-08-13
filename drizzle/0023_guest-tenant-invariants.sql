CREATE UNIQUE INDEX "portals_org_property_id_key" ON "portals" USING btree ("organization_id", "property_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_responses_scope_id_key" ON "guest_responses" USING btree ("organization_id", "property_id", "portal_id", "id");
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_portal_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "guest_responses" VALIDATE CONSTRAINT "guest_responses_portal_property_tenant_fk";
--> statement-breakpoint
ALTER TABLE "guest_response_media" ADD CONSTRAINT "guest_response_media_response_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "guest_response_media" VALIDATE CONSTRAINT "guest_response_media_response_property_tenant_fk";
--> statement-breakpoint
ALTER TABLE "guest_response_media" ADD CONSTRAINT "guest_response_media_portal_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "guest_response_media" VALIDATE CONSTRAINT "guest_response_media_portal_property_tenant_fk";
