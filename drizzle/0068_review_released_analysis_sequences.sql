-- Released AI-analysis sequences (ADR 0058, amendment 2026-10-22): the numbers the
-- allocator handed out that no Review will ever hold.
--
-- `lock_review_ai_analysis_head_v1` raises `review_ai_analysis_heads.head_sequence`
-- by one for every observation the Review writer is about to apply. When that
-- observation then turned out to be a replay (the same observation key) or an
-- older Google version than the stored one, the writer returned without a
-- Review stamped with the number and without an event, and the transaction
-- committed with the head one higher. Coverage owes a settlement for every
-- sequence in (analysis_start_sequence, head_sequence], so each such number was
-- awaited for ever: `ai.review-analysis-stalled` fired, the Property's
-- aggregate stayed provisional and `generate-property-trend` retried without
-- end.
--
-- One row here is one such number. Coverage subtracts the rows in
-- (analysis_start_sequence, head_sequence] of the same source epoch that are not
-- also settled; the writer inserts a row in the same transaction that
-- allocated the number; `pnpm ops ai release-orphan-sequences` records the
-- numbers a past leak left behind.
--
-- Content-free: ids, two integers, an enum and an instant. Kept with the head
-- (same lifetime and tenant FK, cascade with the Property; the Review
-- Organization purge deletes the rows explicitly) and never exported.
--
-- Purely additive: old code never names the table and keeps leaking until it is
-- replaced, which the stall alert would show. This runs before any new process
-- (web's preDeploy; deploy web, then the worker). No backfill: the leaked
-- numbers are recorded by the operator command after the deploy.
--
-- Down: `DROP TABLE review_ai_analysis_released_sequences`; delete the 0068 row
-- of drizzle.__drizzle_migrations.
CREATE TABLE "review_ai_analysis_released_sequences" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "analysis_sequence" bigint NOT NULL,
  "reason" varchar(32) NOT NULL,
  "released_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_ai_analysis_released_sequences_pk" PRIMARY KEY("organization_id","property_id","source_epoch","analysis_sequence"),
  CONSTRAINT "review_ai_analysis_released_sequences_source_epoch_safe" CHECK ("source_epoch" BETWEEN 0 AND 2147483647),
  CONSTRAINT "review_ai_analysis_released_sequences_sequence_safe" CHECK ("analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint),
  CONSTRAINT "review_ai_analysis_released_sequences_reason_valid" CHECK ("reason" IN ('replayed_observation', 'out_of_order_observation', 'operator_repair'))
);
--> statement-breakpoint
ALTER TABLE "review_ai_analysis_released_sequences" ADD CONSTRAINT "review_ai_analysis_released_sequences_property_tenant_fk"
  FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade;
