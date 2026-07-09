CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"actor_avatar_url" text,
	"actor_role" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"organization_id" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" varchar(255),
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_log_resource_idx" ON "activity_log" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_org_property_idx" ON "activity_log" USING btree ("organization_id","property_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_event_id_idx" ON "activity_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_log_event_id_org_uniq" ON "activity_log" USING btree ("event_id","organization_id");