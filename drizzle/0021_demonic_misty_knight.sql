CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"token_identifier" varchar(24) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"version" integer NOT NULL,
	"print_batch" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"grace_period_ends" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(255),
	"revoked_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_tokens_status_valid" CHECK ("portal_tokens"."status" IN ('active', 'rotating', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "portals" ALTER COLUMN "property_id" SET DATA TYPE uuid USING "property_id"::uuid;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "publication_state" varchar(20) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE "portals" SET "publication_state" = CASE WHEN "is_active" THEN 'published' ELSE 'disabled' END;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_link_categories_org_portal_id_key" ON "portal_link_categories" USING btree ("organization_id","portal_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_links_org_portal_id_key" ON "portal_links" USING btree ("organization_id","portal_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portals_org_id_key" ON "portals" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_identifier_unique" ON "portal_tokens" USING btree ("token_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_hash_unique" ON "portal_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_portal_version_unique" ON "portal_tokens" USING btree ("organization_id","portal_id","version");--> statement-breakpoint
CREATE INDEX "portal_tokens_active_lookup_idx" ON "portal_tokens" USING btree ("token_identifier","status","grace_period_ends");--> statement-breakpoint
ALTER TABLE "portal_link_categories" ADD CONSTRAINT "portal_link_categories_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_category_tenant_fk" FOREIGN KEY ("organization_id","portal_id","category_id") REFERENCES "public"."portal_link_categories"("organization_id","portal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portals" DROP COLUMN "smart_routing_enabled";--> statement-breakpoint
ALTER TABLE "portals" DROP COLUMN "smart_routing_threshold";--> statement-breakpoint
ALTER TABLE "portals" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_publication_state_valid" CHECK ("portals"."publication_state" IN ('draft', 'published', 'disabled', 'archived'));