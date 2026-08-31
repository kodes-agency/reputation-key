CREATE TABLE "portal_publication_activations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"activation_sequence" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"activated_by" varchar(255) NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivation_reason" varchar(20),
	CONSTRAINT "portal_publication_activations_sequence_positive" CHECK ("portal_publication_activations"."activation_sequence" >= 1),
	CONSTRAINT "portal_publication_activations_kind_valid" CHECK ("portal_publication_activations"."kind" IN ('publish', 'rollback')),
	CONSTRAINT "portal_publication_activations_interval_valid" CHECK ("portal_publication_activations"."deactivated_at" IS NULL OR "portal_publication_activations"."deactivated_at" >= "portal_publication_activations"."activated_at"),
	CONSTRAINT "portal_publication_activations_deactivation_valid" CHECK (("portal_publication_activations"."deactivated_at" IS NULL AND "portal_publication_activations"."deactivation_reason" IS NULL) OR ("portal_publication_activations"."deactivated_at" IS NOT NULL AND "portal_publication_activations"."deactivation_reason" IN ('disabled', 'archived', 'replaced')))
);
--> statement-breakpoint
CREATE TABLE "portal_publication_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"configuration_digest" varchar(64) NOT NULL,
	"configuration" jsonb NOT NULL,
	"guest_locale" varchar(35) NOT NULL,
	"language_pack_version" varchar(100) NOT NULL,
	"private_feedback_threshold" integer NOT NULL,
	"destination_uri" varchar(500) NOT NULL,
	"destination_retrieved_at" timestamp with time zone NOT NULL,
	"destination_source_epoch" integer NOT NULL,
	"destination_profile_version" integer NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_publication_snapshots_version_positive" CHECK ("portal_publication_snapshots"."version" >= 1),
	CONSTRAINT "portal_publication_snapshots_digest_valid" CHECK ("portal_publication_snapshots"."configuration_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "portal_publication_snapshots_configuration_object" CHECK (jsonb_typeof("portal_publication_snapshots"."configuration") = 'object'),
	CONSTRAINT "portal_publication_snapshots_locale_valid" CHECK ("portal_publication_snapshots"."guest_locale" = 'en'),
	CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ("portal_publication_snapshots"."language_pack_version" = 'guest-ui-en-v1'),
	CONSTRAINT "portal_publication_snapshots_threshold_valid" CHECK ("portal_publication_snapshots"."private_feedback_threshold" BETWEEN 1 AND 5),
	CONSTRAINT "portal_publication_snapshots_destination_binding_valid" CHECK ("portal_publication_snapshots"."destination_uri" LIKE 'https://%' AND "portal_publication_snapshots"."destination_source_epoch" >= 0 AND "portal_publication_snapshots"."destination_profile_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD COLUMN "publication_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD COLUMN "publication_version" integer;--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD COLUMN "publication_digest" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_tenant_scope_id_key" ON "portal_publication_snapshots" USING btree ("organization_id","property_id","portal_id","id");--> statement-breakpoint
ALTER TABLE "portal_publication_activations" ADD CONSTRAINT "portal_publication_activations_snapshot_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id","snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_activations_portal_sequence_unique" ON "portal_publication_activations" USING btree ("organization_id","portal_id","activation_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_activations_one_current_per_portal" ON "portal_publication_activations" USING btree ("organization_id","portal_id") WHERE "portal_publication_activations"."deactivated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "portal_publication_activations_snapshot_idx" ON "portal_publication_activations" USING btree ("organization_id","portal_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_portal_version_unique" ON "portal_publication_snapshots" USING btree ("organization_id","portal_id","version");--> statement-breakpoint
CREATE INDEX "portal_publication_snapshots_portal_created_idx" ON "portal_publication_snapshots" USING btree ("organization_id","portal_id","created_at");--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD CONSTRAINT "guest_response_experience_snapshots_publication_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","publication_snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD CONSTRAINT "guest_response_experience_snapshots_publication_reference_valid" CHECK (("guest_response_experience_snapshots"."publication_snapshot_id" IS NULL AND "guest_response_experience_snapshots"."publication_version" IS NULL AND "guest_response_experience_snapshots"."publication_digest" IS NULL) OR ("guest_response_experience_snapshots"."publication_snapshot_id" IS NOT NULL AND "guest_response_experience_snapshots"."publication_version" >= 1 AND "guest_response_experience_snapshots"."publication_digest" ~ '^[0-9a-f]{64}$'));
