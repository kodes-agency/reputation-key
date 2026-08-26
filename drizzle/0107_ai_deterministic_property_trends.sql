ALTER TABLE "ai_property_trend_outcomes" DROP CONSTRAINT "ai_property_trend_outcomes_valid";--> statement-breakpoint
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
          ("ai_property_trend_outcomes"."operation_id" IS NOT NULL
            AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NOT NULL
            AND "ai_property_trend_outcomes"."recorded_at" = "ai_property_trend_outcomes"."provider_selection_recorded_at")
          OR ("ai_property_trend_outcomes"."operation_id" IS NULL AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL)
        )
        AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at"
      ) OR (
        "ai_property_trend_outcomes"."disposition" IN ('insufficient_data', 'no_material_change')
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
        AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL
        AND "ai_property_trend_outcomes"."expires_at" IS NULL
      ));