CREATE TABLE "ai_property_aggregate_contribution_aspects" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"aspect" varchar(40) NOT NULL,
	"polarity" varchar(20) NOT NULL,
	"intensity" integer NOT NULL,
	CONSTRAINT "ai_property_aggregate_contribution_aspects_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","aspect"),
	CONSTRAINT "ai_property_aggregate_contribution_aspects_aspect_valid" CHECK ("ai_property_aggregate_contribution_aspects"."aspect" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events')),
	CONSTRAINT "ai_property_contribution_aspects_polarity_intensity_valid" CHECK (("ai_property_aggregate_contribution_aspects"."polarity" = 'positive' AND "ai_property_aggregate_contribution_aspects"."intensity" BETWEEN 20 AND 100) OR ("ai_property_aggregate_contribution_aspects"."polarity" = 'neutral' AND abs("ai_property_aggregate_contribution_aspects"."intensity") <= 19) OR ("ai_property_aggregate_contribution_aspects"."polarity" = 'negative' AND "ai_property_aggregate_contribution_aspects"."intensity" < 0 AND abs("ai_property_aggregate_contribution_aspects"."intensity") BETWEEN 20 AND 100))
);
--> statement-breakpoint
CREATE TABLE "ai_property_daily_aspect_aggregates" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"aspect" varchar(40) NOT NULL,
	"polarity" varchar(20) NOT NULL,
	"mention_count" integer NOT NULL,
	CONSTRAINT "ai_property_daily_aspect_aggregates_pk" PRIMARY KEY("organization_id","property_id","local_date","source_epoch","review_analysis_epoch","property_profile_version","aspect","polarity"),
	CONSTRAINT "ai_property_daily_aspect_aggregates_values_valid" CHECK ("ai_property_daily_aspect_aggregates"."source_epoch" >= 0 AND "ai_property_daily_aspect_aggregates"."review_analysis_epoch" >= 1 AND "ai_property_daily_aspect_aggregates"."property_profile_version" >= 1 AND "ai_property_daily_aspect_aggregates"."aspect" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events') AND "ai_property_daily_aspect_aggregates"."polarity" IN ('positive', 'neutral', 'negative') AND "ai_property_daily_aspect_aggregates"."mention_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_review_analysis_aspects" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"aspect" varchar(40) NOT NULL,
	"polarity" varchar(20) NOT NULL,
	"intensity" integer NOT NULL,
	CONSTRAINT "ai_review_analysis_aspects_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","aspect"),
	CONSTRAINT "ai_review_analysis_aspects_aspect_valid" CHECK ("ai_review_analysis_aspects"."aspect" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events')),
	CONSTRAINT "ai_review_analysis_aspects_polarity_intensity_valid" CHECK (("ai_review_analysis_aspects"."polarity" = 'positive' AND "ai_review_analysis_aspects"."intensity" BETWEEN 20 AND 100) OR ("ai_review_analysis_aspects"."polarity" = 'neutral' AND abs("ai_review_analysis_aspects"."intensity") <= 19) OR ("ai_review_analysis_aspects"."polarity" = 'negative' AND "ai_review_analysis_aspects"."intensity" < 0 AND abs("ai_review_analysis_aspects"."intensity") BETWEEN 20 AND 100))
);
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_result_valid";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP CONSTRAINT "ai_property_daily_aggregates_counts_nonnegative";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP CONSTRAINT "ai_property_daily_aggregates_count_sums_valid";--> statement-breakpoint
ALTER TABLE "ai_review_analyses" DROP CONSTRAINT "ai_review_analyses_result_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_contract_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_contract_valid";--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD COLUMN "issue_label" varchar(40);--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contribution_aspects" ADD CONSTRAINT "ai_property_aggregate_contribution_aspects_contribution_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_property_aggregate_contributions"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_daily_aspect_aggregates" ADD CONSTRAINT "ai_property_daily_aspect_aggregates_daily_fk" FOREIGN KEY ("organization_id","property_id","local_date","source_epoch","review_analysis_epoch","property_profile_version") REFERENCES "public"."ai_property_daily_aggregates"("organization_id","property_id","local_date","source_epoch","review_analysis_epoch","property_profile_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_aspects" ADD CONSTRAINT "ai_review_analysis_aspects_analysis_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_property_daily_aspect_aggregates_window_idx" ON "ai_property_daily_aspect_aggregates" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","local_date");--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "service_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "staff_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "quality_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "value_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "cleanliness_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "wait_time_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "atmosphere_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "location_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "accessibility_count";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP COLUMN "other_count";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_result_valid" CHECK ((
        ("ai_property_aggregate_contributions"."status" = 'ready' AND "ai_property_aggregate_contributions"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_property_aggregate_contributions"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events') AND "ai_property_aggregate_contributions"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_property_aggregate_contributions"."status" = 'unavailable' AND "ai_property_aggregate_contributions"."sentiment" IS NULL AND "ai_property_aggregate_contributions"."primary_category" IS NULL AND "ai_property_aggregate_contributions"."attention" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_counts_nonnegative" CHECK ("ai_property_daily_aggregates"."review_count" >= 0 AND "ai_property_daily_aggregates"."rating_sum" >= 0 AND "ai_property_daily_aggregates"."positive_count" >= 0 AND "ai_property_daily_aggregates"."neutral_count" >= 0 AND "ai_property_daily_aggregates"."negative_count" >= 0 AND "ai_property_daily_aggregates"."mixed_count" >= 0 AND "ai_property_daily_aggregates"."urgent_count" >= 0 AND "ai_property_daily_aggregates"."high_count" >= 0 AND "ai_property_daily_aggregates"."medium_count" >= 0 AND "ai_property_daily_aggregates"."low_count" >= 0);--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_count_sums_valid" CHECK ("ai_property_daily_aggregates"."positive_count" + "ai_property_daily_aggregates"."neutral_count" + "ai_property_daily_aggregates"."negative_count" + "ai_property_daily_aggregates"."mixed_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."urgent_count" + "ai_property_daily_aggregates"."high_count" + "ai_property_daily_aggregates"."medium_count" + "ai_property_daily_aggregates"."low_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."rating_sum" <= "ai_property_daily_aggregates"."review_count" * 5);--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_result_valid" CHECK ((
        ("ai_review_analyses"."status" = 'ready' AND "ai_review_analyses"."unavailable_reason" IS NULL AND "ai_review_analyses"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_review_analyses"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events') AND "ai_review_analyses"."attention" IN ('urgent', 'high', 'medium', 'low') AND ("ai_review_analyses"."issue_label" IS NULL OR "ai_review_analyses"."issue_label" ~ '^[a-z]+( [a-z]+){0,3}$'))
        OR ("ai_review_analyses"."status" = 'unavailable' AND "ai_review_analyses"."unavailable_reason" = 'language_not_supported' AND "ai_review_analyses"."sentiment" IS NULL AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."attention" IS NULL AND "ai_review_analyses"."issue_label" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK ((
          ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-08.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-09.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1')
        )
        AND "merchant_ai_consent_evidence"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1
        AND "merchant_ai_consent_evidence"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK ((
          ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_enablement"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_enablement"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-08.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-09.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1')
        )
        AND "merchant_ai_enablement"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_enablement"."routing_policy_version" = 1
        AND "merchant_ai_enablement"."redaction_profile_family" = 'gbp-review-global-v1');