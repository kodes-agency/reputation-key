ALTER TABLE "recent_activity_replay_facts" ADD COLUMN "actor_label_redacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recent_activity_replay_actor_idx" ON "recent_activity_replay_facts" USING btree ("organization_id","actor_subject_id","replay_key");--> statement-breakpoint
CREATE TABLE "recent_activity_actor_label_redactions" (
	"organization_id" varchar(255) NOT NULL,
	"actor_subject_id" varchar(255) NOT NULL,
	"redacted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recent_activity_actor_label_redactions_pk" PRIMARY KEY("organization_id","actor_subject_id"),
	CONSTRAINT "recent_activity_actor_label_redactions_interval_check" CHECK ("recent_activity_actor_label_redactions"."expires_at" > "recent_activity_actor_label_redactions"."redacted_at")
);--> statement-breakpoint
CREATE INDEX "recent_activity_actor_label_redactions_expiry_idx" ON "recent_activity_actor_label_redactions" USING btree ("expires_at","organization_id","actor_subject_id");
