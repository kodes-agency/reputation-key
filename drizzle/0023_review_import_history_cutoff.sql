-- Keep the initial Google import's history cutoff after its run is gone.
--
-- A review Google published before the import started is onboarding history,
-- not late work. That cutoff lived only on the import's snapshot run, so it
-- held only for reviews that run itself saw first. When the import failed
-- part-way, when it joined a discovery run that was already active, or when
-- Google later listed an old review the import never returned, the review was
-- first seen by an `ongoing` run and became a measured Response Target that
-- started at its original publication time: overdue on creation, with both
-- reminders due at once. Snapshot runs are also swept 30 days after they end.
--
-- One row per Property source epoch, written once by the transaction that
-- starts or joins the epoch's first import run. A new epoch has its own
-- cutoff; Property deletion cascades the row. Identifiers and one instant
-- only, no provider content.
CREATE TABLE "review_provider_history_cutoffs" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_provider_history_cutoffs_pk" PRIMARY KEY("organization_id","property_id","source_epoch"),
	CONSTRAINT "review_provider_history_cutoffs_source_epoch_valid" CHECK ("review_provider_history_cutoffs"."source_epoch" BETWEEN 0 AND 2147483647)
);
--> statement-breakpoint
ALTER TABLE "review_provider_history_cutoffs" ADD CONSTRAINT "review_provider_history_cutoffs_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A Property imported before this migration keeps the cutoff its import run
-- still records: the start of the first `historical_onboarding` run of each
-- source epoch, including an import still in flight. Runs are swept 30 days
-- after they end, so an older import has none and keeps today's behaviour, as
-- does an import that joined a discovery run and so left no import run.
INSERT INTO "review_provider_history_cutoffs" ("organization_id", "property_id", "source_epoch", "cutoff_at")
SELECT "organization_id", "property_id", "source_epoch", min("started_at")
FROM "review_provider_snapshot_runs"
WHERE "observation_origin" = 'historical_onboarding'
GROUP BY "organization_id", "property_id", "source_epoch"
ON CONFLICT DO NOTHING;
