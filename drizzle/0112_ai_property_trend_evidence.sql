ALTER TABLE "ai_property_trend_outcomes" DROP CONSTRAINT "ai_property_trend_outcomes_valid";--> statement-breakpoint
DROP INDEX "ai_property_trend_schedules_generation_unique";--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD COLUMN "definition_version" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD COLUMN "definition_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_schedules_generation_unique" ON "ai_property_trend_schedules" USING btree ("organization_id","property_id","due_local_date","source_epoch","review_analysis_epoch","property_trends_epoch","property_profile_version","report_profile_version","terminal_analysis_sequence","aggregate_revision");--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_valid" CHECK ((
        "ai_property_trend_outcomes"."disposition" = 'ready'
        AND ("ai_property_trend_outcomes"."operation_id" IS NOT NULL OR "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL)
        AND jsonb_typeof("ai_property_trend_outcomes"."selected_signal_ids") = 'array'
        AND jsonb_array_length("ai_property_trend_outcomes"."selected_signal_ids") BETWEEN 1 AND 4
        AND "ai_property_trend_outcomes"."signal_key" ~ '^[a-z][a-z0-9_.]{2,63}$'
        AND "ai_property_trend_outcomes"."direction" IN ('improving', 'stable', 'declining')
        AND "ai_property_trend_outcomes"."confidence_basis_points" BETWEEN 0 AND 10000
        AND "ai_property_trend_outcomes"."supporting_review_count" >= 0
        AND "ai_property_trend_outcomes"."headline" IN ('Review signals improved', 'Review signals need attention', 'Notable review changes')
        AND jsonb_typeof("ai_property_trend_outcomes"."sentences") = 'array'
        AND jsonb_array_length("ai_property_trend_outcomes"."sentences") BETWEEN 1 AND 4
        AND length("ai_property_trend_outcomes"."summary") BETWEEN 1 AND 1000
        AND "ai_property_trend_outcomes"."render_profile_version" = 'trend-render-v1'
        AND "ai_property_trend_outcomes"."render_profile_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("ai_property_trend_outcomes"."definition_version" IS NULL AND "ai_property_trend_outcomes"."definition_digest" IS NULL AND "ai_property_trend_outcomes"."evidence" IS NULL)
          OR ("ai_property_trend_outcomes"."definition_version" = 'property-trend-definition-v1'
            AND "ai_property_trend_outcomes"."definition_digest" ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof("ai_property_trend_outcomes"."evidence") = 'object')
        )
        AND (
          ("ai_property_trend_outcomes"."operation_id" IS NOT NULL
            AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NOT NULL
            AND "ai_property_trend_outcomes"."recorded_at" = "ai_property_trend_outcomes"."provider_selection_recorded_at")
          OR ("ai_property_trend_outcomes"."operation_id" IS NULL AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL)
        )
        AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at"
      ) OR (
        "ai_property_trend_outcomes"."disposition" IN ('updating', 'insufficient_data', 'no_material_change')
        AND "ai_property_trend_outcomes"."operation_id" IS NULL
        AND "ai_property_trend_outcomes"."selected_signal_ids" IS NULL
        AND "ai_property_trend_outcomes"."signal_key" IS NULL
        AND "ai_property_trend_outcomes"."direction" IS NULL
        AND "ai_property_trend_outcomes"."confidence_basis_points" IS NULL
        AND "ai_property_trend_outcomes"."supporting_review_count" IS NULL
        AND "ai_property_trend_outcomes"."headline" IS NULL
        AND "ai_property_trend_outcomes"."sentences" IS NULL
        AND "ai_property_trend_outcomes"."summary" IS NULL
        AND "ai_property_trend_outcomes"."render_profile_version" IS NULL
        AND "ai_property_trend_outcomes"."render_profile_digest" IS NULL
        AND (
          ("ai_property_trend_outcomes"."definition_version" IS NULL AND "ai_property_trend_outcomes"."definition_digest" IS NULL AND "ai_property_trend_outcomes"."evidence" IS NULL AND "ai_property_trend_outcomes"."expires_at" IS NULL)
          OR ("ai_property_trend_outcomes"."definition_version" = 'property-trend-definition-v1'
            AND "ai_property_trend_outcomes"."definition_digest" ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof("ai_property_trend_outcomes"."evidence") = 'object'
            AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at")
        )
        AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL
      ));
