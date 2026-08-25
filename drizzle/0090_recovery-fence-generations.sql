CREATE TABLE "recovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_cell_id" varchar(16) NOT NULL,
	"generation" integer NOT NULL,
	"source_release_sha" varchar(40) NOT NULL,
	"source_manifest_sha256" varchar(64) NOT NULL,
	"restore_point_at" timestamp with time zone NOT NULL,
	"operator_id" varchar(255) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"counts" jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_runs_cell_valid" CHECK ("recovery_runs"."data_cell_id" IN ('us', 'europe', 'global')),
	CONSTRAINT "recovery_runs_generation_valid" CHECK ("recovery_runs"."generation" >= 1),
	CONSTRAINT "recovery_runs_source_release_valid" CHECK ("recovery_runs"."source_release_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "recovery_runs_source_manifest_valid" CHECK ("recovery_runs"."source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "recovery_runs_time_valid" CHECK ("recovery_runs"."restore_point_at" <= "recovery_runs"."completed_at" AND "recovery_runs"."completed_at" >= "recovery_runs"."created_at")
);
--> statement-breakpoint
DROP INDEX "outbox_events_unpublished_idx";--> statement-breakpoint
DROP INDEX "outbox_events_lease_expires_idx";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "recovery_fence_run_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "recovery_fenced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_runs_cell_generation_unique" ON "recovery_runs" USING btree ("data_cell_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_runs_source_unique" ON "recovery_runs" USING btree ("data_cell_id","source_manifest_sha256","restore_point_at");--> statement-breakpoint
CREATE INDEX "recovery_runs_completed_idx" ON "recovery_runs" USING btree ("data_cell_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_recovery_fence_run_id_recovery_runs_id_fk" FOREIGN KEY ("recovery_fence_run_id") REFERENCES "public"."recovery_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_recovery_fence_idx" ON "outbox_events" USING btree ("recovery_fence_run_id","created_at") WHERE "outbox_events"."recovery_fenced_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" IS NULL AND "outbox_events"."lease_expires_at" IS NULL AND "outbox_events"."recovery_fenced_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_lease_expires_idx" ON "outbox_events" USING btree ("lease_expires_at") WHERE "outbox_events"."published_at" IS NULL AND "outbox_events"."lease_expires_at" IS NOT NULL AND "outbox_events"."recovery_fenced_at" IS NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_recovery_fence_pair_check" CHECK (("outbox_events"."recovery_fence_run_id" IS NULL) = ("outbox_events"."recovery_fenced_at" IS NULL));