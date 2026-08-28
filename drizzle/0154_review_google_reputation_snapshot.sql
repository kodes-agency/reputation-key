ALTER TABLE "review_provider_snapshot_runs"
ADD COLUMN "expected_average_rating" double precision;
--> statement-breakpoint
UPDATE "review_provider_snapshot_runs"
SET
  "state" = 'failed',
  "phase" = 'terminal',
  "expected_total" = NULL,
  "failure_code" = 'malformed_page',
  "terminal_at" = transaction_timestamp(),
  "record_expires_at" = transaction_timestamp() + interval '30 days',
  "main_cursor_ref" = NULL,
  "confirmation_cursor_ref" = NULL,
  "updated_at" = transaction_timestamp()
WHERE "state" IN ('scanning', 'confirming', 'deleting')
  AND "expected_total" IS NOT NULL;
--> statement-breakpoint
UPDATE "review_provider_snapshot_runs"
SET
  "expected_total" = NULL,
  "updated_at" = transaction_timestamp()
WHERE "expected_total" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_provider_snapshot_runs"
DROP CONSTRAINT "review_provider_snapshot_runs_counts_valid";
--> statement-breakpoint
ALTER TABLE "review_provider_snapshot_runs"
ADD CONSTRAINT "review_provider_snapshot_runs_counts_valid" CHECK (
  "source_epoch" BETWEEN 0 AND 2147483647
  AND ("expected_total" IS NULL OR "expected_total" BETWEEN 0 AND 10000)
  AND ("expected_average_rating" IS NULL OR "expected_average_rating" BETWEEN 0 AND 5)
  AND (
    ("expected_total" IS NULL AND "expected_average_rating" IS NULL)
    OR ("expected_total" = 0 AND "expected_average_rating" IS NULL)
    OR ("expected_total" > 0 AND "expected_average_rating" IS NOT NULL)
  )
  AND "main_page_count" BETWEEN 0 AND 200
  AND "confirmation_page_count" BETWEEN 0 AND 200
  AND "main_unique_count" BETWEEN 0 AND 10000
  AND "confirmation_unique_count" BETWEEN 0 AND 10000
);
--> statement-breakpoint
CREATE TABLE "review_google_reputation_snapshot_facts" (
  "run_id" uuid PRIMARY KEY NOT NULL,
  "event_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "review_count" integer NOT NULL,
  "average_rating" double precision,
  "evaluated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_google_reputation_snapshot_source_epoch_valid"
    CHECK ("source_epoch" BETWEEN 0 AND 2147483647),
  CONSTRAINT "review_google_reputation_snapshot_value_valid"
    CHECK (
      ("review_count" = 0 AND "average_rating" IS NULL)
      OR ("review_count" BETWEEN 1 AND 10000
        AND "average_rating" BETWEEN 0 AND 5)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "review_google_reputation_snapshot_event_unique"
ON "review_google_reputation_snapshot_facts" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "review_google_reputation_snapshot_scope_idx"
ON "review_google_reputation_snapshot_facts" USING btree (
  "organization_id", "property_id", "source_epoch", "evaluated_at" DESC
);
--> statement-breakpoint
ALTER TABLE "review_google_reputation_snapshot_facts"
ADD CONSTRAINT "review_google_reputation_snapshot_property_tenant_fk"
FOREIGN KEY ("organization_id", "property_id")
REFERENCES "public"."properties"("organization_id", "id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "metric_current_google_reputation_snapshots" (
  "property_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "source_epoch" integer NOT NULL,
  "source_run_id" uuid NOT NULL,
  "source_event_id" uuid NOT NULL,
  "review_count" integer NOT NULL,
  "average_rating" double precision,
  "evaluated_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_current_google_reputation_source_epoch_valid"
    CHECK ("source_epoch" BETWEEN 0 AND 2147483647),
  CONSTRAINT "metric_current_google_reputation_value_valid"
    CHECK (
      ("review_count" = 0 AND "average_rating" IS NULL)
      OR ("review_count" BETWEEN 1 AND 10000
        AND "average_rating" BETWEEN 0 AND 5)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_current_google_reputation_source_run_unique"
ON "metric_current_google_reputation_snapshots" USING btree ("source_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_current_google_reputation_source_event_unique"
ON "metric_current_google_reputation_snapshots" USING btree ("source_event_id");
--> statement-breakpoint
CREATE INDEX "metric_current_google_reputation_scope_idx"
ON "metric_current_google_reputation_snapshots" USING btree (
  "organization_id", "property_id"
);
--> statement-breakpoint
ALTER TABLE "metric_current_google_reputation_snapshots"
ADD CONSTRAINT "metric_current_google_reputation_property_tenant_fk"
FOREIGN KEY ("organization_id", "property_id")
REFERENCES "public"."properties"("organization_id", "id")
ON DELETE cascade ON UPDATE no action;
