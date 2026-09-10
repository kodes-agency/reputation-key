CREATE INDEX "outbox_events_ai_backfill_chain_idx"
ON "outbox_events" USING btree (
  "organization_id",
  "property_id",
  ("payload"->>'correlationId'),
  ("payload"->>'analysisSequence')
)
WHERE "event_type" = 'ai.review_analysis.backfill_requested'
  AND "published_at" IS NOT NULL
  AND "recovery_fenced_at" IS NULL;
