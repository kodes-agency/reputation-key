-- The Handling Cycle head table `inbox_handling_cycle_heads` is being retired.
-- Its one protection the Inbox row does not already have is the foreign key
-- from the head's current Material Review Revision to `material_review_revisions`
-- (ON DELETE RESTRICT): while an Inbox item's current cycle points at a Review's
-- revision, that revision cannot be deleted. A Review epoch carry moves the head
-- to a newer revision than the cycle's own anchor, so the cycle's foreign key
-- does not cover it.
--
-- Carry the same fact on the Inbox row: the Material Review Revision the item's
-- current cycle rests on. Nullable with no default, so the column costs no table
-- rewrite. It stays NULL for a feedback item (its source revision is a Guest
-- Response Revision, not a Review revision) and for an item with no cycle yet;
-- a composite foreign key whose column is NULL is not checked. For a Review item
-- the review id is the item's own `source_id`, so no second column is needed.
-- The column is written beside `current_source_revision`, and an operator
-- backfill copies it for rows written before that.
ALTER TABLE "inbox_items" ADD COLUMN "current_material_review_revision" bigint;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_material_revision_fk" FOREIGN KEY ("source_id","current_material_review_revision") REFERENCES "material_review_revisions"("review_id","revision") ON DELETE RESTRICT NOT VALID;
