CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_property_id_key" ON "teams" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_groups_org_property_id_key" ON "portal_groups" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_org_property_id_key" ON "staff_participations" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE TABLE "team_portal_group_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"portal_group_id" uuid NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" text,
	CONSTRAINT "tpgs_interval_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
--> statement-breakpoint
CREATE INDEX "tpgs_org_team_idx" ON "team_portal_group_scopes" USING btree ("organization_id","property_id","team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tpgs_unique_active" ON "team_portal_group_scopes" USING btree ("organization_id","property_id","team_id","portal_group_id") WHERE "effective_to" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tm_unique_active_participation" ON "team_memberships" USING btree ("organization_id","property_id","staff_participation_id") WHERE "effective_to" IS NULL;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "pr_interval_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_lifecycle_consistent" CHECK (("status" = 'active' AND "ended_at" IS NULL) OR ("status" <> 'active' AND "ended_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "tm_interval_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
--> statement-breakpoint
ALTER TABLE "property_access_grants" ADD CONSTRAINT "pag_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "pr_participation_tenant_fk" FOREIGN KEY ("organization_id","property_id","staff_participation_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "tm_team_tenant_fk" FOREIGN KEY ("organization_id","property_id","team_id") REFERENCES "public"."teams"("organization_id","property_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "tm_participation_tenant_fk" FOREIGN KEY ("organization_id","property_id","staff_participation_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "portal_groups" ADD CONSTRAINT "portal_groups_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "team_portal_group_scopes" ADD CONSTRAINT "tpgs_team_tenant_fk" FOREIGN KEY ("organization_id","property_id","team_id") REFERENCES "public"."teams"("organization_id","property_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "team_portal_group_scopes" ADD CONSTRAINT "tpgs_portal_group_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "tm_no_overlapping_participation_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "staff_participation_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "pr_no_overlapping_responsibility_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "portal_id" WITH =,
    "staff_participation_id" WITH =,
    "kind" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );
--> statement-breakpoint
ALTER TABLE "team_portal_group_scopes" ADD CONSTRAINT "tpgs_no_overlapping_scope_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "team_id" WITH =,
    "portal_group_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );
--> statement-breakpoint
ALTER TABLE "portal_group_memberships" ADD CONSTRAINT "pgm_no_overlapping_portal_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "portal_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );