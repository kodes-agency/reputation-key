CREATE TABLE "ai_property_aggregate_contributions" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"local_date" date NOT NULL,
	"rating" integer NOT NULL,
	"sentiment" varchar(20) NOT NULL,
	"primary_category" varchar(40) NOT NULL,
	"attention" varchar(20) NOT NULL,
	"applied_aggregate_revision" bigint NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_aggregate_contributions_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence"),
	CONSTRAINT "ai_property_aggregate_contributions_values_valid" CHECK ("ai_property_aggregate_contributions"."source_epoch" >= 1 AND "ai_property_aggregate_contributions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_contributions"."property_profile_version" >= 1 AND "ai_property_aggregate_contributions"."rating" BETWEEN 1 AND 5 AND "ai_property_aggregate_contributions"."applied_aggregate_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_aggregate_contributions_derivative_valid" CHECK ("ai_property_aggregate_contributions"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_property_aggregate_contributions"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND "ai_property_aggregate_contributions"."attention" IN ('urgent', 'high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "ai_property_calendar_catalogues" (
	"profile_version" varchar(100) PRIMARY KEY NOT NULL,
	"epoch_millis_function_name" varchar(100) NOT NULL,
	"epoch_millis_function_digest" varchar(64) NOT NULL,
	"local_date_function_name" varchar(100) NOT NULL,
	"local_date_function_digest" varchar(64) NOT NULL,
	"local_midnight_function_name" varchar(100) NOT NULL,
	"local_midnight_function_digest" varchar(64) NOT NULL,
	"image_digest" varchar(64) NOT NULL,
	"vector_digest" varchar(64) NOT NULL,
	"vector_count" integer NOT NULL,
	"minimum_year" integer NOT NULL,
	"maximum_year" integer NOT NULL,
	"tested_postgres_major_versions" integer[] NOT NULL,
	"test_vectors" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_calendar_profile_valid" CHECK ("ai_property_calendar_catalogues"."profile_version" = 'property-calendar-v1'),
	CONSTRAINT "ai_property_calendar_function_valid" CHECK ("ai_property_calendar_catalogues"."epoch_millis_function_name" = 'ai_epoch_millis_v1' AND "ai_property_calendar_catalogues"."local_date_function_name" = 'ai_property_local_date_v1' AND "ai_property_calendar_catalogues"."local_midnight_function_name" = 'ai_property_local_midnight_v1'),
	CONSTRAINT "ai_property_calendar_digests_valid" CHECK ("ai_property_calendar_catalogues"."epoch_millis_function_digest" ~ '^[0-9a-f]{64}$' AND "ai_property_calendar_catalogues"."local_date_function_digest" ~ '^[0-9a-f]{64}$' AND "ai_property_calendar_catalogues"."local_midnight_function_digest" ~ '^[0-9a-f]{64}$' AND "ai_property_calendar_catalogues"."image_digest" = '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20' AND "ai_property_calendar_catalogues"."vector_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_property_calendar_range_valid" CHECK ("ai_property_calendar_catalogues"."vector_count" = 10 AND "ai_property_calendar_catalogues"."minimum_year" = 1970 AND "ai_property_calendar_catalogues"."maximum_year" = 2100 AND "ai_property_calendar_catalogues"."tested_postgres_major_versions" = ARRAY[16]::integer[] AND jsonb_typeof("ai_property_calendar_catalogues"."test_vectors") = 'array' AND jsonb_array_length("ai_property_calendar_catalogues"."test_vectors") = "ai_property_calendar_catalogues"."vector_count")
);
--> statement-breakpoint
CREATE TABLE "ai_property_daily_aggregates" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"review_count" integer NOT NULL,
	"rating_sum" integer NOT NULL,
	"positive_count" integer NOT NULL,
	"neutral_count" integer NOT NULL,
	"negative_count" integer NOT NULL,
	"mixed_count" integer NOT NULL,
	"service_count" integer NOT NULL,
	"staff_count" integer NOT NULL,
	"quality_count" integer NOT NULL,
	"value_count" integer NOT NULL,
	"cleanliness_count" integer NOT NULL,
	"wait_time_count" integer NOT NULL,
	"atmosphere_count" integer NOT NULL,
	"location_count" integer NOT NULL,
	"accessibility_count" integer NOT NULL,
	"other_count" integer NOT NULL,
	"urgent_count" integer NOT NULL,
	"high_count" integer NOT NULL,
	"medium_count" integer NOT NULL,
	"low_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_daily_aggregates_pk" PRIMARY KEY("organization_id","property_id","local_date","source_epoch","review_analysis_epoch","property_profile_version"),
	CONSTRAINT "ai_property_daily_aggregates_versions_valid" CHECK ("ai_property_daily_aggregates"."source_epoch" >= 1 AND "ai_property_daily_aggregates"."review_analysis_epoch" >= 1 AND "ai_property_daily_aggregates"."property_profile_version" >= 1 AND "ai_property_daily_aggregates"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_daily_aggregates"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_daily_aggregates_counts_nonnegative" CHECK ("ai_property_daily_aggregates"."review_count" >= 0 AND "ai_property_daily_aggregates"."rating_sum" >= 0 AND "ai_property_daily_aggregates"."positive_count" >= 0 AND "ai_property_daily_aggregates"."neutral_count" >= 0 AND "ai_property_daily_aggregates"."negative_count" >= 0 AND "ai_property_daily_aggregates"."mixed_count" >= 0 AND "ai_property_daily_aggregates"."service_count" >= 0 AND "ai_property_daily_aggregates"."staff_count" >= 0 AND "ai_property_daily_aggregates"."quality_count" >= 0 AND "ai_property_daily_aggregates"."value_count" >= 0 AND "ai_property_daily_aggregates"."cleanliness_count" >= 0 AND "ai_property_daily_aggregates"."wait_time_count" >= 0 AND "ai_property_daily_aggregates"."atmosphere_count" >= 0 AND "ai_property_daily_aggregates"."location_count" >= 0 AND "ai_property_daily_aggregates"."accessibility_count" >= 0 AND "ai_property_daily_aggregates"."other_count" >= 0 AND "ai_property_daily_aggregates"."urgent_count" >= 0 AND "ai_property_daily_aggregates"."high_count" >= 0 AND "ai_property_daily_aggregates"."medium_count" >= 0 AND "ai_property_daily_aggregates"."low_count" >= 0),
	CONSTRAINT "ai_property_daily_aggregates_count_sums_valid" CHECK ("ai_property_daily_aggregates"."positive_count" + "ai_property_daily_aggregates"."neutral_count" + "ai_property_daily_aggregates"."negative_count" + "ai_property_daily_aggregates"."mixed_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."service_count" + "ai_property_daily_aggregates"."staff_count" + "ai_property_daily_aggregates"."quality_count" + "ai_property_daily_aggregates"."value_count" + "ai_property_daily_aggregates"."cleanliness_count" + "ai_property_daily_aggregates"."wait_time_count" + "ai_property_daily_aggregates"."atmosphere_count" + "ai_property_daily_aggregates"."location_count" + "ai_property_daily_aggregates"."accessibility_count" + "ai_property_daily_aggregates"."other_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."urgent_count" + "ai_property_daily_aggregates"."high_count" + "ai_property_daily_aggregates"."medium_count" + "ai_property_daily_aggregates"."low_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."rating_sum" <= "ai_property_daily_aggregates"."review_count" * 5)
);
--> statement-breakpoint
CREATE TABLE "ai_property_trend_reports" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"due_local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_trends_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"operation_id" uuid NOT NULL,
	"report_profile_version" varchar(100) NOT NULL,
	"signal_key" varchar(64) NOT NULL,
	"direction" varchar(20) NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"supporting_review_count" integer NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_trend_reports_pk" PRIMARY KEY("organization_id","property_id","due_local_date","source_epoch","review_analysis_epoch","property_trends_epoch","property_profile_version","terminal_analysis_sequence","aggregate_revision"),
	CONSTRAINT "ai_property_trend_reports_versions_valid" CHECK ("ai_property_trend_reports"."source_epoch" >= 1 AND "ai_property_trend_reports"."review_analysis_epoch" >= 1 AND "ai_property_trend_reports"."property_trends_epoch" >= 1 AND "ai_property_trend_reports"."property_profile_version" >= 1 AND "ai_property_trend_reports"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_trend_reports"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_trend_reports_output_valid" CHECK ("ai_property_trend_reports"."signal_key" ~ '^[a-z][a-z0-9_]{2,63}$' AND "ai_property_trend_reports"."direction" IN ('improving', 'stable', 'declining') AND "ai_property_trend_reports"."confidence_basis_points" BETWEEN 0 AND 10000 AND "ai_property_trend_reports"."supporting_review_count" >= 0 AND "ai_property_trend_reports"."expires_at" > "ai_property_trend_reports"."generated_at")
);
--> statement-breakpoint
CREATE TABLE "ai_review_analyses" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"operation_id" uuid NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"analysis_profile_version" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"unavailable_reason" varchar(40),
	"sentiment" varchar(20),
	"primary_category" varchar(40),
	"attention" varchar(20),
	"generated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_review_analyses_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence"),
	CONSTRAINT "ai_review_analyses_versions_valid" CHECK ("ai_review_analyses"."source_epoch" >= 1 AND "ai_review_analyses"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."review_analysis_epoch" >= 1 AND "ai_review_analyses"."property_profile_version" >= 1),
	CONSTRAINT "ai_review_analyses_result_valid" CHECK ((
        ("ai_review_analyses"."status" = 'ready' AND "ai_review_analyses"."unavailable_reason" IS NULL AND "ai_review_analyses"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_review_analyses"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND "ai_review_analyses"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_review_analyses"."status" = 'unavailable' AND "ai_review_analyses"."unavailable_reason" = 'language_not_supported' AND "ai_review_analyses"."sentiment" IS NULL AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."attention" IS NULL)
      )),
	CONSTRAINT "ai_review_analyses_retention_valid" CHECK ("ai_review_analyses"."expires_at" > "ai_review_analyses"."generated_at")
);
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_calendar_profile_version_ai_property_calendar_catalogues_profile_version_fk" FOREIGN KEY ("calendar_profile_version") REFERENCES "public"."ai_property_calendar_catalogues"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_analysis_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_calendar_profile_version_ai_property_calendar_catalogues_profile_version_fk" FOREIGN KEY ("calendar_profile_version") REFERENCES "public"."ai_property_calendar_catalogues"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_reports" ADD CONSTRAINT "ai_property_trend_reports_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_reports" ADD CONSTRAINT "ai_property_trend_reports_report_profile_version_ai_operation_profiles_profile_version_fk" FOREIGN KEY ("report_profile_version") REFERENCES "public"."ai_operation_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_reports" ADD CONSTRAINT "ai_property_trend_reports_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_analysis_profile_version_ai_operation_profiles_profile_version_fk" FOREIGN KEY ("analysis_profile_version") REFERENCES "public"."ai_operation_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_tenant_identity_unique" ON "reviews" USING btree ("organization_id","property_id","id");--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_review_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_contributions_date_idx" ON "ai_property_aggregate_contributions" USING btree ("organization_id","property_id","local_date","source_epoch","review_analysis_epoch");--> statement-breakpoint
CREATE INDEX "ai_property_daily_aggregates_window_idx" ON "ai_property_daily_aggregates" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_reports_operation_unique" ON "ai_property_trend_reports" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "ai_property_trend_reports_current_idx" ON "ai_property_trend_reports" USING btree ("organization_id","property_id","due_local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_property_trend_reports_expiry_idx" ON "ai_property_trend_reports" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analyses_operation_unique" ON "ai_review_analyses" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "ai_review_analyses_current_idx" ON "ai_review_analyses" USING btree ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence");--> statement-breakpoint
CREATE INDEX "ai_review_analyses_expiry_idx" ON "ai_review_analyses" USING btree ("expires_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ai_property_local_date_v1"(
  p_reviewed_at timestamp with time zone,
  p_timezone text
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_epoch_millis bigint;
  v_millisecond_instant timestamp with time zone;
  v_local_date date;
BEGIN
  IF length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_epoch_millis := public.ai_epoch_millis_v1(p_reviewed_at);
  v_millisecond_instant :=
    timestamp with time zone '1970-01-01 00:00:00+00'
    + (v_epoch_millis * interval '1 millisecond');
  v_local_date := (v_millisecond_instant AT TIME ZONE p_timezone)::date;
  IF extract(year FROM v_local_date) NOT BETWEEN 1970 AND 2100 THEN
    RETURN NULL;
  END IF;
  RETURN v_local_date;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_property_calendar_catalogues_immutable"
BEFORE UPDATE OR DELETE ON "ai_property_calendar_catalogues"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_property_calendar_catalogues_no_truncate"
BEFORE TRUNCATE ON "ai_property_calendar_catalogues"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();