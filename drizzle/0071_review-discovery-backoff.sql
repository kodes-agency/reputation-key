ALTER TABLE "review_sync_state" ADD COLUMN "last_new_review_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "inbox_items_created_at_idx" ON "inbox_items" USING btree ("created_at","id");
