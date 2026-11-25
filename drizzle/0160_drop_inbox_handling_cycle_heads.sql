-- migrate:contract be64e57243d41aa3f3877de89b65977be3887053
-- Drops the retired Inbox Handling Cycle head table. It mirrored three facts the
-- Inbox row now carries (migration 0158), and nothing reads or writes it since
-- the release above. Nothing references it; its own foreign keys to
-- inbox_items, inbox_handling_cycles and material_review_revisions, its index
-- and its CHECKs go with it.
DROP TABLE IF EXISTS "inbox_handling_cycle_heads";
