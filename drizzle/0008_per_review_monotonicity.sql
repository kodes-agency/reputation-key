CREATE TABLE "ai_property_aggregate_settlements" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_aggregate_settlements_pk" PRIMARY KEY("organization_id","property_id","source_epoch","review_analysis_epoch","analysis_sequence"),
	CONSTRAINT "ai_property_aggregate_settlements_versions_valid" CHECK ("ai_property_aggregate_settlements"."source_epoch" >= 0 AND "ai_property_aggregate_settlements"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_settlements"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
INSERT INTO "ai_property_aggregate_settlements" (
  "organization_id",
  "property_id",
  "review_id",
  "source_epoch",
  "review_analysis_epoch",
  "analysis_sequence",
  "settled_at"
)
SELECT
  contribution."organization_id",
  contribution."property_id",
  contribution."review_id",
  contribution."source_epoch",
  contribution."review_analysis_epoch",
  contribution."analysis_sequence",
  contribution."applied_at"
FROM "ai_property_aggregate_contributions" AS contribution
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "ai_property_aggregate_settlements" (
  "organization_id",
  "property_id",
  "review_id",
  "source_epoch",
  "review_analysis_epoch",
  "analysis_sequence",
  "settled_at"
)
SELECT
  event."organization_id",
  event."property_id"::uuid,
  (event."payload"->>'reviewId')::uuid,
  head."source_epoch",
  head."review_analysis_epoch",
  (event."payload"->>'analysisSequence')::bigint,
  event."created_at"
FROM "ai_property_aggregate_heads" AS head
INNER JOIN "merchant_ai_enablement" AS auth
  ON auth."organization_id" = head."organization_id"
 AND auth."property_id" = head."property_id"
 AND auth."authorized_source_epoch" = head."source_epoch"
 AND auth."review_analysis_epoch" = head."review_analysis_epoch"
INNER JOIN "outbox_events" AS event
  ON event."organization_id" = head."organization_id"
 AND event."property_id"::uuid = head."property_id"
WHERE event."event_type" IN (
    'review.created',
    'review.updated',
    'review.source_transitioned',
    'ai.review_analysis.backfill_requested'
  )
  AND event."payload"->>'reviewId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  AND event."payload"->>'sourceEpoch' ~ '^[0-9]+$'
  AND event."payload"->>'analysisSequence' ~ '^[1-9][0-9]*$'
  AND (event."payload"->>'sourceEpoch')::integer = head."source_epoch"
  AND (event."payload"->>'analysisSequence')::bigint
    > auth."analysis_start_sequence"
  AND (event."payload"->>'analysisSequence')::bigint
    <= head."terminal_analysis_sequence"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DROP INDEX IF EXISTS "outbox_events_ai_backfill_chain_idx";
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_settlements" ADD CONSTRAINT "ai_property_aggregate_settlements_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_settlements" ADD CONSTRAINT "ai_property_aggregate_settlements_review_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_settlements_review_idx" ON "ai_property_aggregate_settlements" USING btree ("organization_id","property_id","review_id","source_epoch","review_analysis_epoch","analysis_sequence" DESC NULLS LAST);--> statement-breakpoint