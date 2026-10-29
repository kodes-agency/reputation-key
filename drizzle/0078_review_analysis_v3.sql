-- Review Analysis v3 storage and the Google primary category (shipped dark).
--
-- A v3 analysis reads a review as twelve universal topics. Each mention names a
-- topic, a polarity, a strength (mild, clear, strong), an optional cause (a
-- `thing` and an `issue` of one to three lowercase words), the numbers of the
-- sentences that state it and whether a team member or someone else is named.
-- An Urgent review carries the one reason it is urgent. Zero mentions is a
-- valid answer, so a v3 analysis has no primary category and no issue label.
-- Nothing here stores a quote, a sentence, a name or a provider response
-- (ADR 0031): a sentence is a number the live display resolves against the
-- original text, read through Review.
--
-- Nothing reads or writes any of it yet. No operation profile, runtime
-- catalogue row, merchant notice or deployment profile selects v3, so the new
-- columns stay NULL, the new tables stay empty, and every statement below is
-- additive for the code that is live.
--
-- properties.google_primary_category / ..._updated_at: Google's display name for
-- the location's primary category, read at import and relink. It picks which
-- vocabulary hints a review analysis is steered with; it is never shown as a
-- venue type (docs/BETA.md §3). gbp_import_request_items.google_primary_category
-- carries it from discovery to the Property the item creates or relinks, and is
-- scrubbed with the item's other provider state when the item is terminal.
--
-- ai_operations: the lineage a v3 analysis operation actually used (provider,
-- model, request profile, vocabulary hint set, normalizer) and, once it settles,
-- the closed content-free flags the normalizer raised and how many mentions it
-- dropped. A v3 operation must name its provider, hint set and normalizer;
-- earlier operations leave all of them NULL.
--
-- ai_execution_control_*: a `provider` scope (provider:openai, provider:anthropic)
-- beside the deployment-profile scope. The deployment-profile branch now refuses
-- the two provider ids so one scope key cannot name both kinds.
--
-- ai_review_analyses: `urgent_reason`, and a result check that tells the two
-- shapes apart by analysis_profile_version. ai_property_aggregate_contributions:
-- a ready row may leave primary_category NULL, which is how a v3 contribution
-- looks.
--
-- New tables, each a derivative that expires with the analysis it belongs to:
--   ai_review_analysis_mentions              the mentions of one analysis
--   ai_review_analysis_mention_sentences     the sentence numbers a mention cites
--   ai_property_aggregate_contribution_mentions
--                                            the mentions again, under the
--                                            contribution that retracts with them
--   ai_property_review_population_daily      reviews per local day by stars,
--                                            star-only reviews included
-- The retention sweep deletes expired analyses and the daily counts at 24 months
-- (src/shared/jobs/retention-sweep.job.ts); the three mention tables cascade.
--
-- No backfill: v2 analyses stay as they are and are hidden by the epoch and
-- profile fences when v3 is switched on.
--
-- A CHECK passes when its expression is unknown, and a comparison against a NULL
-- column is unknown, so every arm that needs a value states IS NOT NULL beside
-- the comparison. The v2 arm of ai_review_analyses_result_valid is restated word
-- for word and keeps the looseness it always had.
--
-- Locks. Every ADD COLUMN is nullable or carries a constant default, so none
-- rewrites a table. Each ADD CONSTRAINT CHECK scans the table it is added to
-- under an ACCESS EXCLUSIVE lock, plain rather than NOT VALID because drizzle
-- applies every pending file in one transaction, so a NOT VALID/VALIDATE pair
-- would hold the same lock over the same scan (0065 and 0077 explain the same
-- choice). The tables scanned are properties, gbp_import_request_items, the two
-- execution-control tables, ai_operations, ai_review_analyses and
-- ai_property_aggregate_contributions: one row per Property, import item,
-- control, operation, analysis and contribution, which at beta size is a short
-- scan each. The four new tables are empty, so their foreign keys validate
-- nothing. migrate-deploy bounds the lock WAIT
-- (src/shared/db/migration-lock-timeout.ts).
--
-- Roll forward, never back. The down step is: DROP TABLE
-- ai_property_review_population_daily, ai_property_aggregate_contribution_mentions,
-- ai_review_analysis_mention_sentences, ai_review_analysis_mentions; restore
-- ai_property_aggregate_contributions_result_valid and ai_review_analyses_result_valid
-- and the two ai_execution_control_*_scope_valid checks as 0000 and 0005 state
-- them; DROP the new ai_operations constraints and columns, ai_review_analyses.urgent_reason,
-- gbp_import_request_items.google_primary_category and the two properties columns with
-- their check; then delete the 0078 row of drizzle.__drizzle_migrations.
ALTER TABLE "properties" ADD COLUMN "google_primary_category" varchar(512);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "google_primary_category_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_primary_category_valid" CHECK ((
        "properties"."google_primary_category" IS NULL
        OR (
          char_length("properties"."google_primary_category") BETWEEN 1 AND 512
          AND "properties"."google_primary_category" = btrim("properties"."google_primary_category")
          AND "properties"."google_primary_category_updated_at" IS NOT NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD COLUMN "google_primary_category" varchar(512);--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_google_primary_category_valid" CHECK ("gbp_import_request_items"."google_primary_category" IS NULL OR (char_length("gbp_import_request_items"."google_primary_category") BETWEEN 1 AND 512 AND "gbp_import_request_items"."google_primary_category" = btrim("gbp_import_request_items"."google_primary_category")));--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_execution_control_transitions_scope_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_scope_valid" CHECK ((
        ("ai_execution_control_transitions"."scope_kind" = 'global' AND "ai_execution_control_transitions"."scope_key" = 'global' AND "ai_execution_control_transitions"."scope_value" IS NULL)
        OR ("ai_execution_control_transitions"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_transitions"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_transitions"."scope_value" NOT IN ('openai', 'anthropic') AND "ai_execution_control_transitions"."scope_key" = 'provider:' || "ai_execution_control_transitions"."scope_value")
        OR ("ai_execution_control_transitions"."scope_kind" = 'provider' AND "ai_execution_control_transitions"."scope_value" IS NOT NULL AND "ai_execution_control_transitions"."scope_value" IN ('openai', 'anthropic') AND "ai_execution_control_transitions"."scope_key" = 'provider:' || "ai_execution_control_transitions"."scope_value")
        OR ("ai_execution_control_transitions"."scope_kind" = 'capability' AND "ai_execution_control_transitions"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_transitions"."scope_key" = 'capability:' || "ai_execution_control_transitions"."scope_value")
      ));--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" DROP CONSTRAINT "ai_execution_control_heads_scope_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_scope_valid" CHECK ((
        ("ai_execution_control_heads"."scope_kind" = 'global' AND "ai_execution_control_heads"."scope_key" = 'global' AND "ai_execution_control_heads"."scope_value" IS NULL)
        OR ("ai_execution_control_heads"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_heads"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_heads"."scope_value" NOT IN ('openai', 'anthropic') AND "ai_execution_control_heads"."scope_key" = 'provider:' || "ai_execution_control_heads"."scope_value")
        OR ("ai_execution_control_heads"."scope_kind" = 'provider' AND "ai_execution_control_heads"."scope_value" IS NOT NULL AND "ai_execution_control_heads"."scope_value" IN ('openai', 'anthropic') AND "ai_execution_control_heads"."scope_key" = 'provider:' || "ai_execution_control_heads"."scope_value")
        OR ("ai_execution_control_heads"."scope_kind" = 'capability' AND "ai_execution_control_heads"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_heads"."scope_key" = 'capability:' || "ai_execution_control_heads"."scope_value")
      ));--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "provider_id" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "provider_model" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "provider_request_profile_version" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "provider_request_profile_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "vocabulary_hint_set_id" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "vocabulary_hint_set_version" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "vocabulary_hint_set_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "normalization_profile_version" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "normalization_profile_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "normalization_flags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "dropped_mention_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_provider_lineage_valid" CHECK (("ai_operations"."provider_id" IS NULL AND "ai_operations"."provider_model" IS NULL AND "ai_operations"."provider_request_profile_version" IS NULL AND "ai_operations"."provider_request_profile_digest" IS NULL)
        OR ("ai_operations"."provider_id" IS NOT NULL AND "ai_operations"."provider_model" IS NOT NULL AND "ai_operations"."provider_request_profile_version" IS NOT NULL AND "ai_operations"."provider_request_profile_digest" IS NOT NULL
          AND "ai_operations"."provider_id" IN ('openai', 'anthropic') AND char_length("ai_operations"."provider_model") BETWEEN 1 AND 100
          AND char_length("ai_operations"."provider_request_profile_version") BETWEEN 1 AND 100
          AND "ai_operations"."provider_request_profile_digest" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_vocabulary_lineage_valid" CHECK (("ai_operations"."vocabulary_hint_set_id" IS NULL AND "ai_operations"."vocabulary_hint_set_version" IS NULL AND "ai_operations"."vocabulary_hint_set_digest" IS NULL)
        OR ("ai_operations"."vocabulary_hint_set_id" IS NOT NULL AND "ai_operations"."vocabulary_hint_set_version" IS NOT NULL AND "ai_operations"."vocabulary_hint_set_digest" IS NOT NULL
          AND "ai_operations"."vocabulary_hint_set_id" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
          AND char_length("ai_operations"."vocabulary_hint_set_version") BETWEEN 1 AND 100
          AND "ai_operations"."vocabulary_hint_set_digest" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_normalization_lineage_valid" CHECK (("ai_operations"."normalization_profile_version" IS NULL AND "ai_operations"."normalization_profile_digest" IS NULL
          AND "ai_operations"."normalization_flags" = '{}' AND "ai_operations"."dropped_mention_count" = 0)
        OR ("ai_operations"."normalization_profile_version" IS NOT NULL AND "ai_operations"."normalization_profile_digest" IS NOT NULL
          AND char_length("ai_operations"."normalization_profile_version") BETWEEN 1 AND 100
          AND "ai_operations"."normalization_profile_digest" ~ '^[0-9a-f]{64}$'
          AND "ai_operations"."normalization_flags" <@ ARRAY['mentions_capped', 'sentence_refs_capped', 'enum_case_repaired', 'mention_dropped_malformed', 'mention_dropped_enum', 'mention_dropped_cause', 'mention_dropped_sentences', 'sentence_refs_repaired', 'cause_refused_name', 'cause_refused_quotation', 'names_person_invalid', 'names_person_raised', 'mentions_merged', 'urgent_reason_unknown']
          AND "ai_operations"."dropped_mention_count" BETWEEN 0 AND 48));--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_v3_lineage_required" CHECK ("ai_operations"."operation_profile_version" <> 'review-analysis-v3'
        OR ("ai_operations"."command" = 'analysis' AND "ai_operations"."provider_id" IS NOT NULL
          AND "ai_operations"."vocabulary_hint_set_id" IS NOT NULL AND "ai_operations"."normalization_profile_version" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD COLUMN "urgent_reason" varchar(30);--> statement-breakpoint
ALTER TABLE "ai_review_analyses" DROP CONSTRAINT "ai_review_analyses_result_valid";--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_result_valid" CHECK ((
        ("ai_review_analyses"."analysis_profile_version" <> 'review-analysis-v3' AND "ai_review_analyses"."urgent_reason" IS NULL AND (
          ("ai_review_analyses"."status" = 'ready' AND "ai_review_analyses"."unavailable_reason" IS NULL AND "ai_review_analyses"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_review_analyses"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events') AND "ai_review_analyses"."attention" IN ('urgent', 'high', 'medium', 'low') AND ("ai_review_analyses"."issue_label" IS NULL OR "ai_review_analyses"."issue_label" ~ '^[a-z]+( [a-z]+){0,3}$'))
          OR ("ai_review_analyses"."status" = 'unavailable' AND "ai_review_analyses"."unavailable_reason" = 'language_not_supported' AND "ai_review_analyses"."sentiment" IS NULL AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."attention" IS NULL AND "ai_review_analyses"."issue_label" IS NULL)
        ))
        OR ("ai_review_analyses"."analysis_profile_version" = 'review-analysis-v3' AND (
          ("ai_review_analyses"."status" = 'ready' AND "ai_review_analyses"."unavailable_reason" IS NULL AND "ai_review_analyses"."sentiment" IS NOT NULL AND "ai_review_analyses"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."issue_label" IS NULL AND "ai_review_analyses"."attention" IS NOT NULL AND "ai_review_analyses"."attention" IN ('urgent', 'high', 'medium', 'low')
            AND (("ai_review_analyses"."attention" = 'urgent' AND "ai_review_analyses"."urgent_reason" IS NOT NULL AND "ai_review_analyses"."urgent_reason" IN ('safety', 'health', 'discrimination', 'legal_threat')) OR ("ai_review_analyses"."attention" <> 'urgent' AND "ai_review_analyses"."urgent_reason" IS NULL)))
          OR ("ai_review_analyses"."status" = 'unavailable' AND "ai_review_analyses"."unavailable_reason" IS NOT NULL AND "ai_review_analyses"."unavailable_reason" = 'language_not_supported' AND "ai_review_analyses"."sentiment" IS NULL AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."attention" IS NULL AND "ai_review_analyses"."issue_label" IS NULL AND "ai_review_analyses"."urgent_reason" IS NULL)
        ))
      ));--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_result_valid";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_result_valid" CHECK ((
        ("ai_property_aggregate_contributions"."status" = 'ready' AND "ai_property_aggregate_contributions"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND ("ai_property_aggregate_contributions"."primary_category" IS NULL OR "ai_property_aggregate_contributions"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events')) AND "ai_property_aggregate_contributions"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_property_aggregate_contributions"."status" = 'unavailable' AND "ai_property_aggregate_contributions"."sentiment" IS NULL AND "ai_property_aggregate_contributions"."primary_category" IS NULL AND "ai_property_aggregate_contributions"."attention" IS NULL)
      ));--> statement-breakpoint
CREATE TABLE "ai_review_analysis_mentions" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"mention_ordinal" smallint NOT NULL,
	"topic" varchar(40) NOT NULL,
	"polarity" varchar(10) NOT NULL,
	"strength" varchar(10) NOT NULL,
	"thing" varchar(80),
	"issue" varchar(80),
	"names_person" varchar(20),
	CONSTRAINT "ai_review_analysis_mentions_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal"),
	CONSTRAINT "ai_review_analysis_mentions_values_valid" CHECK ("ai_review_analysis_mentions"."source_epoch" >= 0 AND "ai_review_analysis_mentions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analysis_mentions"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_review_analysis_mentions"."mention_ordinal" BETWEEN 0 AND 47
        AND "ai_review_analysis_mentions"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')
        AND "ai_review_analysis_mentions"."polarity" IN ('positive', 'neutral', 'negative')
        AND "ai_review_analysis_mentions"."strength" IN ('mild', 'clear', 'strong')
        AND ("ai_review_analysis_mentions"."names_person" IS NULL OR "ai_review_analysis_mentions"."names_person" IN ('team_member', 'other'))),
	CONSTRAINT "ai_review_analysis_mentions_cause_valid" CHECK (("ai_review_analysis_mentions"."thing" IS NULL OR "ai_review_analysis_mentions"."thing" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
        AND ("ai_review_analysis_mentions"."issue" IS NULL OR "ai_review_analysis_mentions"."issue" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
        AND ("ai_review_analysis_mentions"."issue" IS NOT NULL OR "ai_review_analysis_mentions"."thing" IS NULL))
);--> statement-breakpoint
CREATE TABLE "ai_review_analysis_mention_sentences" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"mention_ordinal" smallint NOT NULL,
	"sentence_number" integer NOT NULL,
	CONSTRAINT "ai_review_analysis_mention_sentences_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal","sentence_number"),
	CONSTRAINT "ai_review_analysis_mention_sentences_number_valid" CHECK ("ai_review_analysis_mention_sentences"."sentence_number" BETWEEN 1 AND 10000)
);--> statement-breakpoint
CREATE TABLE "ai_property_aggregate_contribution_mentions" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"mention_ordinal" smallint NOT NULL,
	"topic" varchar(40) NOT NULL,
	"polarity" varchar(10) NOT NULL,
	"strength" varchar(10) NOT NULL,
	"thing" varchar(80),
	"issue" varchar(80),
	"names_person" varchar(20),
	CONSTRAINT "ai_property_aggregate_contribution_mentions_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal"),
	CONSTRAINT "ai_property_aggregate_contribution_mentions_values_valid" CHECK ("ai_property_aggregate_contribution_mentions"."source_epoch" >= 0 AND "ai_property_aggregate_contribution_mentions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contribution_mentions"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_property_aggregate_contribution_mentions"."mention_ordinal" BETWEEN 0 AND 47
        AND "ai_property_aggregate_contribution_mentions"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')
        AND "ai_property_aggregate_contribution_mentions"."polarity" IN ('positive', 'neutral', 'negative')
        AND "ai_property_aggregate_contribution_mentions"."strength" IN ('mild', 'clear', 'strong')
        AND ("ai_property_aggregate_contribution_mentions"."names_person" IS NULL OR "ai_property_aggregate_contribution_mentions"."names_person" IN ('team_member', 'other'))),
	CONSTRAINT "ai_property_aggregate_contribution_mentions_cause_valid" CHECK (("ai_property_aggregate_contribution_mentions"."thing" IS NULL OR "ai_property_aggregate_contribution_mentions"."thing" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
        AND ("ai_property_aggregate_contribution_mentions"."issue" IS NULL OR "ai_property_aggregate_contribution_mentions"."issue" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')
        AND ("ai_property_aggregate_contribution_mentions"."issue" IS NOT NULL OR "ai_property_aggregate_contribution_mentions"."thing" IS NULL))
);--> statement-breakpoint
CREATE TABLE "ai_property_review_population_daily" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"review_count" integer NOT NULL,
	"text_review_count" integer NOT NULL,
	"rating_1_count" integer NOT NULL,
	"rating_2_count" integer NOT NULL,
	"rating_3_count" integer NOT NULL,
	"rating_4_count" integer NOT NULL,
	"rating_5_count" integer NOT NULL,
	"population_revision" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_review_population_daily_pk" PRIMARY KEY("organization_id","property_id","source_epoch","property_profile_version","local_date"),
	CONSTRAINT "ai_property_review_population_daily_versions_valid" CHECK ("ai_property_review_population_daily"."source_epoch" >= 0 AND "ai_property_review_population_daily"."property_profile_version" >= 1 AND char_length("ai_property_review_population_daily"."calendar_profile_version") BETWEEN 1 AND 100 AND "ai_property_review_population_daily"."population_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_review_population_daily_counts_valid" CHECK ("ai_property_review_population_daily"."review_count" >= 0 AND "ai_property_review_population_daily"."text_review_count" >= 0 AND "ai_property_review_population_daily"."text_review_count" <= "ai_property_review_population_daily"."review_count"
        AND "ai_property_review_population_daily"."rating_1_count" >= 0 AND "ai_property_review_population_daily"."rating_2_count" >= 0 AND "ai_property_review_population_daily"."rating_3_count" >= 0 AND "ai_property_review_population_daily"."rating_4_count" >= 0 AND "ai_property_review_population_daily"."rating_5_count" >= 0
        AND "ai_property_review_population_daily"."rating_1_count" + "ai_property_review_population_daily"."rating_2_count" + "ai_property_review_population_daily"."rating_3_count" + "ai_property_review_population_daily"."rating_4_count" + "ai_property_review_population_daily"."rating_5_count" = "ai_property_review_population_daily"."review_count")
);--> statement-breakpoint
ALTER TABLE "ai_review_analysis_mentions" ADD CONSTRAINT "ai_review_analysis_mentions_analysis_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_mention_sentences" ADD CONSTRAINT "ai_review_analysis_mention_sentences_mention_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") REFERENCES "public"."ai_review_analysis_mentions"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contribution_mentions" ADD CONSTRAINT "ai_property_aggregate_contribution_mentions_contribution_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_property_aggregate_contributions"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_review_population_daily" ADD CONSTRAINT "ai_property_review_population_daily_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_mentions_identity_unique" ON "ai_review_analysis_mentions" USING btree ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","topic",coalesce("thing", ''),"polarity");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_aggregate_contribution_mentions_identity_unique" ON "ai_property_aggregate_contribution_mentions" USING btree ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","topic",coalesce("thing", ''),"polarity");--> statement-breakpoint
CREATE INDEX "ai_property_review_population_daily_retention_idx" ON "ai_property_review_population_daily" USING btree ("local_date");
