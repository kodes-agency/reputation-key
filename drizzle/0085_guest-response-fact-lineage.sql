ALTER TABLE "guest_responses" ADD COLUMN "rating_source_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "guest_responses" ADD COLUMN "feedback_source_event_id" varchar(255);--> statement-breakpoint

-- Recover the stable source-event identity for canonical responses whose
-- content-free Guest fact is still present. DISTINCT ON makes the choice
-- deterministic if historical duplicate evidence exists; no value is guessed.
WITH rating_lineage AS (
  SELECT DISTINCT ON (source_aggregate_id)
    source_aggregate_id,
    id::text AS event_id
  FROM outbox_events
  WHERE event_type = 'guest.rating.submitted'
  ORDER BY source_aggregate_id, created_at DESC, id DESC
)
UPDATE guest_responses AS response
SET rating_source_event_id = lineage.event_id
FROM rating_lineage AS lineage
WHERE lineage.source_aggregate_id = response.id::text
  AND response.rating IS NOT NULL
  AND response.response_consent = true
  AND response.rating_source_event_id IS NULL;--> statement-breakpoint

WITH feedback_lineage AS (
  SELECT DISTINCT ON (source_aggregate_id)
    source_aggregate_id,
    id::text AS event_id
  FROM outbox_events
  WHERE event_type = 'guest.feedback.submitted'
  ORDER BY source_aggregate_id, created_at DESC, id DESC
)
UPDATE guest_responses AS response
SET feedback_source_event_id = lineage.event_id
FROM feedback_lineage AS lineage
WHERE lineage.source_aggregate_id = response.id::text
  AND response.response_text IS NOT NULL
  AND response.text_consent = true
  AND response.feedback_source_event_id IS NULL;
