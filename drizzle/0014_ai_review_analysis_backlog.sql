-- Review Analysis backlog paced through the background admission lane.
--
-- Importing a property with a long review history, or first enabling AI on
-- one, used to turn every historical review into an immediate provider call:
-- dozens of outbox deliveries raced one property's admission budget and
-- retried on BullMQ backoff, and nobody could see how far analysis had got.
-- Historical and backfill analysis events are now receipted into this table
-- and drained at the background lane's pace, newest review first; a review a
-- manager opens can be analysed ahead of the queue on the interactive lane.
-- Rows are identifier-only work items (ADR 0030) and are deleted once the
-- analysis settles; a property or review deletion cascades (ADR 0058).
CREATE TABLE "ai_review_analysis_backlog" (
	"event_envelope_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"origin" varchar(32) NOT NULL,
	"priority" varchar(16) DEFAULT 'background' NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"claimed_until" timestamp with time zone,
	"first_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_analysis_backlog_values_valid" CHECK ("ai_review_analysis_backlog"."origin" IN ('historical_onboarding', 'backfill', 'deferred_live')
        AND "ai_review_analysis_backlog"."priority" IN ('background', 'interactive')
        AND "ai_review_analysis_backlog"."state" IN ('queued', 'claimed')
        AND ("ai_review_analysis_backlog"."state" = 'claimed') = ("ai_review_analysis_backlog"."claimed_until" IS NOT NULL)
        AND "ai_review_analysis_backlog"."attempts" BETWEEN 0 AND 2147483647
        AND "ai_review_analysis_backlog"."source_epoch" BETWEEN 0 AND 2147483647
        AND "ai_review_analysis_backlog"."source_revision" BETWEEN 1 AND 2147483647
        AND "ai_review_analysis_backlog"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backlog" ADD CONSTRAINT "ai_review_analysis_backlog_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_backlog" ADD CONSTRAINT "ai_review_analysis_backlog_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_review_analysis_backlog_ready_idx" ON "ai_review_analysis_backlog" USING btree ("property_id","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ai_review_analysis_backlog_review_idx" ON "ai_review_analysis_backlog" USING btree ("organization_id","property_id","review_id");
