-- Manager corrections to a review's v3 analysis (shipped dark).
--
-- The analysis is the provider's answer and is never changed. A correction is a
-- manager's word beside one of its mentions: "this topic is not in the review"
-- (remove_topic, written for every mention of that topic in the analysis), "this
-- is not a problem" (not_a_problem, a complaint that is not one), or "the cause
-- is this" (change_cause, with the thing and what was wrong, and the Property
-- issue they belong to). The reads overlay a correction before anything is
-- counted, so Guest voice and the Inbox change at once; a new revision of the
-- review is a new analysis with a new key, so it starts with none, and the old
-- correction stays beside the old answer.
--
-- A correction holds a kind and, for a changed cause, two short lowercase phrases
-- the manager chose. It holds no quote, sentence, name or provider response. It
-- is removed with the analysis it sits beside: the foreign key to the mention
-- cascades, the mention cascades from ai_review_analyses, and the retention sweep
-- deletes that on its 24-month expiry (ai_review_analyses.v3_expired). The foreign
-- key to the replacement issue carries the topic, so a changed cause can only move
-- to an issue of the same topic at the same Property, and it cascades too.
--
-- The table is new and empty, and nothing writes it until a manager corrects a
-- mention of a v3 analysis, which nothing produces until v3 is activated. The new
-- foreign keys validate empty tables. migrate-deploy bounds the lock wait.
--
-- No backfill. Existing analyses are unchanged.
--
-- Roll forward, never back. The down step is: drop ai_review_analysis_mention_corrections;
-- finally delete the 0080 row of drizzle.__drizzle_migrations.
CREATE TABLE "ai_review_analysis_mention_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"mention_ordinal" smallint NOT NULL,
	"topic" varchar(40) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"replacement_thing" varchar(80),
	"replacement_issue" varchar(80),
	"replacement_issue_group_id" uuid,
	"corrected_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_review_analysis_mention_corrections_values_valid" CHECK ("ai_review_analysis_mention_corrections"."source_epoch" >= 0 AND "ai_review_analysis_mention_corrections"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analysis_mention_corrections"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_review_analysis_mention_corrections"."mention_ordinal" BETWEEN 0 AND 47
        AND "ai_review_analysis_mention_corrections"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')
        AND char_length("ai_review_analysis_mention_corrections"."corrected_by") BETWEEN 1 AND 255),
	CONSTRAINT "ai_review_analysis_mention_corrections_kind_valid" CHECK (("ai_review_analysis_mention_corrections"."kind" IN ('remove_topic', 'not_a_problem')
          AND "ai_review_analysis_mention_corrections"."replacement_thing" IS NULL AND "ai_review_analysis_mention_corrections"."replacement_issue" IS NULL AND "ai_review_analysis_mention_corrections"."replacement_issue_group_id" IS NULL)
        OR ("ai_review_analysis_mention_corrections"."kind" = 'change_cause'
          AND "ai_review_analysis_mention_corrections"."replacement_issue_group_id" IS NOT NULL
          AND ("ai_review_analysis_mention_corrections"."replacement_thing" IS NOT NULL OR "ai_review_analysis_mention_corrections"."replacement_issue" IS NOT NULL)
          AND ("ai_review_analysis_mention_corrections"."replacement_thing" IS NULL OR "ai_review_analysis_mention_corrections"."replacement_thing" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
          AND ("ai_review_analysis_mention_corrections"."replacement_issue" IS NULL OR "ai_review_analysis_mention_corrections"."replacement_issue" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
          AND ("ai_review_analysis_mention_corrections"."replacement_issue" IS NOT NULL OR "ai_review_analysis_mention_corrections"."replacement_thing" IS NULL))),
	CONSTRAINT "ai_review_analysis_mention_corrections_timestamps_valid" CHECK ("ai_review_analysis_mention_corrections"."updated_at" >= "ai_review_analysis_mention_corrections"."created_at")
);--> statement-breakpoint
ALTER TABLE "ai_review_analysis_mention_corrections" ADD CONSTRAINT "ai_review_analysis_mention_corrections_mention_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") REFERENCES "public"."ai_review_analysis_mentions"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_mention_corrections" ADD CONSTRAINT "ai_review_analysis_mention_corrections_issue_group_fk" FOREIGN KEY ("organization_id","property_id","replacement_issue_group_id","topic") REFERENCES "public"."ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_mention_corrections_mention_unique" ON "ai_review_analysis_mention_corrections" USING btree ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal");
