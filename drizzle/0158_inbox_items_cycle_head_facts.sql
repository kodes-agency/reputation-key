-- The Handling Cycle head repeats the Inbox row except three facts: the current
-- cycle number, the current source revision and the state revision. Carry them
-- on the Inbox row so the head table can later be retired. Nullable with no
-- default: no table rewrite, and an item without a head keeps all three NULL.
-- The operator backfill copies them from the heads in bounded batches.
ALTER TABLE "inbox_items" ADD COLUMN "current_cycle_number" bigint;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "current_source_revision" bigint;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "state_revision" bigint;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_cycle_head_facts_valid" CHECK (("inbox_items"."current_cycle_number" IS NULL) = ("inbox_items"."current_source_revision" IS NULL) AND ("inbox_items"."current_cycle_number" IS NULL) = ("inbox_items"."state_revision" IS NULL) AND ("inbox_items"."current_cycle_number" IS NULL OR ("inbox_items"."current_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint AND "inbox_items"."current_source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "inbox_items"."state_revision" BETWEEN 1 AND '9007199254740991'::bigint))) NOT VALID;
